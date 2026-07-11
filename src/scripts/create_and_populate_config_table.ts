import { PoolClient } from "pg";
import { dbPool } from "../db.js";
import { DB_CONFIG_TABLE } from "../env.js";
import { parseArgs } from "../shared.js";

const FLAG_DEFINITIONS = Object.freeze({
	reset: {
		cli: "--reset",
		description: "WARNING: will remove last_ws_score_id. Truncates config table to repopulate it",
		takesValue: false
	}
} as const);

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
	{ key: "last_ws_score_id", valueText: "0" },
	{ key: "global_message", valueText: "" }
]);

let client: PoolClient;

async function createConfigTable() {
	console.log(`Attempting to create ${DB_CONFIG_TABLE} table`);

	await client.query(`
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
				await client.query(
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
	const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, import.meta.main, FLAG_DEFINITIONS);

	try {
		client = await dbPool.connect();
		await createConfigTable();

		if (parsedFlags.reset) {
			console.log(`Truncating ${DB_CONFIG_TABLE} table`);
			await client.query(`TRUNCATE TABLE ${DB_CONFIG_TABLE}`);
		}

		await populateConfigTable();
	} catch (error) {
		console.error("Error creating config table:", error);
	} finally {
		client.release();
	}
}

main();
