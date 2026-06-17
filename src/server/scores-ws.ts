import https from "https";
import WebSocket from "ws";
import { getBeatenScores, getDbClient } from "../db.js";
import { DB_CONFIG_TABLE, DEV_ENV } from "../scripts/env.js";

const SCORES_WS_URL = "wss://ushio.chiffa.lol";
const SCORES_WS_PING_INTERVAL = 30000;

const batchScores = new Array<WsScore>();
const batchPlayerIds = new Array<number>();
const batchBeatmapIds = new Array<number>();
let batchLowestScoreId = -1;

const scoresWsPing = setInterval(
	() => scoresWs.readyState === WebSocket.OPEN && scoresWs.ping(),
	SCORES_WS_PING_INTERVAL
);
const agent = new https.Agent({ keepAlive: true, sessionTimeout: 900, rejectUnauthorized: DEV_ENV });
export const scoresWs = new WebSocket(SCORES_WS_URL, { agent });

export function scoresWsOnClose(code: number, reason: Buffer) {
	console.log("scores-ws connection closed:", code, reason?.toString());
	clearInterval(scoresWsPing);
	saveLastScoreId();
}

export function scoresWsOnError(e: Error) {
	console.error("scores-ws error:\n", e);
	saveLastScoreId();
}

export async function saveLastScoreId(scoreId = batchLowestScoreId) {
	const dbClient = await getDbClient();
	if (!dbClient) return console.error("Failed to obtain DB client to save the score id cursor: " + scoreId);
	await dbClient.query(`UPDATE ${DB_CONFIG_TABLE} SET value_text = '${scoreId}' WHERE key = 'last_ws_score_id'`);
}

async function saveScoresBatch(scores = batchScores) {
	if (!scores?.length) return;

	const fullLength = scores.length;
	console.log(`Received ${fullLength} candidate scores`);
	const beatenScores = await getBeatenScores(scores);
	console.log("beatenScores:\n", beatenScores);
	// 2. convert
	// TODO save to db
	batchScores.length = 0;
}

export async function scoresWsOnMessage(event: WebSocket.RawData) {
	const message = event.toString();
	if (message === "start-batch") return;
	if (message === "end-batch") {
		try {
			// TODO idkkk workers? synchronous?? for now seems to be quick enough even with the big 87k score batches
			await saveScoresBatch();
			saveLastScoreId();
			return;
		} catch (e) {
			console.error("failed to process scores-ws scores:\n", e);
		}
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
		saveLastScoreId();
	}
}

function isCandidateScore(score: WsScore) {
	if (!score.preserve || score.type != "solo_score") console.log("Possible ignoreable score:\n", score);
	return score.ruleset_id == 0 && score.passed;
}
