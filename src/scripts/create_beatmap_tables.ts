import { Client } from "pg";
import { DB_BEATMAPS_TABLE, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from "../env.js";

const client = new Client({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME
});

async function createTables() {
	// only beatmaps table for now, osu-beatmap-db has no info on beatmapsets, but all important data is in the beatmap itself
	console.log(`Attempting to create ${DB_BEATMAPS_TABLE} table`);

	// TODO
	// not the best solution due to converts, assuming osu!standard for now
	//   `ALTER TABLE ${DB_BEATMAPS_TABLE} ADD COLUMN IF NOT EXISTS last_scores_scrape TIMESTAMPTZ DEFAULT NULL`
	//   `ALTER TABLE ${DB_BEATMAPS_TABLE} ADD COLUMN IF NOT EXISTS last_scores_update TIMESTAMPTZ DEFAULT NULL`

	// await client.query(
	//   `COMMENT ON COLUMN ${DB_BEATMAPS_TABLE}.last_scores_scrape IS 'Meta: time of the last score scraper run over this map'`
	//   `COMMENT ON COLUMN ${DB_BEATMAPS_TABLE}.last_scores_update IS 'Meta: time of the last update for the map from scores-ws'`
	// );

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_BEATMAPS_TABLE} (
			id INTEGER PRIMARY KEY,
			beatmapset_id INTEGER NOT NULL,
			status SMALLINT NOT NULL,
			artist TEXT NOT NULL,
			title TEXT NOT NULL,
			version TEXT NOT NULL,
			creator TEXT NOT NULL,
			creator_id INTEGER NOT NULL,
			mode SMALLINT NOT NULL,
			approved_date TIMESTAMPTZ,
			star_rating REAL,
			total_length SMALLINT NOT NULL,
			bpm REAL NOT NULL,
			cs REAL NOT NULL,
			od REAL NOT NULL,
			ar REAL NOT NULL,
			hp REAL NOT NULL,
			packs TEXT NOT NULL
		)`);

		await client.query(`
			CREATE INDEX ${DB_BEATMAPS_TABLE}_status_idx ON ${DB_BEATMAPS_TABLE}(status) WHERE status IN (1, 2, 4);
			CREATE INDEX ${DB_BEATMAPS_TABLE}_approved_date_brin_idx ON ${DB_BEATMAPS_TABLE} USING BRIN (approved_date);`);

	console.log(`Created ${DB_BEATMAPS_TABLE} table if didn't exist`);
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
