import { assert } from "console";
import https from "https";
import { PoolClient, QueryResult } from "pg";
import WebSocket from "ws";
import {
	acquireBeatmapAdvisoryLock,
	convertToBeatenScoreParamObject,
	dbPool,
	getInexistentBeatmapIds,
	getInexistentPlayerIds,
	getLastScoreId,
	recalculateScorePositionsForMaps,
	saveLastScoreId,
	updateBeatmapScoresRetrievalDate,
	withDbClientTransaction
} from "../db.js";
import { DB_SCORES_TABLE, DEV_ENV, VERBOSE } from "../env.js";
import { scrapePlayers } from "../scripts/scrape_players.js";
import {
	convertApiScore,
	ParsedFlags,
	prepareScoresTableValuesAndParamPlaceholders,
	SCORE_TABLE_COLUMNS,
	sleep,
	sortWsScores
} from "../shared.js";
import { FLAG_DEFINITIONS } from "./main.js";

const SCORES_WS_URL = "wss://ushio.chiffa.lol";
const SCORES_WS_PING_INTERVAL = 30000;
const SCORES_WS_RECONNECTION_INTERVAL = 10000;

const batchCandidateScores = new Array<WsScore>();
const batchCandidatePlayerIds = new Array<number>();
const batchCandidateBeatmapIds = new Array<number>();
let sessionBatchCount = 0;
let batchTotalScoreCount = 0;
let batchLowestScoreId = Infinity; // assumes score ids to be monotonic
let initialCursorScoreId: number | null = null;

const agent = new https.Agent({ keepAlive: true, sessionTimeout: 900, rejectUnauthorized: DEV_ENV });
export let scoresWsPing: NodeJS.Timeout;
export let scoresWs = new WebSocket(SCORES_WS_URL, { agent });

function startScoresWsPing() {
	scoresWsPing = setInterval(() => scoresWs.readyState === WebSocket.OPEN && scoresWs.ping(), SCORES_WS_PING_INTERVAL);
}

async function reconnectScoresWs() {
	try {
		clearInterval(scoresWsPing);
		await sleep(SCORES_WS_RECONNECTION_INTERVAL);
		console.log("reconnecting to scores-ws");

		scoresWs = new WebSocket(SCORES_WS_URL, { agent });
		scoresWs.on("open", scoresWsOnOpen);
		scoresWs.on("error", scoresWsOnError);
		scoresWs.on("close", scoresWsOnClose);
		scoresWs.on("message", scoresWsOnMessage);
	} catch (e) {
		console.error("failed to reconnect to scores-ws\n:", e);
		setTimeout(reconnectScoresWs, SCORES_WS_RECONNECTION_INTERVAL);
	}
}

export async function scoresWsOnOpen(parsedFlags: ParsedFlags<typeof FLAG_DEFINITIONS>) {
	sessionBatchCount = 0;
	batchTotalScoreCount = 0;
	batchLowestScoreId = Infinity;
	initialCursorScoreId = null;
	const cursorScoreId = await getCursorScoreId(parsedFlags?.cursorScoreId);
	initialCursorScoreId = cursorScoreId;

	console.log(`connecting to scores-ws with cursor score id: ${cursorScoreId}`);
	scoresWs.send(cursorScoreId);
	startScoresWsPing();
}

export function scoresWsOnClose(code: number, reason: Buffer) {
	console.warn("scores-ws connection closed:", code, reason?.toString());
	saveLastScoreId(batchLowestScoreId);

	reconnectScoresWs();
}

export function scoresWsOnError(e: Error) {
	console.error("scores-ws error:\n", e);
	saveLastScoreId(batchLowestScoreId);

	reconnectScoresWs();
}

export async function scoresWsOnMessage(event: WebSocket.RawData) {
	const message = event.toString();
	if (message === "start-batch") return;
	if (message === "end-batch") {
		try {
			++sessionBatchCount;
			await endAndSaveScoresBatch();
		} catch (e) {
			console.error("failed to process scores-ws batch:\n", e);
		}
		return;
	}

	try {
		const score = JSON.parse(message) as WsScore;
		if (!score.id) {
			console.warn("skipping malformed scores-ws JSON:\n", score);
			return;
		}

		++batchTotalScoreCount;
		if (!isCandidateScore(score)) return;
		batchLowestScoreId = score.id < batchLowestScoreId ? score.id : batchLowestScoreId;
		batchCandidateScores.push(score);
		batchCandidatePlayerIds.push(score.user_id);
		batchCandidateBeatmapIds.push(score.beatmap_id);
	} catch (e) {
		console.error("failed to parse scores-ws message as JSON:\n", e);
		saveLastScoreId(batchLowestScoreId);
	}
}

