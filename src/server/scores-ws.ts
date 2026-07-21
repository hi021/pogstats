import https from "https";
import { ClientBase } from "pg";
import { LabelValues } from "prom-client";
import WebSocket from "ws";
import { SCORE_TABLE_COLUMNS, withDbClientTransaction } from "../db-generic.js";
import {
	acquireBeatmapAdvisoryLock,
	fetchNewBeatmaps,
	fetchNewPlayers,
	getLastScoreId,
	insertHistoricalPlayerSnipes,
	recalculateScorePositionsForMaps,
	saveLastScoreId,
	updateBeatmapScoresRetrievalDate
} from "../db.js";
import { DB_BEATMAPS_TABLE, DB_PLAYERS_TABLE, DB_SCORES_TABLE, DEV_ENV, VERBOSE } from "../env.js";
import { queryWithTiming, recordScoreBatchCounts, scoreBatchDuration } from "../metrics.js";
import {
	convertApiScore,
	ParsedFlags,
	prepareScoresTableValuesAndParamPlaceholders,
	RANKING_POS_THRESHOLDS,
	sleep,
	sortScores,
	sortWsScores,
	unnestObjectsIntoArrays
} from "../shared.js";
import { FLAG_DEFINITIONS } from "./main.js";

const SCORES_WS_URL = "wss://ushio.chiffa.lol";
const SCORES_WS_PING_INTERVAL = 30000;
const SCORES_WS_RECONNECTION_INTERVAL = 10000;

const batchCandidateScores = new Array<WsScore>();
const batchCandidateBeatmapIds = new Array<number>();
let batchTimer: (labels?: LabelValues<"success" | "batchNo">) => number;
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
	console.error(`[Batch #${sessionBatchCount}] scores-ws connection closed with code ${code}`, reason?.toString());
	saveLastScoreId(batchLowestScoreId, "scores_ws");

	reconnectScoresWs();
}

export function scoresWsOnError(e: Error) {
	console.error(`[Batch #${sessionBatchCount}] scores-ws error:\n`, e);
	saveLastScoreId(batchLowestScoreId, "scores_ws");

	reconnectScoresWs();
}

export async function scoresWsOnMessage(event: WebSocket.RawData) {
	const message = event.toString();
	if (message === "start-batch") {
		batchTimer = scoreBatchDuration.startTimer();
		return;
	}
	if (message === "end-batch") {
		try {
			++sessionBatchCount;
			await endAndSaveScoresBatch();
			batchTimer?.({ success: "true", batchNo: sessionBatchCount });
		} catch (e) {
			console.error(`[Batch #${sessionBatchCount}] failed to proces:\n`, e);
			batchTimer?.({ success: "false", batchNo: sessionBatchCount });
		}
		return;
	}

	try {
		const score = JSON.parse(message) as WsScore;
		if (!score.id) {
			console.warn(`[Batch #${sessionBatchCount}] skipping malformed scores-ws JSON:\n`, score);
			return;
		}

		++batchTotalScoreCount;
		if (!isCandidateScore(score)) return;
		batchLowestScoreId = score.id < batchLowestScoreId ? score.id : batchLowestScoreId;
		batchCandidateScores.push(score);
		batchCandidateBeatmapIds.push(score.beatmap_id);
	} catch (e) {
		console.error(`[Batch #${sessionBatchCount}] failed to parse scores-ws message as JSON:\n`, e);
		saveLastScoreId(batchLowestScoreId, "scores_ws");
	}
}

