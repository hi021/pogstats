import { resolve } from "path";
import { ClientBase, QueryResult } from "pg";
import { fileURLToPath } from "url";
import {
	buildUpdateCoalesceAssignmentsString,
	dbPool,
	findNoLongerMiaPlayerIds,
	insertNewMiaPlayers,
	insertNoLongerMiaPlayers,
	PLAYER_TABLE_COLUMNS,
	recalculateScorePositionsForMapIds,
	setAllPlayerScoresPosition,
	withDbClientTransaction
} from "../db.js";
import { DB_PLAYERS_TABLE, DB_SCORES_TABLE, SCRAPE_PLAYER_DELAY_MS } from "../env.js";
import { parseArgs, splitIntoBatches, unnestObjectsIntoArrays } from "../shared.js";
import { getOAuthToken } from "./osu_auth.js";
import { buildHeadersWithAuth, buildUserLookupUrl, convertApiPlayerLookup, getMinDate, rateLimit } from "./shared.js";

const PLAYER_BATCH_SIZE = 50;
const FLAG_DEFINITIONS = Object.freeze({
	minDate: {
		cli: "--minDate <date>",
		description: "Only scrape players whose retrieved_at is NULL or before this date (ISO 8601 or YYYY-MM-DD)",
		takesValue: true
	}
} as const);

const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, FLAG_DEFINITIONS);
const MAX_RETRIEVED_AT = getMinDate(parsedFlags.minDate);

let lastFetchTimestamp = 0;

async function getRankingPlayerIdBatches(maxRetrievedAt?: Date): Promise<IdBatch[] | null> {
	const params = maxRetrievedAt ? [maxRetrievedAt] : [];
	const idBatches: QueryResult<IdBatch> = await dbPool.query(
		`
		WITH numbered AS (
			SELECT
				s.user_id,
				ROW_NUMBER() OVER (ORDER BY s.user_id) AS rn
			FROM ${DB_SCORES_TABLE} s
			LEFT JOIN ${DB_PLAYERS_TABLE} p ON p.id = s.user_id
			WHERE s.position <= 104
			${maxRetrievedAt ? `AND (p.retrieved_at IS NULL OR p.retrieved_at < $1)` : ""}
			GROUP BY s.user_id
		),
		batched AS (
			SELECT
				((rn - 1) / ${PLAYER_BATCH_SIZE}) + 1 AS batch_no,
				ARRAY_AGG(user_id ORDER BY rn) AS ids
			FROM numbered
			GROUP BY batch_no
		)
		SELECT * FROM batched ORDER BY batch_no`,
		params
	);

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

function buildMiaPlayer(id: number, retrievedAt: Date): MissingPlayer {
	return {
		id,
		countryCode: "XX",
		isActive: false,
		username: "<POGSTATS::UNKNOWN>",
		retrievedAt,
		isFromOsuApi: true,
		isMia: true
	};
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
		)`);
	await client.query("TRUNCATE TABLE scrape_players_tmp");
}

async function insertPlayerBatchIntoTmpTable(client: ClientBase, batch: Array<Player>, exemplaryPlayer: Player) {
	const arrays = unnestObjectsIntoArrays(
		batch as unknown as Array<Record<string, unknown>>,
		exemplaryPlayer as unknown as Record<string, unknown>
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

async function insertPlayerBatch(client: ClientBase) {
	await client.query(`
	INSERT INTO ${DB_PLAYERS_TABLE} (${PLAYER_TABLE_COLUMNS.join(", ")})
		SELECT ${PLAYER_TABLE_COLUMNS.map(col => `COALESCE(tmp.${col}, p.${col}) as ${col}`).join(", ")}
		FROM scrape_players_tmp tmp
		LEFT JOIN ${DB_PLAYERS_TABLE} p ON p.id = tmp.id
	ON CONFLICT (id) DO UPDATE SET ${buildUpdateCoalesceAssignmentsString(PLAYER_TABLE_COLUMNS, DB_PLAYERS_TABLE)}
	`);
}

export async function scrapePlayers(ids?: number[]) {
	try {
		const playerIdBatches = ids
			? splitIntoBatches(ids, PLAYER_BATCH_SIZE)
			: await getRankingPlayerIdBatches(MAX_RETRIEVED_AT);
		if (!playerIdBatches) return;

		const headers = buildHeadersWithAuth(await getOAuthToken());
		const miaPlayers = new Map<number, Date>();
		let scrapedPlayerCount = 0;
		let exemplaryPlayer: Player;

		for (const batch of playerIdBatches) {
			try {
				// TODO: use respektive's osu-score-rank-api and osu! api only as a fallback to save some calls
				const retrievedAt = new Date();
				lastFetchTimestamp = retrievedAt.getTime();
				console.log(`[scrape_players] Fetching player batch #${batch.batch_no}`);
				const apiPlayers = await lookupPlayers(headers, batch.ids);

				console.log(`[scrape_players] Processing and inserting player batch #${batch.batch_no}`);
				const convertedPlayers = convertPlayers(apiPlayers, retrievedAt);
				exemplaryPlayer = convertedPlayers[0] ?? buildMiaPlayer(0, retrievedAt);
				const players: Player[] = [];

				for (const playerId of batch.ids) {
					const player = convertedPlayers.find(p => p.id == playerId); // probably better to make it a Map straight away, but the number of players is small enough that it doesn't matter
					if (!player) miaPlayers.set(playerId, retrievedAt);
					players.push(player ?? buildMiaPlayer(playerId, retrievedAt));
				}

				scrapedPlayerCount += players.length;
				await withDbClientTransaction(async client => {
					await createTempPlayersTable(client);
					await insertPlayerBatchIntoTmpTable(client, players, exemplaryPlayer);
					await insertPlayerBatch(client);
				});
				players.length = 0;

				await rateLimit(
					{
						get: () => lastFetchTimestamp,
						set: value => (lastFetchTimestamp = value)
					},
					SCRAPE_PLAYER_DELAY_MS
				);
			} catch (e) {
				console.error(`[scrape_players] Failed to scrape, process, and insert batch #${batch.batch_no}:\n`, e);
				break;
			}
		}

		console.log(`[scrape_players] Finished saving ${scrapedPlayerCount} players`);

		await withDbClientTransaction(async client => {
			const miaPlayerIds = [...miaPlayers.keys()];
			if (miaPlayerIds.length)
				console.log(
					`[scrape_players] Player(s) with ID(s) ${miaPlayerIds} not in the API response, marking all as MIA`
				);

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
