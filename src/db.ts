import { Pool, QueryResult } from "pg";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_SCORES_TABLE, DB_USER } from "./scripts/env.js";

const dbPool = new Pool({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME
});

export async function getDbClient() {
	try {
		return await dbPool.connect();
	} catch (e) {
		console.error("Failed to get postgres pool client:\n", e);
	}
}

export async function closePool() {
	dbPool.end();
}

export async function getBeatenScores(scores: WsScore[]) {
	const dbClient = await getDbClient();
	if (!dbClient) {
		 console.error("Failed to obtain DB client to get beaten map scores");
		 return [];
	}

	const paramObj = convertToBeatenScoreParamObject(scores);
	const scoreList: QueryResult<BeatmapScoreFull> = await dbClient.query(
		`WITH candidates AS (SELECT candidate_id, candidate_ruleset_id, candidate_beatmap_id, candidate_user_id, candidate_score
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

	return scoreList.rows;
}

type BeatenScoreParams = {ids: number[], rulesets: number[], beatmaps: number[], users: number[], totalScores: number[]};
function convertToBeatenScoreParamObject(scores: WsScore[]) {
	const ids = new Array<number>(scores.length);
	const rulesets = new Array<number>(scores.length);
	const beatmaps = new Array<number>(scores.length);
	const users = new Array<number>(scores.length);
	const totalScores = new Array<number>(scores.length);

	for (let i = 0; i < scores.length; ++i) {
		const score = scores[i];
		ids[i] = score.id;
		rulesets[i] = score.ruleset_id;
		beatmaps[i] = score.beatmap_id;
		users[i] = score.user_id;
		totalScores[i] = score.total_score;
	}
	return {ids, rulesets, beatmaps, users, totalScores} as BeatenScoreParams;
}

export async function getInexistentPlayers(playerIds: number[]) {
	// filtered scores that need player data (players not in db)
}

export async function getInexistentBeatmaps(beatmapIds: number[]) {
}
