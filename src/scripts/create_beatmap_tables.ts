import { Client } from "pg";
import { DB_BEATMAPS_TABLE, DB_BEATMAPSETS_TABLE, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from "../env.js";

const client = new Client({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME
});

async function createTables() {
	console.log(`Attempting to create ${DB_BEATMAPSETS_TABLE} and ${DB_BEATMAPS_TABLE} tables`);

	// TODO
	// not the best solution due to converts, assuming osu!standard for now
	//   `ALTER TABLE ${DB_BEATMAPS_TABLE} ADD COLUMN IF NOT EXISTS last_scores_scrape TIMESTAMPTZ DEFAULT NULL`
	//   `ALTER TABLE ${DB_BEATMAPS_TABLE} ADD COLUMN IF NOT EXISTS last_scores_update TIMESTAMPTZ DEFAULT NULL`

	// await client.query(
	//   `COMMENT ON COLUMN ${DB_BEATMAPS_TABLE}.last_scores_scrape IS 'Meta: time of the last score scraper run over this map'`
	//   `COMMENT ON COLUMN ${DB_BEATMAPS_TABLE}.last_scores_update IS 'Meta: time of the last update for the map from scores-ws'`
	// );

	await client.query(`
      CREATE TABLE IF NOT EXISTS ${DB_BEATMAPSETS_TABLE} (
        
      )`);

	await client.query(`
      CREATE TABLE IF NOT EXISTS ${DB_BEATMAPS_TABLE} (
        
      )`);

	console.log(`Created ${DB_BEATMAPSETS_TABLE} and ${DB_BEATMAPS_TABLE} tables if didn't exist`);
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
