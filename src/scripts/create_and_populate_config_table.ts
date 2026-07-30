import { ClientBase } from "pg";
import { withDbClientTransaction } from "../db-generic.js";
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
// TODO: move to redis
const INITIAL_CONFIG: Readonly<ConfigEntry[]> = Object.freeze([
	{ key: "osu_min_top100", value_int: 900 },
	{ key: "osu_min_top50", value_int: 500 },
	{ key: "osu_min_top25", value_int: 200 },
	{ key: "osu_min_top15", value_int: 100 },
	{ key: "osu_min_top8", value_int: 50 },
	{ key: "osu_min_top1", value_int: 4 },
	{ key: "taiko_min_top100", value_int: 750 },
	{ key: "taiko_min_top50", value_int: 500 },
	{ key: "taiko_min_top25", value_int: 200 },
	{ key: "taiko_min_top15", value_int: 100 },
	{ key: "taiko_min_top8", value_int: 50 },
	{ key: "taiko_min_top1", value_int: 5 },
	{ key: "fruits_min_top100", value_int: 1500 },
	{ key: "fruits_min_top50", value_int: 900 },
	{ key: "fruits_min_top25", value_int: 500 },
	{ key: "fruits_min_top15", value_int: 200 },
	{ key: "fruits_min_top8", value_int: 100 },
	{ key: "fruits_min_top1", value_int: 5 },
	{ key: "mania_min_top100", value_int: 900 },
	{ key: "mania_min_top50", value_int: 600 },
	{ key: "mania_min_top25", value_int: 300 },
	{ key: "mania_min_top15", value_int: 125 },
	{ key: "mania_min_top8", value_int: 50 },
	{ key: "mania_min_top1", value_int: 5 },
	{ key: "last_scores_id", value_text: "0" },
	{ key: "scores_cursor_string", value_text: "" },
	{ key: "beatmaps_cursor_string", value_text: "" },
	{
		key: "global_message",
		value_text: "still very very alpha! also the domain is changing from poggers.ltd to poggers.moe (running costs woopsie)!!"
	}
]);

async function createConfigTable(client: ClientBase) {
	console.log(`Attempting to create ${DB_CONFIG_TABLE} table`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_CONFIG_TABLE} (
      key 				TEXT PRIMARY KEY,
			value_int 	INTEGER,
			value_text 	TEXT,
			value_json 	JSONB
    )`);

	console.log(`Created ${DB_CONFIG_TABLE} table if didn't exist`);
}

async function populateConfigTable(client: ClientBase) {
	console.log(`Populating ${DB_CONFIG_TABLE} table with initial values`);

	for (const config of INITIAL_CONFIG)
		await client.query(
			`INSERT INTO ${DB_CONFIG_TABLE} (key, value_int, value_text, value_json) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING`,
			[config.key, config.value_int, config.value_text, config.value_json ? JSON.stringify(config.value_json) : null]
		);

	console.log(`Populated ${DB_CONFIG_TABLE} table with initial values`);
}

async function main() {
	const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, import.meta.main, FLAG_DEFINITIONS);

	try {
		await withDbClientTransaction(async client => {
			await createConfigTable(client);

			if (parsedFlags.reset) {
				console.log(`Truncating ${DB_CONFIG_TABLE} table`);
				await client.query(`TRUNCATE TABLE ${DB_CONFIG_TABLE}`);
			}

			await populateConfigTable(client);
		});
	} catch (e) {
		console.error("Error creating config table:\n", e);
	}
}

main();
