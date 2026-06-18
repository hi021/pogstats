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
import { ParsedFlags } from "../shared.js";
import { FLAG_DEFINITIONS } from "./main.js";

const SCORES_WS_URL = "wss://ushio.chiffa.lol";
const SCORES_WS_PING_INTERVAL = 30000;

const batchScores = new Array<WsScore>();
const batchPlayerIds = new Array<number>();
const batchBeatmapIds = new Array<number>();
let batchLowestScoreId = Infinity;

const scoresWsPing = setInterval(
	() => scoresWs.readyState === WebSocket.OPEN && scoresWs.ping(),
	SCORES_WS_PING_INTERVAL
);
const agent = new https.Agent({ keepAlive: true, sessionTimeout: 900, rejectUnauthorized: DEV_ENV });
export const scoresWs = new WebSocket(SCORES_WS_URL, { agent });

export async function scoresWsOnOpen(parsedFlags: ParsedFlags<typeof FLAG_DEFINITIONS>) {
	const cursorScoreId = await getCursorScoreId(parsedFlags.cursorScoreId);
	console.log(`connecting to scores-ws with cursor score id: ${cursorScoreId}`);
	scoresWs.send(cursorScoreId);
}

export function scoresWsOnClose(code: number, reason: Buffer) {
	console.log("scores-ws connection closed:", code, reason?.toString());
	clearInterval(scoresWsPing);
	saveLastScoreId(batchLowestScoreId);
}

export function scoresWsOnError(e: Error) {
	console.error("scores-ws error:\n", e);
	saveLastScoreId(batchLowestScoreId);
}

export async function scoresWsOnMessage(event: WebSocket.RawData) {
	const message = event.toString();
	if (message === "start-batch") return;
	if (message === "end-batch") {
		try {
			// TODO idkkk workers? synchronous?? for now seems to be quick enough even with the big 87k score batches
			await saveScoresBatch();
			saveLastScoreId(batchLowestScoreId);
		} catch (e) {
			console.error("failed to process scores-ws scores:\n", e);
		}
		return;
	}

	try {
		const score = JSON.parse(message) as WsScore;

		if (score.id) {
			if (!isCandidateScore(score)) return;
			batchLowestScoreId = score.id < batchLowestScoreId ? score.id : batchLowestScoreId;
			batchScores.push(score);
			batchPlayerIds.push(score.user_id);
			batchBeatmapIds.push(score.beatmap_id);
		} else {
			console.warn("skipping malformed scores-ws score:\n", score);
		}
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
		console.error(`Invalid cursorScoreId, must be a non-negative number: ${cursorScoreIdCli}`);
		process.exit(1);
	}
	return parsed;
}

async function saveScoresBatch(scores = batchScores) {
	if (!scores?.length) return;

	const fullLength = scores.length;
	console.log(`Received ${fullLength} candidate scores`);

	// TODO fetch missing maps & players
	const missingBeatmaps = await getMissingBeatmaps(batchBeatmapIds);
	const missingPlayers = await getMissingPlayers(batchPlayerIds);

	const beatenScores = await getBeatenScores(scores);
	console.log("beatenScores:\n", beatenScores);
	// TODO convert
	// TODO save to db
	batchScores.length = 0;
}

function isCandidateScore(score: WsScore) {
	if (!score.preserve || score.type != "solo_score") console.log("Possible ignoreable score:\n", score);
	return score.ruleset_id == 0 && score.passed;
}

async function getMissingBeatmaps(beatmapIds: number[]) {
	const missingIds = await getInexistentBeatmapIds(beatmapIds);
	console.log(`Found ${missingIds.length} new beatmap id(s) not in the database`);

	batchBeatmapIds.length = 0;
}

async function getMissingPlayers(playerIds: number[]) {
	const missingIds = await getInexistentPlayerIds(playerIds);
	console.log(`Found ${missingIds.length} new player id(s) not in the database`);

	batchPlayerIds.length = 0;
}

async function getBeatenScores(scores: WsScore[]) {
	const paramObj = convertToBeatenScoreParamObject(scores);
	const scoreList: QueryResult<BeatmapScoreFull> = await dbPool.query(
		`WITH candidates AS (
			SELECT candidate_id, candidate_ruleset_id, candidate_beatmap_id, candidate_user_id, candidate_score
			FROM UNNEST($1::bigint[], $2::smallint[], $3::bigint[], $4::integer[], $5::bigint[])
			AS t(candidate_id, candidate_ruleset_id, candidate_beatmap_id, candidate_user_id, candidate_score))
			SELECT c.candidate_beatmap_id, c.candidate_id, c.candidate_user_id, beaten.id, beaten.position
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
			WHERE beaten.id IS NOT NULL`,
		[paramObj.ids, paramObj.rulesets, paramObj.beatmaps, paramObj.users, paramObj.totalScores]
	);

	if (VERBOSE) console.log(`Found ${scoreList.rowCount} beaten top 100 scores`);
	return scoreList.rows;
}
