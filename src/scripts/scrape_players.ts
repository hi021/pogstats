import { resolve } from "path";
import { Pool, QueryResult } from "pg";
import { fileURLToPath } from "url";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER, SCRAPE_PLAYER_DELAY_MS } from "../env.js";
import { getOAuthToken } from "./osu_auth.js";
import { buildHeadersWithAuth, buildUserLookupUrl, convertApiPlayerLookup, rateLimit } from "./shared.js";
import { splitIntoBatches } from "../shared.js";

const PLAYER_BATCH_SIZE = 100;
const dbPool = new Pool({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME,
	min: 1,
	connectionTimeoutMillis: 20000,
	allowExitOnIdle: true
});

let lastFetchTimestamp = 0;

async function getRankingPlayerIdBatches(): Promise<IdBatch[] | null> {
	const idBatches: QueryResult<IdBatch> = await dbPool.query(`
		WITH numbered AS (
			SELECT
					s.user_id,
					ROW_NUMBER() OVER (ORDER BY s.user_id) AS rn
			FROM scores s
			WHERE s.position <= 104
			GROUP BY s.user_id
		),
		batched AS (
			SELECT
					((rn - 1) / ${PLAYER_BATCH_SIZE}) + 1 AS batch_no,
					ARRAY_AGG(user_id ORDER BY rn) AS ids
			FROM numbered
			GROUP BY batch_no
		)
		SELECT * FROM batched ORDER BY batch_no`);

	const idCount = idBatches.rowCount
		? (idBatches.rowCount - 1) * PLAYER_BATCH_SIZE + idBatches.rows.at(-1)!.ids.length
		: 0;
	console.log(`Found ${idCount} player IDs to scrape`);
	return idCount ? [{ batch_no: 1, ids: [39828, 23574301] }] : null;
}

async function lookupPlayers(headers: Record<string, string>, playerIds: number[]) {
	const res = await fetch(buildUserLookupUrl(playerIds), { headers });
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

	const players = (await res.json()) as { users: ApiUserLookup[] };
	return players.users;
}

function convertPlayers(players: ApiUserLookup[]): Player[] {
	const convertedPlayers = new Array<Player>(players.length);
	for (let i = 0; i < players.length; ++i) convertedPlayers[i] = convertApiPlayerLookup(players[i]);

	return convertedPlayers;
}

export async function scrapePlayers(ids?: number[]) {
	try {
		const playerIdBatches = ids ? splitIntoBatches(ids, PLAYER_BATCH_SIZE) : await getRankingPlayerIdBatches();
		if (!playerIdBatches) return;

		const headers = buildHeadersWithAuth(await getOAuthToken());

		for (const batch of playerIdBatches) {
			console.log(`Fetching player batch #${batch.batch_no}`);
			const apiPlayers = await lookupPlayers(headers, batch.ids);

			// convert
			console.log(`Processing player batch #${batch.batch_no}`);

			return; //TODO debug only

			await rateLimit(
				{
					get: () => lastFetchTimestamp,
					set: value => (lastFetchTimestamp = value)
				},
				SCRAPE_PLAYER_DELAY_MS
			);
		}
	} catch (e) {
		console.error("Error scraping players:\n", e);
	} finally {
		await dbPool.end();
	}
}

if (resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.filename))) scrapePlayers();
