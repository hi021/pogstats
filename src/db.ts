import { Pool, PoolClient, types } from "pg";
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

// TODO make sure this is respected in every script? I assume you have to make them use the dbPool here

// pg returns BIGINTs as strings since numbers over 2^53 (9+E15) lose precision when stored as doubles
// ignoring this concern here, since score ids are in the billions and ranked score is in the trillions
// osu! api just returns normal numbers anyway
types.setTypeParser(20 /* TypeId.INT8 - BIGINT - enums suck, this wouldn't transpile */, val =>
	val == null ? null : Number(val)
);

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

export async function saveLastScoreId(scoreId: number) {
	if (isNaN(scoreId) || !isFinite(scoreId)) return;
	await dbPool.query(`UPDATE ${DB_CONFIG_TABLE} SET value_text = '${scoreId}' WHERE key = 'last_ws_score_id'`);
}

export async function getLastScoreId() {
	return Number(
		(await dbPool.query(`SELECT value_text FROM ${DB_CONFIG_TABLE} WHERE key = 'last_ws_score_id'`)).rows?.[0]
			?.value_text || 0
	);
}

export async function getInexistentPlayerIds(playerIds: number[]) {
	return (
		await dbPool.query(
			`
			WITH input_ids AS (SELECT DISTINCT unnest($1::integer[]) AS id)
			SELECT i.id FROM input_ids i
			LEFT JOIN ${DB_PLAYERS_TABLE} u ON u.id = i.id
			WHERE u.id IS NULL`,
			[playerIds]
		)
	).rows.map(r => r.id) as number[];
}

export async function getInexistentBeatmapIds(beatmapIds: number[]) {
	return (
		await dbPool.query(
			`
			WITH input_ids AS (SELECT DISTINCT unnest($1::bigint[]) AS id)
			SELECT i.id FROM input_ids i
			LEFT JOIN ${DB_BEATMAPS_TABLE} b ON b.id = i.id
			WHERE b.id IS NULL`,
			[beatmapIds]
		)
	).rows.map(r => r.id) as number[];
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
