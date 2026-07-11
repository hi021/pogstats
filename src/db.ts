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
import { unnestObjectsIntoArrays } from "./shared.js";

export const SCORE_TABLE_COLUMNS = Object.freeze([
	"position",
	"is_scraped",
	"retrieved_at",
	"is_lazer",
	"is_perma",
	"id",
	"user_id",
	"ruleset_id",
	"beatmap_id",
	"grade",
	"accuracy",
	"max_combo",
	"total_score",
	"classic_total_score",
	"total_score_without_mods",
	"is_perfect_combo",
	"pp",
	"ended_at",
	"data"
]);

export const PLAYER_TABLE_COLUMNS = Object.freeze([
	"id",
	"username",
	"country_code",
	"is_active",
	"team_id",
	"cover_url",
	"retrieved_at",
	"is_from_osu_api",
	"is_mia"
]);

export const BEATMAP_TABLE_COLUMNS = Object.freeze([
	"id",
	"beatmapset_id",
	"status",
	"artist",
	"title",
	"version",
	"creator",
	"creator_id",
	"ruleset_id",
	"approved_date",
	"star_rating",
	"total_length",
	"bpm",
	"cs",
	"od",
	"ar",
	"hp",
	"packs"
]);

export const BEATMAP_RULESET_UPDATE_DATES_TABLE_COLUMNS = Object.freeze([
	"beatmap_id",
	"ruleset_id",
	"last_scores_scrape",
	"last_scores_update"
]);

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
	let client = null as unknown as PoolClient;
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

export function buildUpdateCoalesceAssignmentsString(columns: readonly string[], table: string) {
	let assignments = "";
	for (const i in columns) {
		if (i != "0") assignments += ",";
		assignments += `${columns[i]} = COALESCE(EXCLUDED.${columns[i]}, ${table}.${columns[i]})`;
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
	client: ClientBase,
	beatmapId: number,
	rulesetId: number,
	column: "last_scores_scrape" | "last_scores_update" = "last_scores_update"
) {
	await client.query(`
		INSERT INTO ${DB_BEATMAP_RULESET_UPDATE_DATES_TABLE} (${BEATMAP_RULESET_UPDATE_DATES_TABLE_COLUMNS.slice(0,2).join(", ")}, ${column})
		VALUES ($1, $2, NOW())
		ON CONFLICT (beatmap_id, ruleset_id) DO UPDATE SET ${column} = EXCLUDED.${column}`,
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

export async function recalculateScorePositionsForMaps(client: ClientBase, beatmaps: BeatmapRuleset[]) {
	const ids = unnestObjectsIntoArrays(beatmaps);
	return recalculateScorePositionsForMapIds(client, ids.beatmap_id, ids.ruleset_id);
}

export async function recalculateScorePositionsForMapIds(
	client: ClientBase,
	beatmapIds: number[],
	rulesetIds: RulesetId[]
) {
	if (!beatmapIds?.length || !rulesetIds?.length) return;

	await client.query(
		`
   	WITH input_raw AS (
      SELECT
        UNNEST($1::int[]) AS beatmap_id,
        UNNEST($2::int[]) AS ruleset_id
    ),
    input AS (
      SELECT beatmap_id, ruleset_id
      FROM input_raw
      GROUP BY beatmap_id, ruleset_id
    ),
    ranked AS (
      SELECT
        s.id,
        ROW_NUMBER() OVER (
          PARTITION BY s.beatmap_id, s.ruleset_id
          ORDER BY s.total_score DESC, s.ended_at ASC, s.id ASC
        ) AS pos
      FROM ${DB_SCORES_TABLE} s
      JOIN input i
        ON s.beatmap_id = i.beatmap_id
       AND s.ruleset_id = i.ruleset_id
      WHERE s.position > 0
    )
    UPDATE ${DB_SCORES_TABLE} AS s
    SET position = ranked.pos
    FROM ranked
    WHERE s.id = ranked.id`,
		[beatmapIds, rulesetIds]
	);
}

export async function getBeatmapIdsWithPlayerScores(client: ClientBase, playerIds: number[]) {
	const beatmaps: QueryResult<BeatmapRuleset> = await client.query(
		`
			SELECT beatmap_id, ruleset_id FROM ${DB_SCORES_TABLE}
			WHERE user_id = ANY($1::INTEGER[])`,
		[playerIds]
	);
	return beatmaps.rows;
}

export async function setAllPlayerScoresPosition(client: ClientBase, playerIds: number[], position = 0) {
	if (!playerIds?.length) return [];

	const beatmaps: QueryResult<BeatmapRuleset> = await client.query(
		`
		UPDATE ${DB_SCORES_TABLE} s
		SET position = $1
		WHERE s.user_id = ANY($2::INTEGER[])
		RETURNING s.beatmap_id, s.ruleset_id`,
		[position, playerIds]
	);
	return beatmaps.rows;
}

export async function findNoLongerMiaPlayerIds(client: ClientBase) {
	const result: QueryResult<{ id: number }> = await client.query(`
		SELECT p.id FROM ${DB_PLAYERS_TABLE} p
		JOIN ${DB_PLAYER_MIA_HISTORY_TABLE} h ON h.user_id = p.id AND h.end_date IS NULL
		WHERE p.is_mia = false`);

	return result.rows.map(row => row.id);
}

export async function insertNewMiaPlayers(client: ClientBase, miaPlayers: Map<number, Date>) {
	if (!miaPlayers?.size) return;

	const paramGroups = [];
	const values = [];
	let i = 0;

	for (const [userId, startDate] of miaPlayers) {
		paramGroups.push(`($${++i}::INTEGER, $${++i}::TIMESTAMPTZ)`);
		values.push(userId, startDate);
	}

	await client.query(
		`
		WITH input(user_id, start_date) AS (
      VALUES ${paramGroups.join(",")}
    )
    INSERT INTO ${DB_PLAYER_MIA_HISTORY_TABLE} (user_id, start_date)
    SELECT i.user_id, i.start_date
    FROM input i
    WHERE NOT EXISTS (
      SELECT 1
      FROM ${DB_PLAYER_MIA_HISTORY_TABLE} h
      WHERE h.user_id = i.user_id
        AND h.end_date IS NULL
    )`,
		values
	);
}

export async function insertNoLongerMiaPlayers(client: ClientBase, miaPlayerIds: number[]) {
	if (!miaPlayerIds?.length) return;

	await client.query(
		`
    UPDATE ${DB_PLAYER_MIA_HISTORY_TABLE} h
    SET end_date = NOW()
    WHERE h.user_id = ANY($1::INTEGER[])
      AND h.end_date IS NULL`,
		[miaPlayerIds]
	);
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
