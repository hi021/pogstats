import { ClientBase } from "pg";
import { withDbClient } from "../db-generic.js";
import { DB_PLAYER_MIA_HISTORY_TABLE, DB_PLAYERS_TABLE } from "../env.js";

async function createTables(client: ClientBase) {
	console.log(`Attempting to create ${DB_PLAYERS_TABLE} and ${DB_PLAYER_MIA_HISTORY_TABLE} tables`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_PLAYERS_TABLE} (
			id 							INTEGER PRIMARY KEY,
			username				TEXT NOT NULL,
			country_code		CHAR(2) NOT NULL,
			is_active				BOOLEAN NOT NULL,
			team_id					INTEGER,
			cover_url				TEXT,
			retrieved_at		TIMESTAMPTZ NOT NULL,
			is_from_osu_api	BOOLEAN NOT NULL,
			is_mia				 	BOOLEAN DEFAULT FALSE
    )`);
	// TODO?: team_id FK constraint if adding teams

	// TODO?: figure out if username should be indexed for pg_trgm fuzzy search - gin(username gin_trgm_ops)?
	await client.query(`
		CREATE INDEX CONCURRENTLY IF NOT EXISTS ${DB_PLAYERS_TABLE}_country_code_idx 			ON ${DB_PLAYERS_TABLE}(country_code);
		CREATE INDEX CONCURRENTLY IF NOT EXISTS ${DB_PLAYERS_TABLE}_not_mia_id_idx				ON ${DB_PLAYERS_TABLE}(id) WHERE is_mia = false;`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_PLAYER_MIA_HISTORY_TABLE} (
			user_id			INTEGER NOT NULL,
			start_date 	TIMESTAMPTZ NOT NULL,
			end_date 		TIMESTAMPTZ,

			PRIMARY KEY (user_id, start_date),
			CONSTRAINT player_mia_history_user_fk FOREIGN KEY(user_id) REFERENCES ${DB_PLAYERS_TABLE}(id)
	)`);

	await client.query(`
		CREATE INDEX CONCURRENTLY IF NOT EXISTS ${DB_PLAYER_MIA_HISTORY_TABLE}_user_id_idx 	ON ${DB_PLAYER_MIA_HISTORY_TABLE}(user_id);
		CREATE INDEX CONCURRENTLY IF NOT EXISTS ${DB_PLAYER_MIA_HISTORY_TABLE}_open_idx 		ON ${DB_PLAYER_MIA_HISTORY_TABLE}(user_id) WHERE end_date IS NULL;
		CREATE INDEX CONCURRENTLY IF NOT EXISTS ${DB_PLAYER_MIA_HISTORY_TABLE}_latest_idx 	ON ${DB_PLAYER_MIA_HISTORY_TABLE}(user_id, start_date DESC);
	`);

	// TODO: it would be cool to store this, but the main /user endpoint has a high cost (high rate limit), using simple /lookup for now
	// await client.query(`
	//   CREATE TABLE IF NOT EXISTS ${DB_PLAYER_RULESET_STATS_TABLE} (
	// 		user_id 				INTEGER NOT NULL,
	// 		ruleset_id 			SMALLINT NOT NULL,
	// 		play_count			INTEGER NOT NULL,
	// 		play_time				INTEGER NOT NULL,
	// 		pp							REAL NOT NULL,
	// 		rank						INTEGER,
	// 		ranked_score		BIGINT NOT NULL,
	// 		ss_count				INTEGER DEFAULT 0,
	// 		ssh_count				INTEGER DEFAULT 0,
	// 		s_count					INTEGER DEFAULT 0,
	// 		sh_count				INTEGER DEFAULT 0,
	// 		a_count					INTEGER DEFAULT 0,

	// 		PRIMARY KEY (user_id, ruleset_id),
	// 		CONSTRAINT ruleset_stats_user_fk FOREIGN KEY (user_id)
	// 		REFERENCES ${DB_PLAYERS_TABLE} (id)
	//   )`);

	console.log(`Created ${DB_PLAYERS_TABLE} and ${DB_PLAYER_MIA_HISTORY_TABLE} tables if didn't exist`);
}

async function main() {
	try {
		await withDbClient(async client => await createTables(client));
	} catch (e) {
		console.error("Error creating tables:\n", e);
	}
}

main();
