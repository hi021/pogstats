import https from "https";
import { QueryResult } from "pg";
import WebSocket from "ws";
import {
	convertToBeatenScoreParamObject,
	dbPool,
	getInexistentBeatmapIds,
	getInexistentPlayerIds,
	getLastScoreId,
	saveLastScoreId
} from "../db.js";
import { DB_SCORES_TABLE, DEV_ENV, VERBOSE } from "../scripts/env.js";
import { convertApiScore, ParsedFlags, sleep, sortWsScores } from "../shared.js";
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
			console.error("failed to process scores-ws scores:\n", e);
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
		process.exit(1);
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

	// TODO fetch missing maps & players
	const missingBeatmaps = await getMissingBeatmaps(batchCandidateBeatmapIds);
	const missingPlayers = await getMissingPlayers(batchCandidatePlayerIds);

	// TODO move to function
	const beatenScoresByMap = await getBeatenScoresByMap(scores);
	console.log("beatenScoresByMap:\n", beatenScoresByMap); // TODO only for debug

	let provenScoreCount = 0;
	for(const {beatenScores} of beatenScoresByMap) {
	const provenScoreIds = Object.keys(beatenScores);
	
	const provenScores = scores.filter(it => provenScoreIds.includes(it.id.toString())).sort(sortWsScores);
	console.log(provenScores); // TODO only for debug
	provenScoreCount += provenScores.length;
	
	for(let i in provenScores) {
		const provenScore = provenScores[i];
		
	}
	// TODO handle multiple scores on the same map - group per map and sort per position, add 0-based index to position
	const convertedScores = provenScores.map(score =>
		convertApiScore(score, beatenScores[score.id.toString()].position, false)
	);
	if(provenScoreCount >= 2) console.log(`${provenScoreCount} on one map - ${convertedScores[0].beatmapId}!!`) // TODO debug only

	if (VERBOSE) console.log(`Found ${provenScoreCount} beaten top 100 score(s)`);
}

	// TODO save to db
	// TODO update existing scores' positions

	saveLastScoreId(batchLowestScoreId);
	batchLowestScoreId = Infinity;
	batchTotalScoreCount = 0;
	scores.length = 0;
}

function isCandidateScore(score: WsScore) {
	if (!score.preserve || score.type != "solo_score") console.log("Possible ignoreable score:\n", score);
	return score.ruleset_id == 0 && score.passed;
}

async function getMissingBeatmaps(beatmapIds: number[]) {
	const missingIds = await getInexistentBeatmapIds(beatmapIds);
	if (VERBOSE) console.log(`Found ${missingIds.length} new beatmap id(s) not in the database`);

	batchCandidateBeatmapIds.length = 0;
}

async function getMissingPlayers(playerIds: number[]) {
	const missingIds = await getInexistentPlayerIds(playerIds);
	if (VERBOSE) console.log(`Found ${missingIds.length} new player id(s) not in the database`);

	batchCandidatePlayerIds.length = 0;
}

async function getBeatenScoresByMap(scores: WsScore[]) {
	const paramObj = convertToBeatenScoreParamObject(scores);
	const scoreList: QueryResult<{ beatenScores: Record<string, BeatenBeatmapScore> }> = await dbPool.query(
		`WITH candidates AS
				(SELECT candidate_id, candidate_ruleset_id, candidate_beatmap_id, candidate_user_id, candidate_score
				FROM UNNEST($1::bigint[], $2::smallint[], $3::bigint[], $4::integer[], $5::bigint[])
				AS t(candidate_id, candidate_ruleset_id, candidate_beatmap_id, candidate_user_id, candidate_score)
  		), results AS
				(SELECT c.candidate_beatmap_id,
								c.candidate_ruleset_id,
								c.candidate_id,
								c.candidate_user_id,
								beaten.id,
								beaten.position
					FROM candidates c
					LEFT JOIN LATERAL (
							SELECT id, position
							FROM ${DB_SCORES_TABLE} s
							WHERE s.beatmap_id = c.candidate_beatmap_id
								AND s.ruleset_id = c.candidate_ruleset_id
								AND s.position <= 100
								AND s.total_score < c.candidate_score
							ORDER BY s.position ASC
							LIMIT 1
					) beaten ON TRUE
					WHERE beaten.id IS NOT NULL
			) SELECT jsonb_object_agg(candidate_id, to_jsonb(results.*)) AS beatenScores
				FROM results
				GROUP BY results.candidate_beatmap_id, results.candidate_ruleset_id`,
		[paramObj.ids, paramObj.rulesets, paramObj.beatmaps, paramObj.users, paramObj.totalScores]
	);

	return scoreList.rows;
}
