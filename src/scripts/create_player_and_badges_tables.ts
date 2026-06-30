import { Client } from "pg";
import {
	DB_HOST,
	DB_NAME,
	DB_PASSWORD,
	DB_PLAYER_POG_BADGES_TABLE,
	DB_PLAYER_RULESET_STATS_TABLE,
	DB_PLAYERS_TABLE,
	DB_POG_BADGES_TABLE,
	DB_PORT,
	DB_USER
} from "./env.js";

const client = new Client({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME
});

async function createTables() {
	console.log(
		`Attempting to create ${DB_PLAYERS_TABLE}, ${DB_PLAYER_RULESET_STATS_TABLE}, ${DB_POG_BADGES_TABLE}, and ${DB_PLAYER_POG_BADGES_TABLE} tables`
	);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_PLAYERS_TABLE} (
			id 							INTEGER PRIMARY KEY,
			username				TEXT NOT NULL,
			country_code		CHAR(2) NOT NULL,
			is_active				BOOLEAN NOT NULL,
			join_date				TIMESTAMPTZ NOT NULL,
			team_id					INTEGER,
			cover_url				TEXT,
			retrieved_at		TIMESTAMPTZ NOT NULL,
			is_from_osu_api	BOOLEAN NOT NULL,
			is_mia				 	BOOLEAN DEFAULT FALSE
    )`);
	// TODO?: team_id FK constraint if adding teams

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_PLAYER_RULESET_STATS_TABLE} (
			user_id 				INTEGER NOT NULL,
			ruleset_id 			SMALLINT NOT NULL,
			play_count			INTEGER NOT NULL,
			play_time				INTEGER NOT NULL,
			pp							REAL NOT NULL,
			rank						INTEGER,
			ranked_score		BIGINT NOT NULL,
			ss_count				INTEGER DEFAULT 0,
			ssh_count				INTEGER DEFAULT 0,
			s_count					INTEGER DEFAULT 0,
			sh_count				INTEGER DEFAULT 0,
			a_count					INTEGER DEFAULT 0,

			PRIMARY KEY (user_id, ruleset_id),
			CONSTRAINT ruleset_stats_user_fk FOREIGN KEY(user_id)
			REFERENCES ${DB_PLAYERS_TABLE}(id)	
    )`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_POG_BADGES_TABLE} (
			id							SMALLINT PRIMARY KEY,
			name						TEXT NOT NULL,
			img_url					TEXT
		)`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_PLAYER_POG_BADGES_TABLE} (
			user_id					INTEGER NOT NULL,
			pog_badge_id		SMALLINT NOT NULL,

			PRIMARY KEY (user_id, pog_badge_id),
			CONSTRAINT pog_badges_user_fk FOREIGN KEY(user_id)
			REFERENCES ${DB_PLAYERS_TABLE}(id),
			CONSTRAINT pog_badges_badge_fk FOREIGN KEY(pog_badge_id)
			REFERENCES ${DB_POG_BADGES_TABLE}(id)
		)`);

	console.log(
		`Created ${DB_PLAYERS_TABLE}, ${DB_PLAYER_RULESET_STATS_TABLE}, ${DB_POG_BADGES_TABLE}, and ${DB_PLAYER_POG_BADGES_TABLE} tables if didn't exist`
	);
}

async function main() {
	try {
		await client.connect();
		await createTables();
	} catch (e) {
		console.error("Error creating tables:\n", e);
	} finally {
		await client.end();
	}
}

main();
