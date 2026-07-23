import { ClientBase } from "pg";
import {
	BEATMAP_TABLE_COLUMNS,
	BEATMAP_TABLE_COLUMNS_ALL,
	buildUpdateAssignmentsString,
	withDbClientTransaction
} from "../db-generic.js";
import { upsertBeatmapBatch } from "../db.js";
import { DB_BEATMAPS_TABLE } from "../env.js";
import { queryWithTiming, timedFetch } from "../metrics.js";
import { splitIntoBatches } from "../shared.js";
import {
	BEATMAP_DB_BEATMAP_FETCH_URL,
	buildBeatmapDbUrl,
	convertApiBeatmap,
	DEFAULT_HEADERS,
	doesBeatmapHaveLeaderboards
} from "./shared.js";

const BEATMAP_BATCH_SIZE = 100;

async function fetchBeatmaps(headers: Record<string, string>, beatmapIds: number[]) {
	const url = buildBeatmapDbUrl(beatmapIds);
	const res = await timedFetch(url, { headers }, "scrape_beatmaps", BEATMAP_DB_BEATMAP_FETCH_URL);
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

	const beatmaps = (await res.json()) as ApiBeatmapDbResponse;
	return Array.isArray(beatmaps) ? beatmaps.map(b => b.beatmap) : [beatmaps.beatmap];
}

// TODO: doesBeatmapHaveLeaderboards is kinda a workaround!!!
// ideally listen to osu's api/v2/beatmapsets/events (obv no docs) since beatmap-db only updates once a day
// qualified beatmaps do not count toward pogstats rankings and would have to be re-fetched anyway
function filterAndConvertBeatmaps(beatmaps: ApiBeatmapDbBeatmap[], updatedAt?: Date) {
	updatedAt = updatedAt || new Date();
	const converted: Beatmap[] = [];
	for (let i = 0; i < beatmaps.length; ++i) {
		if (!doesBeatmapHaveLeaderboards(beatmaps[i])) continue;
		converted.push(convertApiBeatmap(beatmaps[i], updatedAt));
	}

	return converted;
}

// not really necessary rn, maybe later there will be some heavier processing done
async function createTempBeatmapsTable(client: ClientBase) {
	await queryWithTiming(
		client,
		"createTempBeatmapsTable",
		"scrape_beatmaps",
		`
    CREATE TEMPORARY TABLE IF NOT EXISTS scrape_beatmaps_tmp (
			id 							INTEGER PRIMARY KEY,
			beatmapset_id 	INTEGER NOT NULL,
			status 					SMALLINT NOT NULL,
			artist 					TEXT NOT NULL,
			title 					TEXT NOT NULL,
			version					TEXT NOT NULL,
			creator 				TEXT NOT NULL,
			creator_id 			INTEGER NOT NULL,
			ruleset_id			SMALLINT NOT NULL,
			approved_date 	TIMESTAMPTZ,
			star_rating 		REAL,
			total_length 		SMALLINT NOT NULL,
			bpm 						REAL NOT NULL,
			cs 							REAL NOT NULL,
			od 							REAL NOT NULL,
			ar 							REAL NOT NULL,
			hp 							REAL NOT NULL,
			packs 					TEXT NOT NULL DEFAULT '',
			updated_at			TIMESTAMPTZ
    );

    TRUNCATE TABLE scrape_beatmaps_tmp;`
	);
}

async function insertBeatmapBatch(client: ClientBase) {
	await queryWithTiming(
		client,
		"insertBeatmapBatch",
		"scrape_beatmaps",
		`
    INSERT INTO ${DB_BEATMAPS_TABLE} (${BEATMAP_TABLE_COLUMNS_ALL.join(",")})
      SELECT ${BEATMAP_TABLE_COLUMNS_ALL.join(",")}
      FROM scrape_beatmaps_tmp tmp
    ON CONFLICT (id) DO UPDATE SET ${buildUpdateAssignmentsString(BEATMAP_TABLE_COLUMNS)}`
	);
}

export async function scrapeBeatmaps(ids?: number[]) {
	if (!ids?.length) return;

	let scrapedCount = 0;
	const idBatches = splitIntoBatches(ids, BEATMAP_BATCH_SIZE);
	for (const batch of idBatches) {
		try {
			const updatedAt = new Date();
			console.log(`[scrape_beatmaps] Fetching beatmap batch #${batch.batch_no}`);
			const apiBeatmaps = await fetchBeatmaps(DEFAULT_HEADERS, batch.ids);

			console.log(`[scrape_beatmaps] Processing and inserting beatmap batch #${batch.batch_no}`);
			const convertedBeatmaps = filterAndConvertBeatmaps(apiBeatmaps, updatedAt);
			if (!convertedBeatmaps.length) continue;

			scrapedCount += convertedBeatmaps.length;
			await withDbClientTransaction(async client => {
				await createTempBeatmapsTable(client);
				await upsertBeatmapBatch(client, convertedBeatmaps, "scrape_beatmaps_tmp", "scrape_players");
				await insertBeatmapBatch(client);
			});
		} catch (e) {
			console.error(`[scrape_beatmaps] Failed to scrape, process, and insert batch #${batch.batch_no}:\n`, e);
			throw new Error("scrape_beatmaps failed with above error.");
		}
	}

	console.log(`[scrape_beatmaps] Finished saving ${scrapedCount} beatmaps`);
}

// TODO: make this a cron (that calls scrapeBeatmaps with no arguments) that iterates through every ranked map (get ids from /beatmaps?)
// and handles unranks, metadata changes, etc.

// when doing doesBeatmapHaveLeaderboards() ask osu! api whether they are still qualified beatmaps??
// no I guess not?? seems to be working...

// this does nothing for now
if (import.meta.main) scrapeBeatmaps();