async function getCursorScoreId(cursorScoreIdCli?: string) {
	const parsed = parseCursorScoreId(cursorScoreIdCli);
	return parsed == null ? await getLastScoreId("scores_ws") : parsed;
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
	console.log("");
	console.log(`[Batch #${sessionBatchCount}] ${batchTotalScoreCount} scores total | ${scores?.length} candidate scores`);
	if (sessionBatchCount <= 1 && initialCursorScoreId && batchLowestScoreId > initialCursorScoreId + 1)
		// This is usually not an issue if the downtime was under an hour, there may have been intermediate failed or other mode scores
		console.warn(
			`POSSIBLE DATA LOSS:\nGap between cursor score id (${initialCursorScoreId}) and initial batch lowest score id (${batchLowestScoreId})`
		);
	if (!scores?.length) return;

	let beatenScoresByMaps: ProvenScoresPerRulesetBeatmap[] = [];
	await withDbClientTransaction(async client => {
		await fetchNewBeatmaps(client, batchCandidateBeatmapIds, () => (batchCandidateBeatmapIds.length = 0), "scores_ws");
		beatenScoresByMaps = await getBeatenScoresByMap(client, scores);
		const provenUserIds = beatenScoresByMaps.flatMap(p => p.proven_user_ids);
		await fetchNewPlayers(client, provenUserIds, undefined, "scores_ws");
	});

	let totalProvenScoreCount = 0;
	const provenScoresByMaps = new Map<string, { beatmapId: number; rulesetId: RulesetId; scores: WsScore[] }>();
	for (const beatenScoresByMap of beatenScoresByMaps) {
		const beatmapId = beatenScoresByMap.beatmap_id;
		const rulesetId = beatenScoresByMap.ruleset_id;
		const provenScoreIds = new Set(beatenScoresByMap.proven_ids.map(id => Number(id)));
		const provenScores = scores.filter(score => provenScoreIds.has(score.id)).sort(sortWsScores);
		totalProvenScoreCount += provenScores.length;

		const key = `${beatmapId}:${rulesetId}`;
		const existing = provenScoresByMaps.get(key);
		existing
			? existing.scores.push(...provenScores)
			: provenScoresByMaps.set(key, { beatmapId, rulesetId, scores: provenScores });
	}

	if (VERBOSE) console.log(`[Batch #${sessionBatchCount}] found ${totalProvenScoreCount} new (proven) top 100 score(s)`);
	recordScoreBatchCounts(batchTotalScoreCount, totalProvenScoreCount);

	await withDbClientTransaction(async client => {
		for (const { beatmapId, rulesetId, scores: mapScores } of provenScoresByMaps.values()) {
			const dedupedScores = dedupeTopScoresByUser(mapScores);
			const convertedScores = dedupedScores.map(score =>
				convertApiScore(score, /* positions set later in upsertBeatmapScores */ -1, false)
			);
			const snipes = await upsertBeatmapScores(client, beatmapId, rulesetId, convertedScores);
			// TODO: send snipe info to pog-ws
		}

		saveLastScoreId(batchLowestScoreId, "scores_ws");
	});
	batchLowestScoreId = Infinity;
	batchTotalScoreCount = 0;
	scores.length = 0;
}

function isCandidateScore(score: WsScore) {
	// only passed scores are sent anyway, not much to do here
	// TODO: osu!standard only for now, maybe add other rulesets later
	return score.ruleset_id == 0;
}

// TODO?: Probably want to do it directly in the database in getBeatenScoresByMap() but brain too small
function dedupeTopScoresByUser(scores: WsScore[]) {
	const seenUserIds = new Set<number>();
	return scores.filter(score => {
		if (seenUserIds.has(score.user_id)) return false;
		seenUserIds.add(score.user_id);
		return true;
	});
}

// Single temp table prevents concurrency (processing multiple beatmaps at once) I think
async function createTempScoresTable(client: ClientBase) {
	// Omits is_perma since it'll get calculated on insertion into the actual table
	await queryWithTiming(
		client,
		"createTempScoresTable",
		"scores_ws",
		`
		CREATE TEMPORARY TABLE IF NOT EXISTS ws_scores_tmp (
      position      						SMALLINT NOT NULL,
      is_scraped      					BOOLEAN NOT NULL,
      retrieved_at     					TIMESTAMPTZ NOT NULL,
      is_lazer      						BOOLEAN NOT NULL,
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
      data               			 	JSONB NOT NULL DEFAULT '{}'::jsonb
		) ON COMMIT DELETE ROWS;

		TRUNCATE ws_scores_tmp;`
	);
}

