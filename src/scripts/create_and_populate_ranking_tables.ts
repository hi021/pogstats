import { ClientBase } from "pg";
import { withDbClientTransaction } from "../db-generic.js";
import { DB_RANKING_TABLE_COMMON } from "../env.js";

async function createRankingTables(client: ClientBase) {
	console.log(`Creating osu_${DB_RANKING_TABLE_COMMON} (yes, only standard for now) if not exists`)

		await client.query(`
			CREATE TABLE IF NOT EXISTS osu_${DB_RANKING_TABLE_COMMON} (
				user_id 							INTEGER PRIMARY KEY,
				username 							TEXT NOT NULL,
				country_code 					CHAR(2) NOT NULL,

				count_100							INTEGER NOT NULL DEFAULT 0,
				count_perma_100				INTEGER NOT NULL DEFAULT 0,
				count_ss_100					INTEGER NOT NULL DEFAULT 0,
				count_lazer_100				INTEGER NOT NULL DEFAULT 0,
				weighted_100					REAL NOT NULL DEFAULT 0,
				ranked_score_100			INTEGER DEFAULT 0,
				total_pp_100					INTEGER DEFAULT 0,
				weighted_pp_100				REAL NOT NULL DEFAULT 0,
				
				count_50							INTEGER NOT NULL DEFAULT 0,
				count_perma_50				INTEGER NOT NULL DEFAULT 0,
				count_ss_50						INTEGER NOT NULL DEFAULT 0,
				count_lazer_50				INTEGER NOT NULL DEFAULT 0,
				weighted_50						REAL NOT NULL DEFAULT 0,
				ranked_score_50				INTEGER DEFAULT 0,
				total_pp_50						INTEGER DEFAULT 0,
				weighted_pp_50				REAL NOT NULL DEFAULT 0,

				count_25							INTEGER NOT NULL DEFAULT 0,
				count_perma_25				INTEGER NOT NULL DEFAULT 0,
				count_ss_25						INTEGER NOT NULL DEFAULT 0,
				count_lazer_25				INTEGER NOT NULL DEFAULT 0,
				weighted_25						REAL NOT NULL DEFAULT 0,
				ranked_score_25				INTEGER DEFAULT 0,
				total_pp_25						INTEGER DEFAULT 0,
				weighted_pp_25				REAL NOT NULL DEFAULT 0,
				
				count_15							INTEGER NOT NULL DEFAULT 0,
				count_perma_15				INTEGER NOT NULL DEFAULT 0,
				count_ss_15						INTEGER NOT NULL DEFAULT 0,
				count_lazer_15				INTEGER NOT NULL DEFAULT 0,
				weighted_15						REAL NOT NULL DEFAULT 0,
				ranked_score_15				INTEGER DEFAULT 0,
				total_pp_15						INTEGER DEFAULT 0,
				weighted_pp_15				REAL NOT NULL DEFAULT 0,
				
				count_8								INTEGER NOT NULL DEFAULT 0,
				count_perma_8					INTEGER NOT NULL DEFAULT 0,
				count_ss_8						INTEGER NOT NULL DEFAULT 0,
				count_lazer_8					INTEGER NOT NULL DEFAULT 0,
				weighted_8						REAL NOT NULL DEFAULT 0,
				ranked_score_8				INTEGER DEFAULT 0,
				total_pp_8						INTEGER DEFAULT 0,
				weighted_pp_8					REAL NOT NULL DEFAULT 0,
				
				count_1								INTEGER NOT NULL DEFAULT 0,
				count_perma_1					INTEGER NOT NULL DEFAULT 0,
				count_ss_1						INTEGER NOT NULL DEFAULT 0,
				count_lazer_1					INTEGER NOT NULL DEFAULT 0,
				weighted_1						REAL NOT NULL DEFAULT 0,
				ranked_score_1				INTEGER DEFAULT 0,
				total_pp_1						INTEGER DEFAULT 0,
				weighted_pp_1					REAL NOT NULL DEFAULT 0
			)`);

		console.log(`Created osu_${DB_RANKING_TABLE_COMMON} if didn't exist`)
}

// watch out, this takes at least a minute for standard only
async function populateRankingTables(client: ClientBase) {
}

async function main() {
	await withDbClientTransaction(async client => {
		await createRankingTables(client);
		await populateRankingTables(client);
	})
}

main();