async function getCursorScoreId(cursorScoreIdCli?: string) {
	const parsed = parseCursorScoreId(cursorScoreIdCli);
	return parsed == null ? await getLastScoreId() : parsed;
}

function parseCursorScoreId(cursorScoreIdCli?: string) {
	if (cursorScoreIdCli == null) return null;

	const parsed = parseInt(cursorScoreIdCli, 10);
	if (isNaN(parsed) || parsed < 0) {
		console.error(`Invalid cursor score id, must be a non-negative number: ${cursorScoreIdCli}`);
		process.exit(9);
	}
	return parsed;
}

async function endAndSaveScoresBatch(scores = batchCandidateScores) {
	console.log(
		`\n[Batch #${sessionBatchCount}] ${batchTotalScoreCount} scores total | ${scores?.length} candidate scores`
	);
	if (sessionBatchCount <= 1 && initialCursorScoreId && batchLowestScoreId > initialCursorScoreId + 1)
		console.warn(
			`POSSIBLE DATA LOSS: Gap between cursor score id (${initialCursorScoreId}) and initial batch lowest score id (${batchLowestScoreId})`
		);
	if (!scores?.length) return;

	await fetchMissingBeatmaps(batchCandidateBeatmapIds);
	await fetchMissingPlayers(batchCandidatePlayerIds);

	const beatenScoresByMaps = await getBeatenScoresByMap(scores);
	if (VERBOSE) console.log("beatenScoresByMaps:\n", beatenScoresByMaps); // TODO debug only

	let totalProvenScoreCount = 0;
	const provenScoresByMaps = new Map<string, { beatmapId: number; rulesetId: RulesetId; scores: WsScore[] }>();
	for (const beatenScoresByMap of beatenScoresByMaps) {
		const beatmapId = beatenScoresByMap.beatmap_id;
		const rulesetId = beatenScoresByMap.ruleset_id;
		const provenScoreIds = new Set(beatenScoresByMap.candidate_ids.map(id => Number(id)));
		// TODO?: profile this and try to sort in the db
		const provenScores = scores.filter(score => provenScoreIds.has(score.id)).sort(sortWsScores);
		assert(provenScoreIds.size === provenScores.length);
		totalProvenScoreCount += provenScores.length;

		const key = `${beatmapId}:${rulesetId}`;
		const existing = provenScoresByMaps.get(key);
		existing
			? existing.scores.push(...provenScores)
			: provenScoresByMaps.set(key, { beatmapId, rulesetId, scores: provenScores });
	}

	if (VERBOSE) console.log(`Found ${totalProvenScoreCount} beaten top 100 score(s)`);

	for (const { beatmapId, rulesetId, scores: mapScores } of provenScoresByMaps.values()) {
		const dedupedScores = dedupeTopScoresByUser(mapScores);
		const convertedScores = dedupedScores.map(score =>
			convertApiScore(score, /* positions set later in recalculateScorePositionsForMap */ 0, false)
		);
		await withDbClientTransaction(async client => {
			await upsertBeatmapScores(client, beatmapId, rulesetId, convertedScores);
		});
	}

	saveLastScoreId(batchLowestScoreId);
	batchLowestScoreId = Infinity;
	batchTotalScoreCount = 0;
	scores.length = 0;
}

function isCandidateScore(score: WsScore) {
	// only passed scores are sent anyway, not much to do here
	// TODO osu!standard only for now, maybe add other rulesets later
	return score.ruleset_id == 0;
}

async function fetchMissingBeatmaps(beatmapIds: number[]) {
	const missingIds = await getInexistentBeatmapIds(beatmapIds);
	if (missingIds?.length) {
		if (VERBOSE) console.log(`Found ${missingIds.length} new beatmap id(s) not in the database`);
		// TODO
	}

	batchCandidateBeatmapIds.length = 0;
}

async function fetchMissingPlayers(playerIds: number[]) {
	try {
		const missingIds = await getInexistentPlayerIds(playerIds);
		if (missingIds?.length) {
			if (VERBOSE) console.log(`Found ${missingIds.length} new player id(s) not in the database`);
			await scrapePlayers(missingIds);
		}

		batchCandidatePlayerIds.length = 0;
	} catch (e) {
		console.error("failed to get missing players:\n", e);
	}
}

// TODO: Probably want to do it directly in the database in getBeatenScoresByMap() but brain too small
function dedupeTopScoresByUser(scores: WsScore[]) {
	const seenUserIds = new Set<number>();
	return scores.filter(score => {
		if (seenUserIds.has(score.user_id)) return false;
		seenUserIds.add(score.user_id);
		return true;
	});
}

