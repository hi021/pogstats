import { resolve } from "path";
import { Pool, PoolClient, QueryResult } from "pg";
import { fileURLToPath } from "url";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PLAYERS_TABLE, DB_PORT, DB_USER, SCRAPE_PLAYER_DELAY_MS } from "../env.js";
import { getOAuthToken } from "./osu_auth.js";
import { buildHeadersWithAuth, buildUserLookupUrl, convertApiPlayerLookup, rateLimit } from "./shared.js";
import { PLAYER_TABLE_COLUMNS, preparePlayersTableValuesAndParamPlaceholders, splitIntoBatches } from "../shared.js";
import { buildUpdateAssignmentsString, withDbClientTransaction } from "../db.js";

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
	console.log(`[scrape_players] Found ${idCount} player IDs to scrape`);
	return idCount ? [{ batch_no: 1, ids: [39828, 23574301] }] : null;
}

async function lookupPlayers(headers: Record<string, string>, playerIds: number[]) {
	const res = await fetch(buildUserLookupUrl(playerIds), { headers });
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

	const players = (await res.json()) as { users: ApiUserLookup[] };
	return players.users;
}

function convertPlayers(players: ApiUserLookup[], retrievedAt?: Date): Player[] {
	const convertedPlayers = new Array<Player>(players.length);
	for (let i = 0; i < players.length; ++i)
		convertedPlayers[i] = convertApiPlayerLookup(players[i], retrievedAt || new Date());

	return convertedPlayers;
}

async function createTempPlayersTable(client: PoolClient) {
	await client.query(`
		CREATE TEMPORARY TABLE IF NOT EXISTS scrape_players_tmp (
			id 							INTEGER PRIMARY KEY,
			username				TEXT NOT NULL,
			country_code		CHAR(2) NOT NULL,
			is_active				BOOLEAN NOT NULL,
			team_id					INTEGER,
			cover_url				TEXT,
			retrieved_at		TIMESTAMPTZ NOT NULL,
			is_from_osu_api	BOOLEAN NOT NULL,
			is_mia				 	BOOLEAN DEFAULT FALSE
		) ON COMMIT DELETE ROWS`);
	await client.query("TRUNCATE scrape_players_tmp");
}

export async function scrapePlayers(ids?: number[]) {
	try {
		const playerIdBatches = ids ? splitIntoBatches(ids, PLAYER_BATCH_SIZE) : await getRankingPlayerIdBatches();
		if (!playerIdBatches) return;

		const headers = buildHeadersWithAuth(await getOAuthToken());
		const playerMap = new Map<number, Player | MissingPlayer>();

		for (const batch of playerIdBatches) {
			console.log(`[scrape_players] Fetching player batch #${batch.batch_no}`);
			const apiPlayers = await lookupPlayers(headers, batch.ids);

			console.log(`[scrape_players] Processing player batch #${batch.batch_no}`);
			const retrievedAt = new Date();
			const players = convertPlayers(apiPlayers, retrievedAt);

			for (const id of batch.ids) {
				const player = players.find(p => p.id == id); // probably better to make it a Map straight away, but the number of players is small enough that it doesn't matter
				if (!player) console.log(`[scrape_players] Player with ID ${id} not in the API response, marking as MIA`);
				playerMap.set(id, player ?? { id, retrievedAt, isFromOsuApi: true, isMia: true });
			}

			return; //TODO debug only

			await rateLimit(
				{
					get: () => lastFetchTimestamp,
					set: value => (lastFetchTimestamp = value)
				},
				SCRAPE_PLAYER_DELAY_MS
			);
		}

		await withDbClientTransaction(async client => {
			createTempPlayersTable(client);

			const { values, paramGroups } = preparePlayersTableValuesAndParamPlaceholders([...playerMap.values()]);
			await client.query(
				`INSERT INTO scrape_players_tmp (${PLAYER_TABLE_COLUMNS.join(", ")}) VALUES ${paramGroups.join(", ")}`,
				values
			);

			await client.query(`
					INSERT INTO ${DB_PLAYERS_TABLE} p (${PLAYER_TABLE_COLUMNS.join(", ")})
					SELECT ${PLAYER_TABLE_COLUMNS.join(", ")} FROM scrape_players_tmp tmp
					WHERE EXISTS (SELECT 1 FROM p WHERE tmp.is_mia = TRUE AND tmp.id = p.id)
					ON CONFLICT (id) DO UPDATE SET ${buildUpdateAssignmentsString(PLAYER_TABLE_COLUMNS)}
				`);
		});
		console.log(`[scrape_players] Finished inserting ${playerMap.size} players into the database`);
	} catch (e) {
		console.error("Error scraping players:\n", e);
	} finally {
		await dbPool.end();
	}
}

if (resolve(process.argv[1]) == resolve(fileURLToPath(import.meta.filename))) scrapePlayers();