async function upsertBeatmapScores(
	client: ClientBase,
	beatmapId: number,
	rulesetId: RulesetId,
	provenScores: BeatmapScoreFull[]
) {
	if (!provenScores?.length) return;
	await acquireBeatmapAdvisoryLock(client, beatmapId, rulesetId, "scores_ws");
	await updateBeatmapScoresRetrievalDate(client, beatmapId, rulesetId, "last_scores_update", "scores_ws");

	const existingScores = await queryWithTiming<ScoreBasicData>(
		client,
		"upsertBeatmapScores_get_existing_scores",
		"scores_ws",
		`SELECT s.id,
						s.user_id AS "userId",
						s.total_score AS "totalScore",
						s.ended_at AS "endedAt",
						s.grade,
						p.username,
						p.country_code AS "countryCode"
		 FROM ${DB_SCORES_TABLE} s
		 	JOIN ${DB_PLAYERS_TABLE} p ON p.id = s.user_id
		 WHERE s.beatmap_id = $1
		  AND s.ruleset_id = $2
		  AND s.position BETWEEN 1 AND 100
		 ORDER BY s.position ASC`,
		[beatmapId, rulesetId]
	);

	await createTempScoresTable(client);
	const { values, paramGroups } = prepareScoresTableValuesAndParamPlaceholders(provenScores);
	await queryWithTiming(
		client,
		"upsertBeatmapScores_insert_new_scores_into_tmp",
		"scores_ws",
		`INSERT INTO ws_scores_tmp (${SCORE_TABLE_COLUMNS.join(",")}) VALUES ${paramGroups.join(",")}`,
		values
	);

	await queryWithTiming(
		client,
		"upsertBeatmapScores_delete_beaten_user_hiscores",
		"scores_ws",
		`DELETE FROM ${DB_SCORES_TABLE} s
		 USING ws_scores_tmp t
		 WHERE s.beatmap_id = $1
		   AND s.ruleset_id = $2
		   AND s.user_id = t.user_id
		   AND s.total_score < t.total_score`,
		[beatmapId, rulesetId]
	);

	await queryWithTiming(
		client,
		"upsertBeatmapScores_insert_new_scores",
		"scores_ws",
		`INSERT INTO ${DB_SCORES_TABLE} (${SCORE_TABLE_COLUMNS.join(",")})
		 SELECT ${SCORE_TABLE_COLUMNS.join(",")} FROM ws_scores_tmp`
	);

	await recalculateScorePositionsForMaps(client, [{ beatmap_id: beatmapId, ruleset_id: rulesetId }], "scores_ws");

	const insertedIds = provenScores.map(score => score.id);
	const insertedScores = await queryWithTiming<ScoreBasicData>(
		client,
		"upsertBeatmapScores_get_inserted_scores",
		"scores_ws",
		`SELECT s.id,
						s.user_id AS "userId",
						s.total_score AS "totalScore",
						s.ended_at AS "endedAt",
						s.grade,
						p.username,
						p.country_code AS "countryCode"
		FROM ${DB_SCORES_TABLE} s
			JOIN ${DB_PLAYERS_TABLE} p ON p.id = s.user_id
		WHERE s.id = ANY($1::BIGINT[])
		ORDER BY s.ended_at ASC, s.id ASC`,
		[insertedIds]
	);

	const currentScores: ScoreBasicData[] = [...existingScores.rows];
	const beatenScoresMap = new Map<number, BeatenScoreData[]>();
	const snipes: HistoricalPlayerSnipes[] = [];

	// TODO?: move this logic into postgres temporary tables, but idk no perf issues for now
	for (const newScore of insertedScores.rows) {
		const existingUserScoreIndex = currentScores.findIndex(s => s.userId == newScore.userId);
		if (existingUserScoreIndex != -1) currentScores.splice(existingUserScoreIndex, 1);

		const insertIndex = currentScores.findIndex(existingScore => sortScores(newScore, existingScore) < 0);
		const insertPosition = insertIndex == -1 ? currentScores.length : insertIndex;

		for (
			let victimIndex = insertPosition;
			victimIndex < (existingUserScoreIndex == -1 ? currentScores.length : existingUserScoreIndex);
			victimIndex++
		) {
			const oldPosition = (victimIndex + 1) as RankingPositionThreshold;
			if (!RANKING_POS_THRESHOLDS.includes(oldPosition)) continue;

			const victim = currentScores[victimIndex];
			const threshold = oldPosition;
			const beatenScore: BeatenScoreData = {
				position_threshold: threshold,
				score_id: victim.id,
				user_id: victim.userId,
				username: victim.username,
				country: victim.countryCode
			};

			const existingBeaten = beatenScoresMap.get(newScore.id);
			existingBeaten ? existingBeaten.push(beatenScore) : beatenScoresMap.set(newScore.id, [beatenScore]);

			snipes.push({
				userId: victim.userId,
				scoreId: victim.id,
				snipedBy: newScore.userId,
				snipedWith: newScore.id,
				beatmapId,
				rulesetId,
				positionThreshold: threshold,
				date: newScore.endedAt
			});
		}

		currentScores.splice(insertPosition, 0, newScore);
	}

	await insertHistoricalPlayerSnipes(client, snipes, "scores_ws");

	const beatingScores = await queryWithTiming<BeatingScoreData>(
		client,
		"upsertBeatmapScores_get_beating_scores",
		"scores_ws",
		`SELECT s.id AS score_id,
						s.position,
						s.grade,
						provenPlr.id AS proven_user_id,
						provenPlr.username AS proven_username,
						provenPlr.country_code AS proven_country,
						b.artist,
						b.title,
						b.version,
						(b.approved_date > NOW() - INTERVAL '3 DAYS') AS is_beatmap_new
		 FROM ${DB_SCORES_TABLE} s
			JOIN ${DB_PLAYERS_TABLE} provenPlr ON provenPlr.id = s.user_id
			JOIN ${DB_BEATMAPS_TABLE} b ON b.id = s.beatmap_id
		 WHERE s.id = ANY($1::BIGINT[])
		 ORDER BY s.ended_at ASC`,
		[insertedIds]
	);

	const result: BeatingScoreData[] = beatingScores.rows.map(row => ({
		...row,
		beaten_scores: beatenScoresMap.get(Number(row.score_id)) ?? []
	}));

	return result;
}

