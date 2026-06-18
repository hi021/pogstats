import { Pool, PoolClient } from "pg";
import {
	DB_BEATMAPS_TABLE,
	DB_CONFIG_TABLE,
	DB_HOST,
	DB_NAME,
	DB_PASSWORD,
	DB_PLAYERS_TABLE,
	DB_PORT,
	DB_USER,
	DEV_ENV
} from "./scripts/env.js";

export const dbPool = new Pool({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME,
	min: 1,
	connectionTimeoutMillis: 20000,
	allowExitOnIdle: DEV_ENV
});

export async function withDbClient<T>(callback: (client: PoolClient) => Promise<T>) {
	let client: PoolClient = null as unknown as PoolClient;
	try {
		client = await dbPool.connect();
	} catch (e) {
		console.error("Failed to connect to postgres pool client:\n", e);
	}

	try {
		return await callback(client);
	} finally {
		client.release();
	}
}

export async function closePool() {
	dbPool.end();
}

export async function saveLastScoreId(scoreId: number | string) {
	await dbPool.query(`UPDATE ${DB_CONFIG_TABLE} SET value_text = '${scoreId}' WHERE key = 'last_ws_score_id'`);
}

export async function getLastScoreId() {
	return Number(
		(await dbPool.query(`SELECT value_text FROM ${DB_CONFIG_TABLE} WHERE key = 'last_ws_score_id'`)).rows?.[0] || 0
	);
}

export async function getInexistentPlayers(playerIds: number[]) {
	return (
		await dbPool.query(
			`
			WITH input_ids AS (SELECT DISTINCT unnest($1::integer[]) AS id)
			SELECT i.id FROM input_ids i
			LEFT JOIN ${DB_PLAYERS_TABLE} u ON u.id = i.id
			WHERE u.id IS NULL`,
			[playerIds]
		)
	).rows as number[];
}

export async function getInexistentBeatmaps(beatmapIds: number[]) {
	return (
		await dbPool.query(
			`
			WITH input_ids AS (SELECT DISTINCT unnest($1::bigint[]) AS id)
			SELECT i.id FROM input_ids i
			LEFT JOIN ${DB_BEATMAPS_TABLE} b ON b.id = i.id
			WHERE b.id IS NULL`,
			[beatmapIds]
		)
	).rows as number[];
}

type BeatenScoreParams = {
	ids: number[];
	rulesets: number[];
	beatmaps: number[];
	users: number[];
	totalScores: number[];
};
export function convertToBeatenScoreParamObject(scores: WsScore[]) {
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
	return { ids, rulesets, beatmaps, users, totalScores } as BeatenScoreParams;
}