// Single temp table prevents concurrency (processing multiple beatmaps at once) I think
async function createTempScoresTable(client: PoolClient) {
	await client.query(`
		CREATE TEMPORARY TABLE IF NOT EXISTS ws_scores_tmp (
      position      						SMALLINT NOT NULL,
      is_scraped      					BOOLEAN NOT NULL,
      retrieved_at     					TIMESTAMPTZ NOT NULL,
      is_lazer      						BOOLEAN NOT NULL,
      is_perma      						BOOLEAN NOT NULL DEFAULT FALSE,
      id                  			BIGINT PRIMARY KEY,
      user_id             			INTEGER NOT NULL,
      ruleset_id          			SMALLINT NOT NULL,
      beatmap_id          			BIGINT NOT NULL,
      grade                			CHAR(2) NOT NULL DEFAULT '',
      accuracy            			REAL NOT NULL DEFAULT 0,
      max_combo           			INTEGER NOT NULL DEFAULT 0,
      total_score         			INTEGER NOT NULL DEFAULT 0,
      classic_total_score 			BIGINT,
      total_score_without_mods 	INTEGER,
      is_perfect_combo    			BOOLEAN,
      pp                 				REAL,
      ended_at            			TIMESTAMPTZ NOT NULL,
      data               			 	JSONB NOT NULL DEFAULT '{}'::jsonb,
		) ON COMMIT DELETE ROWS`);
	await client.query("TRUNCATE ws_scores_tmp");
}

async function upsertBeatmapScores(
	client: PoolClient,
	beatmapId: number,
	rulesetId: RulesetId,
	provenScores: BeatmapScoreFull[]
) {
	if (!provenScores?.length) return;
	await acquireBeatmapAdvisoryLock(client, beatmapId, rulesetId);
	await createTempScoresTable(client);

	const { values, paramGroups } = prepareScoresTableValuesAndParamPlaceholders(provenScores);
	await client.query(
		`INSERT INTO ws_scores_tmp (${SCORE_TABLE_COLUMNS.join(", ")}) VALUES ${paramGroups.join(", ")}`,
		values
	);

	await client.query(
		`DELETE FROM ${DB_SCORES_TABLE} s
		 USING ws_scores_tmp t
		 WHERE s.beatmap_id = $1
		   AND s.ruleset_id = $2
		   AND s.user_id = t.user_id
		   AND s.total_score < t.total_score`,
		[beatmapId, rulesetId]
	);

	await client.query(
		`INSERT INTO ${DB_SCORES_TABLE} (${SCORE_TABLE_COLUMNS.join(", ")})
		 SELECT ${SCORE_TABLE_COLUMNS.join(", ")} FROM ws_scores_tmp`
	);

	await recalculateScorePositionsForMaps(client, [{ beatmap_id: beatmapId, ruleset_id: rulesetId }]);
	await updateBeatmapScoresRetrievalDate(beatmapId, rulesetId, "last_scores_scrape");
}

// TODO return beaten score details to show cool live data
// TODO calculate is_perma here?
async function getBeatenScoresByMap(scores: WsScore[]) {
	const paramObj = convertToBeatenScoreParamObject(scores);
	const scoreList: QueryResult<{
		beatmap_id: number;
		ruleset_id: RulesetId;
		candidate_ids: number[];
	}> = await dbPool.query(
		`WITH candidates AS (
				SELECT
					candidate_id,
					candidate_ruleset_id,
					candidate_beatmap_id,
					candidate_user_id,
					candidate_score
				FROM UNNEST($1::bigint[], $2::smallint[], $3::bigint[], $4::integer[], $5::bigint[])
				AS t(candidate_id, candidate_ruleset_id, candidate_beatmap_id, candidate_user_id, candidate_score)
		),
		proven_scores AS (
			SELECT DISTINCT
				c.candidate_beatmap_id,
				c.candidate_ruleset_id,
				c.candidate_id
			FROM candidates c
			WHERE EXISTS (
				SELECT 1
				FROM scores s
				WHERE s.beatmap_id = c.candidate_beatmap_id
					AND s.ruleset_id = c.candidate_ruleset_id
					AND s.position BETWEEN 1 AND 100
					AND s.total_score < c.candidate_score
			)
			AND NOT EXISTS (
				SELECT 1
				FROM scores s2
				WHERE s2.beatmap_id = c.candidate_beatmap_id
					AND s2.ruleset_id = c.candidate_ruleset_id
					AND s2.user_id = c.candidate_user_id
					AND s2.total_score >= c.candidate_score
			)
		)
		SELECT
			candidate_beatmap_id AS beatmap_id,
			candidate_ruleset_id AS ruleset_id,
			array_agg(candidate_id) AS candidate_ids
		FROM proven_scores
		GROUP BY candidate_beatmap_id, candidate_ruleset_id`,
		[paramObj.ids, paramObj.rulesets, paramObj.beatmaps, paramObj.users, paramObj.totalScores]
	);

	return scoreList.rows;
}
