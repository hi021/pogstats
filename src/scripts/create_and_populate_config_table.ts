import { Pool } from "pg";
import { DB_CONFIG_TABLE, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from "./env.js";

// TODO: come up with real values
const INITIAL_CONFIG: Readonly<ConfigEntry[]> = Object.freeze([
	{ key: "std_min_top100", valueInt: 900 },
	{ key: "std_min_top50", valueInt: 500 },
	{ key: "std_min_top25", valueInt: 200 },
	{ key: "std_min_top15", valueInt: 100 },
	{ key: "std_min_top8", valueInt: 50 },
	{ key: "std_min_top1", valueInt: 4 },
	{ key: "taiko_min_top100", valueInt: 750 },
	{ key: "taiko_min_top50", valueInt: 500 },
	{ key: "taiko_min_top25", valueInt: 200 },
	{ key: "taiko_min_top15", valueInt: 100 },
	{ key: "taiko_min_top8", valueInt: 50 },
	{ key: "taiko_min_top1", valueInt: 5 },
	{ key: "fruits_min_top100", valueInt: 1500 },
	{ key: "fruits_min_top50", valueInt: 900 },
	{ key: "fruits_min_top25", valueInt: 500 },
	{ key: "fruits_min_top15", valueInt: 200 },
	{ key: "fruits_min_top8", valueInt: 100 },
	{ key: "fruits_min_top1", valueInt: 5 },
	{ key: "mania_min_top100", valueInt: 900 },
	{ key: "mania_min_top50", valueInt: 600 },
	{ key: "mania_min_top25", valueInt: 300 },
	{ key: "mania_min_top15", valueInt: 125 },
	{ key: "mania_min_top8", valueInt: 50 },
	{ key: "mania_min_top1", valueInt: 5 },
	{ key: "last_ws_score_id", valueText: "0" }
]);

let clients: Pool;

async function createConfigTable() {
	console.log(`Attempting to create ${DB_CONFIG_TABLE} table`);

	await clients.query(`
    CREATE TABLE IF NOT EXISTS ${DB_CONFIG_TABLE} (
      key TEXT PRIMARY KEY,
			value_int INTEGER,
			value_text TEXT,
			value_json JSONB
      )`);

	console.log(`Created ${DB_CONFIG_TABLE} table if didn't exist`);
}

async function populateConfigTable() {
	console.log(`Populating ${DB_CONFIG_TABLE} table with initial values`);

	const promises = new Array<Promise<void>>(INITIAL_CONFIG.length);

	for (const config of INITIAL_CONFIG) {
		promises.push(
			(async () => {
				await clients.query(
					`INSERT INTO ${DB_CONFIG_TABLE} (key, value_int, value_text, value_json) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING`,
					[config.key, config.valueInt, config.valueText, config.valueJson ? JSON.stringify(config.valueJson) : null]
				);
			})()
		);
	}

	await Promise.all(promises);
	console.log(`Populated ${DB_CONFIG_TABLE} table with initial values`);
}

async function main() {
	clients = new Pool({
		host: DB_HOST,
		port: DB_PORT,
		user: DB_USER,
		password: DB_PASSWORD,
		database: DB_NAME
	});

	try {
		await createConfigTable();
		await populateConfigTable();
	} catch (error) {
		console.error("Error creating config table:", error);
	} finally {
		await clients.end();
	}
}

main();
