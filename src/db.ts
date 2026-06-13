import { Pool, PoolClient, QueryResult } from "pg";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_SCORES_TABLE, DB_USER } from "./scripts/env.js";

const dbPool = new Pool({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME
});

const clientMap = new Map<string, PoolClient>();

export async function getDbClient(tag: string) {
	try {
		if (clientMap.has(tag)) return clientMap.get(tag);
		clientMap.set(tag, await dbPool.connect());
		return clientMap.get(tag)?.connect();
	} catch (e) {
		console.error("Failed to get postgres pool client:\n", e);
	}
}

export async function closePool() {
	dbPool.end();
}

export async function getScoresForMaps(beatmapIds: number[], rulesetId = 0) {
	const dbClient = await getDbClient("getScoresForMaps");
	if (!dbClient) return console.error("Failed to obtain DB client to get map scores");

	const scoreList: QueryResult<BeatmapScoreFull> = await dbClient.query(
		`SELECT * FROM ${DB_SCORES_TABLE} WHERE beatmap_id IN ($1) AND ruleset_id = $2`,
		[beatmapIds, rulesetId]
	);
	console.log(scoreList.rows);
}

export async function getInexistentPlayers(playerIds: number[]) {
	// filtered scores that need player data (players not in db)
}
