import { resolve } from "path";
import { ClientBase, QueryResult } from "pg";
import { fileURLToPath } from "url";
import {
	buildUpdateCoalesceAssignmentsString,
	dbPool,
	findNoLongerMiaPlayerIds,
	insertNewMiaPlayers,
	insertNoLongerMiaPlayers,
	recalculateScorePositionsForMapIds,
	setAllPlayerScoresPosition,
	withDbClientTransaction
} from "../db.js";
import { DB_PLAYERS_TABLE, SCRAPE_PLAYER_DELAY_MS } from "../env.js";
import { PLAYER_TABLE_COLUMNS, splitIntoBatches, unnestObjectsIntoArrays } from "../shared.js";
import { getOAuthToken } from "./osu_auth.js";
import { buildHeadersWithAuth, buildUserLookupUrl, convertApiPlayerLookup, rateLimit } from "./shared.js";

const INSERT_BATCH_SIZE = 12500;
const PLAYER_BATCH_SIZE = 50;
let lastFetchTimestamp = 0;

// TODO minimum retrieved_at condition via CLI flag
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
	return idCount ? idBatches.rows : null;
}

async function lookupPlayers(headers: Record<string, string>, playerIds: number[]) {
	const res = await fetch(buildUserLookupUrl(playerIds), { headers });
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

	const players = (await res.json()) as { users: ApiUserLookup[] };
	return players.users;
}

function convertPlayers(players: ApiUserLookup[], retrievedAt?: Date): Player[] {
	retrievedAt = retrievedAt || new Date();
	const convertedPlayers = new Array<Player>(players.length);
	for (let i = 0; i < players.length; ++i) convertedPlayers[i] = convertApiPlayerLookup(players[i], retrievedAt);

	return convertedPlayers;
}

