import { withDbClient } from "../db-generic.js";
import { DB_RANKING_VIEW } from "../env.js";

const RANKING_PLAYER_LIMIT = 10000;

async function createRankingView() {
	await withDbClient(async client => {
		await client.query(`
			CREATE OR REPLACE MATERIALIZED VIEW ${DB_RANKING_VIEW} AS
		TODO:...`)
	});
}

createRankingView();
