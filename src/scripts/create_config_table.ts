import { Client } from "pg";
import { DB_CONFIG_TABLE, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from "./env.js";

let client: Client;

async function createConfigTable() {
	console.log(`Attempting to create ${DB_CONFIG_TABLE} table`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_CONFIG_TABLE} (
      std_min_top100 SMALLINT NOT NULL DEFAULT 750,
      std_min_top50 SMALLINT NOT NULL DEFAULT 500,
      std_min_top25 SMALLINT NOT NULL DEFAULT 200,
      std_min_top15 SMALLINT NOT NULL DEFAULT 100,
      std_min_top8 SMALLINT NOT NULL DEFAULT 50,
      std_min_top1 SMALLINT NOT NULL DEFAULT 4
      )`);

	console.log(`Created ${DB_CONFIG_TABLE} table if didn't exist`);
}

async function main() {
	client = new Client({
		host: DB_HOST,
		port: DB_PORT,
		user: DB_USER,
		password: DB_PASSWORD,
		database: DB_NAME
	});

	try {
		await client.connect();
		await createConfigTable();
	} catch (error) {
		console.error("Error creating config table:", error);
	} finally {
		await client.end();
	}
}

main();
