import { ClientBase, Pool, PoolClient, QueryResult, types } from "pg";
import {
	DB_BEATMAP_RULESET_UPDATE_DATES_TABLE,
	DB_BEATMAPS_TABLE,
	DB_CONFIG_TABLE,
	DB_HOST,
	DB_NAME,
	DB_PASSWORD,
	DB_PLAYER_MIA_HISTORY_TABLE,
	DB_PLAYERS_TABLE,
	DB_PORT,
	DB_SCORES_TABLE,
	DB_USER,
	DEV_ENV
} from "./env.js";

// TODO make sure this is respected in every script? I assume you have to make them use the dbPool here

// TODO I dont think this SHIT works

// pg returns BIGINTs as strings since numbers over 2^53 (9+E15) lose precision when stored as doubles
// ignoring this concern here, since score ids are in the billions and ranked score is in the trillions
// osu! api just returns normal numbers anyway
types.setTypeParser(20 /* TypeId.INT8 - BIGINT - enums suck, this wouldn't transpile */, val =>
	val == null ? null : Number(val)
);

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

export async function withDbClientTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
	return await withDbClient(async client => {
		await client.query("BEGIN");
		try {
			const result = await callback(client);
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		}
	});
}

export function buildBeatmapAdvisoryLockKey(beatmapId: number, rulesetId: number) {
	return (BigInt(beatmapId) << 32n) | BigInt(rulesetId);
}

export async function acquireBeatmapAdvisoryLock(client: PoolClient, beatmapId: number, rulesetId: number) {
	const lockKey = buildBeatmapAdvisoryLockKey(beatmapId, rulesetId);
	await client.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);
}

export function buildUpdateAssignmentsString(columns: readonly string[]) {
	let assignments = "";
	for (const i in columns) {
		if (i != "0") assignments += ",";
		assignments += `${columns[i]} = EXCLUDED.${columns[i]}`;
	}
	return assignments;
}

export async function closePool() {
	dbPool.end();
}

// Saving the lowest score id from given batch just to be safe for now - probably unnecessary, as the ids seem to be ordered
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

export async function updateBeatmapScoresRetrievalDate(
	beatmapId: number,
	rulesetId: number,
	column: "last_scores_scrape" | "last_scores_update" = "last_scores_update"
) {
	await dbPool.query(
		`UPDATE ${DB_BEATMAP_RULESET_UPDATE_DATES_TABLE} SET ${column} = NOW() WHERE beatmap_id = $1 AND ruleset_id = $2`,
		[beatmapId, rulesetId]
	);
}

export async function getInexistentPlayerIds(playerIds: number[]) {
	return (
		await dbPool.query(
			`WITH input_ids AS (SELECT DISTINCT unnest($1::integer[]) AS id)
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
			`WITH input_ids AS (SELECT DISTINCT unnest($1::bigint[]) AS id)
			SELECT i.id FROM input_ids i
			LEFT JOIN ${DB_BEATMAPS_TABLE} b ON b.id = i.id
			WHERE b.id IS NULL`,
			[beatmapIds]
		)
	).rows.map(r => r.id) as number[];
}

export async function recalculateScorePositionsForMaps(client: ClientBase, beatmapIds: number[], rulesetIds: number[]) {
	await client.query(
		`WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY beatmap_id, ruleset_id
          ORDER BY total_score DESC, ended_at ASC, id ASC
        ) AS pos
      FROM ${DB_SCORES_TABLE}
      WHERE beatmap_id IN ($1)
        AND ruleset_id IN ($2)
				AND position > 0
    )
    UPDATE ${DB_SCORES_TABLE} s
    SET position = ranked.pos
    FROM ranked
    WHERE s.id = ranked.id`,
		[beatmapIds, rulesetIds]
	);
}

export async function getBeatmapIdsWithPlayerScores(
	client: ClientBase,
	playerIds: number[]
): Promise<Array<{ beatmap_id: number; ruleset_id: number }>> {
	return (
		(await client.query(
			`
		SELECT beatmap_id, ruleset_id FROM ${DB_SCORES_TABLE}
		WHERE user_id IN ($1)`,
			[playerIds]
		)) as QueryResult<{ beatmap_id: number; ruleset_id: number }>
	).rows;
}

export async function setAllPlayerScoresToPosition(client: ClientBase, playerIds: number[], position = 0) {
	await client.query(
		`
		UPDATE ${DB_SCORES_TABLE}
		SET position = $1
		WHERE user_id IN ($2)`,
		[position, playerIds]
	);
}

export async function findNoLongerMiaPlayerIds(client: ClientBase) {
	const nonMiaPlayerIds = new Array<number>();
	// end_date in mia history is null, but is_mia in players is false?

	return nonMiaPlayerIds;
}

export async function insertNewMiaPlayers(client: ClientBase, miaPlayers: Map<number, Date>) {
	const paramGroups = [];
	const values = [];
	let i = 0;

	for (const [userId, startDate] of miaPlayers) {
		paramGroups.push(`($${++i}, $${++i})`);
		values.push(userId, startDate);
	}

	const sql = `
    WITH incoming(user_id, start_date) AS (
      VALUES ${paramGroups.join(",")}
    )
    INSERT INTO ${DB_PLAYER_MIA_HISTORY_TABLE} (user_id, start_date)
    SELECT i.user_id, i.start_date
    FROM incoming i
    WHERE NOT EXISTS (
      SELECT 1
      FROM ${DB_PLAYER_MIA_HISTORY_TABLE} h
      WHERE h.user_id = i.user_id
        AND h.end_date IS NULL
    );
  `;

	await client.query(sql, values);
}

export async function insertNoLongerMiaPlayers(client: ClientBase, miaPlayers: Map<number, Date>) {
	const paramGroups = [];
	const values = [];
	let i = 0;

	for (const [userId, endDate] of miaPlayers) {
		paramGroups.push(`($${++i}, $${++i})`);
		values.push(userId, endDate);
	}

	const sql = `
    WITH incoming(user_id, end_date) AS (
      VALUES ${paramGroups.join(",")}
    )
    UPDATE ${DB_PLAYER_MIA_HISTORY_TABLE} h
    SET end_date = i.end_date
    FROM incoming i
    WHERE h.user_id = i.user_id
      AND h.end_date IS NULL;
  `;

	await client.query(sql, values);
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