async function createTempPlayersTable(client: ClientBase) {
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

async function insertPlayerBatch(
	client: ClientBase,
	batch: Array<Player | MissingPlayer>,
	exemplaryPlayer: Player | MissingPlayer
) {
	const arrays = unnestObjectsIntoArrays(
		batch as Array<Record<string, unknown>>,
		exemplaryPlayer as Record<string, unknown>
	);

	await client.query(
		`
      INSERT INTO scrape_players_tmp (${PLAYER_TABLE_COLUMNS.join(", ")})
      SELECT *
      FROM UNNEST(
        $1::INTEGER[],
        $2::TEXT[],
        $3::CHAR(2)[],
        $4::BOOLEAN[],
        $5::INTEGER[],
        $6::TEXT[],
        $7::TIMESTAMPTZ[],
        $8::BOOLEAN[],
        $9::BOOLEAN[]
      )`,
		[
			arrays.id,
			arrays.username,
			arrays.countryCode,
			arrays.isActive,
			arrays.teamId,
			arrays.coverUrl,
			arrays.retrievedAt,
			arrays.isFromOsuApi,
			arrays.isMia
		]
	);
}

export async function scrapePlayers(ids?: number[]) {
	try {
		const playerIdBatches = ids ? splitIntoBatches(ids, PLAYER_BATCH_SIZE) : await getRankingPlayerIdBatches();
		if (!playerIdBatches) return;

		const headers = buildHeadersWithAuth(await getOAuthToken());
		const playerMap = new Map<number, Player>();
		const miaPlayers = new Map<number, Date>();
		let exemplaryPlayer: Player;

		for (const batch of playerIdBatches) {
			try {
				// TODO: use respektive's osu-score-rank-api and osu! api only as a fallback to save some calls
				console.log(`[scrape_players] Fetching player batch #${batch.batch_no}`);
				const apiPlayers = await lookupPlayers(headers, batch.ids);

				console.log(`[scrape_players] Processing player batch #${batch.batch_no}`);
				const retrievedAt = new Date();
				const convertedPlayers = convertPlayers(apiPlayers, retrievedAt);
				exemplaryPlayer = convertedPlayers[0];

				for (const id of batch.ids) {
					const player = convertedPlayers.find(p => p.id == id); // probably better to make it a Map straight away, but the number of players is small enough that it doesn't matter
					if (!player) miaPlayers.set(id, retrievedAt);
					else if (!exemplaryPlayer) exemplaryPlayer = { id, countryCode: "XX", isActive: false, username: "<POGSTATS::UNKNOWN>", retrievedAt, isFromOsuApi: true, isMia: true };
					playerMap.set(id, player ?? { id, countryCode: "XX", isActive: false, username: "<POGSTATS::UNKNOWN>", retrievedAt, isFromOsuApi: true, isMia: true });
				}

				await rateLimit(
					{
						get: () => lastFetchTimestamp,
						set: value => (lastFetchTimestamp = value)
					},
					SCRAPE_PLAYER_DELAY_MS
				);
			} catch (e) {
				console.error(`[scrape_players] Failed to scrape and process batch #${batch.batch_no}:\n`, e);
				break;
			}
		}

		// TODO: insert players into the database straight away to avoid problems with huge batches of new players from scores-ws!!
		const players = [...playerMap.values()];
		const miaPlayerIds = [...miaPlayers.keys()];
		await withDbClientTransaction(async client => {
			await createTempPlayersTable(client);

			for (let i = 0; i < players.length; i += INSERT_BATCH_SIZE) {
				const batch = players.slice(i, i + INSERT_BATCH_SIZE);
				await insertPlayerBatch(client, batch, exemplaryPlayer);
			}

			await client.query(`
				INSERT INTO ${DB_PLAYERS_TABLE} (${PLAYER_TABLE_COLUMNS.join(", ")})
				SELECT ${PLAYER_TABLE_COLUMNS.map(col => `COALESCE(tmp.${col}, p.${col}) as ${col}`).join(", ")}
				FROM scrape_players_tmp tmp
				ON CONFLICT (id) DO UPDATE SET ${buildUpdateCoalesceAssignmentsString(PLAYER_TABLE_COLUMNS, DB_PLAYERS_TABLE)}
				`);
		});

		console.log(`[scrape_players] Finished inserting ${playerMap.size} players into the database`);
		if (miaPlayerIds.length)
			console.log(`[scrape_players] Player(s) with ID(s) ${miaPlayerIds} not in the API response, marking all as MIA`);

		await withDbClientTransaction(async client => {
			const miaBeatmaps = await setAllPlayerScoresPosition(client, miaPlayerIds, 0);
			await insertNewMiaPlayers(client, miaPlayers);

			const nonMiaPlayerIds = await findNoLongerMiaPlayerIds(client);
			if (nonMiaPlayerIds.length)
				console.log(`[scrape_players] Player(s) with ID(s) ${nonMiaPlayerIds} are no longer MIA`);
			else if (!miaPlayerIds.length) return;

			const nonMiaBeatmaps = await setAllPlayerScoresPosition(client, nonMiaPlayerIds, 100);
			await insertNoLongerMiaPlayers(client, nonMiaPlayerIds);

			// TODO send event to pog-ws to notify about MIA and non MIA changes

			const miaBeatmapsUnnested = miaBeatmaps.length
				? unnestObjectsIntoArrays(miaBeatmaps)
				: { beatmap_id: [], ruleset_id: [] };
			const nonMiaBeatmapsUnnested = nonMiaBeatmaps.length
				? unnestObjectsIntoArrays(nonMiaBeatmaps)
				: { beatmap_id: [], ruleset_id: [] };
			await recalculateScorePositionsForMapIds(
				client,
				[...miaBeatmapsUnnested.beatmap_id, ...nonMiaBeatmapsUnnested.beatmap_id],
				[...miaBeatmapsUnnested.ruleset_id, ...nonMiaBeatmapsUnnested.ruleset_id]
			);
		});
	} catch (e) {
		console.error("Error scraping players:\n", e);
	}
}

if (resolve(process.argv[1]) == resolve(fileURLToPath(import.meta.url))) scrapePlayers();