// WARNING: this skips inserting scores with position > 100, so when a player gets restricted, there might be a gap or a stale score (#101 in the db but >#101 on osu) will make it into top 100
// Does not save scores for qualified maps - fetching those is skipped in scrape_beatmaps
async function getBeatenScoresByMap(client: ClientBase, scores: WsScore[]) {
	const arrays = unnestObjectsIntoArrays(scores); // TODO: scores[0] was null here and it caused an error literally once? has not happened since....
	const scoreList = await queryWithTiming<ProvenScoresPerRulesetBeatmap>(
		client,
		"getBeatenScoresByMap",
		"scores_ws",
		`
		WITH candidates AS (
			SELECT
				candidate_id,
				candidate_ruleset_id,
				candidate_beatmap_id,
				candidate_user_id,
				candidate_score
			FROM UNNEST($1::bigint[], $2::smallint[], $3::bigint[], $4::integer[], $5::bigint[])
					 AS t(candidate_id, candidate_ruleset_id, candidate_beatmap_id, candidate_user_id, candidate_score)
		),
		filtered_candidates AS (
			SELECT c.*
			FROM candidates c
			JOIN ${DB_BEATMAPS_TABLE} u
				ON u.id = c.candidate_beatmap_id
				AND u.status IN (1,2,4)
		)
		SELECT
			c.candidate_beatmap_id AS beatmap_id,
			c.candidate_ruleset_id AS ruleset_id,
			array_agg(c.candidate_user_id) AS proven_user_ids,
			array_agg(c.candidate_id) AS proven_ids
		FROM filtered_candidates c
		LEFT JOIN LATERAL (
			SELECT
				COUNT(*) AS score_count,
				MAX(position) AS max_position,
				MIN(total_score) FILTER (WHERE position BETWEEN 1 AND 100) AS min_top100_score
			FROM ${DB_SCORES_TABLE} s
			WHERE s.beatmap_id = c.candidate_beatmap_id
				AND s.ruleset_id = c.candidate_ruleset_id
		) s_agg ON true
		LEFT JOIN LATERAL (
			SELECT total_score AS user_best_score
			FROM ${DB_SCORES_TABLE} s2
			WHERE s2.beatmap_id = c.candidate_beatmap_id
				AND s2.ruleset_id = c.candidate_ruleset_id
				AND s2.user_id = c.candidate_user_id
		) u_agg ON true
		WHERE NOT (
			u_agg.user_best_score IS NOT NULL AND u_agg.user_best_score >= c.candidate_score
		) AND (
			s_agg.score_count = 0 OR
			s_agg.max_position < 100 OR
			s_agg.min_top100_score < c.candidate_score
		)
		GROUP BY c.candidate_beatmap_id, c.candidate_ruleset_id`,
		[arrays.id, arrays.ruleset_id, arrays.beatmap_id, arrays.user_id, arrays.total_score]
	);

	return scoreList.rows;
}
