import WebSocket from "ws";
import { getBeatenScores, getDbClient } from "../db.js";
import { DB_CONFIG_TABLE } from "../scripts/env.js";

const batchScores = new Array<WsScore>();
let batchLowestScoreId = -1;

export async function saveLastScoreId(scoreId = batchLowestScoreId) {
	const dbClient = await getDbClient();
	if (!dbClient) return console.error("Failed to obtain DB client to save the score id cursor: " + scoreId);
	await dbClient.query(`UPDATE ${DB_CONFIG_TABLE} SET value_text = '${scoreId}' WHERE key = 'last_ws_score_id'`);
}

async function saveScoresBatch(scores = batchScores) {
	if (!scores?.length) return;

	const fullLength = scores.length;
	console.log("Received " + fullLength + " scores");
	const beatenScores = await getBeatenScores(scores);
	console.log("beatenScores:\n", beatenScores);
	// 2. convert
	// TODO save to db
	batchScores.length = 0;
}

export async function handleScoresMessage(event: WebSocket.RawData) {
	const message = event.toString();
	if (message == "end-batch") {
		// TODO dump current in-memory batch
		// clear scoresBatch array
		// save last score id

		// TODO idkkk workers? synchronous?? for now seems to be quick enough even with the big 87k score batches
		await saveScoresBatch();
		return;
	}

	if(message == "start-batch" ) {return;}

	try {
		const score = JSON.parse(message) as WsScore;

		if (score.id) {
			if (!isCandidateScore(score)) return;
			batchLowestScoreId = score.id < batchLowestScoreId ? score.id : batchLowestScoreId;
			batchScores.push(score);
		} else {
			console.warn("skipping malformed scores-ws score:\n", score);
			// save last score id
		}
	} catch (e) {
		console.error("failed to parse scores-ws message as JSON:\n", e);
		// TODO maybe disconnect?
		// save last score id
	}
}

function isCandidateScore(score: WsScore) {
	if(!score.preserve || score.type != "solo_score")
	console.log("Possible ignoreable score:\n", score)
	return score.ruleset_id == 0 && score.passed;
}
