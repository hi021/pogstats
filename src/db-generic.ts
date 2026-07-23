import { Pool, PoolClient, types } from "pg";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from "./env.js";

// TODO: build from SCORE_TABLE_COLUMNS
export const SCORE_TABLE_COLUMNS_ALL = Object.freeze([
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

export const SCORE_TABLE_COLUMNS = Object.freeze([
	"position",
	"is_scraped",
	"retrieved_at",
	"is_lazer",
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
	"packs",
	"updated_at"
]);

export const BEATMAP_TABLE_COLUMNS_ALL = Object.freeze([
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
	"packs",
	"updated_at"
]);

export const HISTORICAL_PLAYER_SNIPES_TABLE_COLUMNS_ALL = Object.freeze([
	"id",
	"user_id",
	"score_id",
	"sniped_by",
	"sniped_with",
	"beatmap_id",
	"ruleset_id",
	"position_threshold",
	"date"
]);

export const HISTORICAL_PLAYER_SNIPES_TABLE_COLUMNS = Object.freeze([
	"user_id",
	"score_id",
	"sniped_by",
	"sniped_with",
	"beatmap_id",
	"ruleset_id",
	"position_threshold",
	"date"
]);

export const BEATMAP_RULESET_UPDATE_DATES_TABLE_COLUMNS = Object.freeze([
	"beatmap_id",
	"ruleset_id",
	"last_scores_scrape",
	"last_scores_update"
]);

// This isn't always respected? Still have to map BIGINT ids to Number in getBeatenScoresByMap
// node-pg returns BIGINTs as strings since numbers over 2^53 (9+E15) lose precision when stored as doubles
// ignoring this concern here, since score ids are in the billions and ranked score is in the trillions
// osu! api just returns normal numbers anyway
types.setTypeParser(20 /* = TypeId.INT8 (BIGINT) - enums suck, this wouldn't transpile */, val =>
	val == null ? null : Number(val)
);

export const dbPool = new Pool({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME,
	min: 2,
	connectionTimeoutMillis: 20000,
	allowExitOnIdle: true
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

export async function closePool() {
	dbPool.end();
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
