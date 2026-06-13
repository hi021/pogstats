import WebSocket from "ws";
import { getDbClient } from "../db.js";
import { DB_CONFIG_TABLE } from "../scripts/env.js";

const batchScores = new Array<WsScore>(1550);
const batchBeatmapIds = new Set<number>();
let batchLowestScoreId = -1;

export async function saveLastScoreId(scoreId: number) {
	const dbClient = await getDbClient("scores-ws-score-id");
	if (!dbClient) return console.error("Failed to obtain DB client to save the score id cursor: " + scoreId);
	await dbClient.query(`UPDATE ${DB_CONFIG_TABLE} SET value_text = '${scoreId}' WHERE key = 'last_ws_score_id'`);
}

export function saveScoresBatch(scores: Array<WsScore>) {
	if (!scores?.length) return;

	const fullLength = scores.length;
	// 1. filter
	// 2. convert
	// 3. save to db
	console.log("saving");
}

function filterTop100Scores(scores: Array<WsScore>) {}

export function handleScoresMessage(event: WebSocket.RawData) {
	const message = event.toString();
	if (message == "start-batch" || message == "end-batch") {
		// TODO dump current in-memory batch
		// clear scoresBatch array
		// save last score id
		return;
	}

	try {
		const score = JSON.parse(message) as WsScore;

		if (score.id) {
			batchLowestScoreId = score.id < batchLowestScoreId ? score.id : batchLowestScoreId;
			batchBeatmapIds.add(score.beatmap_id);
		} else {
			console.warn("skipping malformed scores-ws score:\n", score);
			// save last score id
		}
	} catch (e) {
		console.error("scores-ws failed to parse score JSON:\n", e);
		// TODO maybe disconnect?
		// save last score id
	}
}
