import { Pool, QueryResult } from "pg";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_SCORES_TABLE, DB_USER } from "./scripts/env.js";

const dbPool = new Pool({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME
});

export async function getDbClient(tag: string) {
	try {
		return await dbPool.connect();
	} catch (e) {
		console.error("Failed to get postgres pool client:\n", e);
	}
}

export async function closePool() {
	dbPool.end();
}

// export async function getScoresForMaps(beatmapIds: number[], rulesetId = 0) {
// 	const dbClient = await getDbClient("getScoresForMaps");
// 	if (!dbClient) return console.error("Failed to obtain DB client to get map scores");

// 	const scoreList: QueryResult<BeatmapScoreFull> = await dbClient.query(
// 		`SELECT * FROM ${DB_SCORES_TABLE} WHERE beatmap_id IN ($1) AND ruleset_id = $2`,
// 		[beatmapIds, rulesetId]
// 	);
// 	console.log(scoreList.rows);
// }

export async function getBeatenScores(scores: WsScore[]) {
	const dbClient = await getDbClient("getBeatenScores");
	if (!dbClient) return console.error("Failed to obtain DB client to get beaten map scores");

	// TODO error: bind message has 36404 parameter formats but 0 parameters
	const paramTuple = convertToBeatenScoreParamTuple(scores);
	const scoreSqlPlaceholders = paramTuple
		.map(
			(_, i) =>
				`($${i * 5 + 1}::BIGINT, $${i * 5 + 2}::SMALLINT, $${i * 5 + 3}::BIGINT, $${i * 5 + 4}::INTEGER, $${i * 5 + 5}::INTEGER)`
		)
		.join(",");
	const scoreList: QueryResult<BeatmapScoreFull> = await dbClient.query(
		`WITH candidates (candidate_id, candidate_ruleset_id, candidate_beatmap_id, candidate_user_id, candidate_score)
		AS (VALUES ${scoreSqlPlaceholders})
		select
			c.candidate_beatmap_id,
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
		) beaten ON TRUE`,
		paramTuple.flat()
	);
	console.log(scoreList.rows);
}

type BeatenScoreParams = [number, number, number, number, number];
function convertToBeatenScoreParamTuple(scores: WsScore[]) {
	const tuple = new Array<BeatenScoreParams>(scores.length);
	for (let i = 0; i < tuple.length; ++i) {
		const score = scores[i];
		tuple[i] = [score.id, score.ruleset_id, score.beatmap_id, score.user_id, score.total_score];
	}
	return tuple;
}

export async function getInexistentPlayers(playerIds: number[]) {
	// filtered scores that need player data (players not in db)
}
