import { Client } from "pg";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PLAYERS_TABLE, DB_PORT, DB_USER } from "./env.js";

let client: Client;

async function createPlayersTable() {
	console.log(`Attempting to create ${DB_PLAYERS_TABLE} table`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_PLAYERS_TABLE} (
      id: number;
      username: string;
      countryCode: string;
      joinDate: Date;
      playstyle: string[];
      profileHue?: number;
      title?: string;
      titleUrl?: string; // TODO verify
      cover?: unknown; // TODO verify
      previousUsernames?: string[];
      pogBadges?: number[]; // meta
      // TODO: maybe meta fields from poggersltd
      )`);

	console.log(`Created ${DB_PLAYERS_TABLE} table if didn't exist`);
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
		await createPlayersTable();
	} catch (error) {
		console.error("Error creating players table:", error);
	} finally {
		await client.end();
	}
}

main();
