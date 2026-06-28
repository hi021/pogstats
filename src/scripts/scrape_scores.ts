// Sequentially "scrapes" all top 100 scores for each ranked, approved, and loved beatmap last updated before `ONLY_SCRAPE_IF_SAVED_BEFORE_THIS_DATE` from api v2
// Stores results in the DB_SCORES_TABLE postgres table.
// Re-authenticates w/ OAuth2 for every script run
// Includes peppy-pleasing rate limiting (SCRAPE_SCORE_DELAY_MS) and saves logs to SCORE_SCRAPE_LOG_PATH and SCORE_SCRAPE_ERROR_LOG_PATH

import fs from "fs";
import { Client } from "pg";
import {
	convertApiScore,
	convertDatabaseScore,
	parseArgs,
	prepareScoresTableValuesAndParamPlaceholders,
	SCORE_TABLE_COLUMNS,
	sortScores
} from "../shared.js";
import {
	DB_BEATMAPS_TABLE,
	DB_HOST,
	DB_NAME,
	DB_PASSWORD,
	DB_PLAYERS_TABLE,
	DB_PORT,
	DB_SCORES_TABLE,
	DB_USER,
	SCORE_SCRAPE_ERROR_LOG_PATH,
	SCORE_SCRAPE_LOG_PATH,
	SCRAPE_SCORE_DELAY_MS
} from "./env.js";
import { getOAuthToken } from "./osu_auth.js";
import {
	buildBeatmapScoresUrl,
	buildHeadersWithAuth,
	createLogStream,
	dumpTableToCsv,
	getMinDate,
	logError,
	logInfo,
	rateLimit
} from "./shared.js";

const FLAG_DEFINITIONS = Object.freeze({
	minDate: {
		cli: "--minDate <date>",
		description: "Only scrape beatmaps last scraped before this date (ISO 8601 or YYYY-MM-DD)",
		takesValue: true
	},
	skipDump: {
		cli: "--skipDump",
		description: "Skip dumping the current scores table before scraping",
		takesValue: false
	}
} as const);

const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, FLAG_DEFINITIONS);
const ONLY_SCRAPE_IF_SAVED_BEFORE_THIS_DATE = getMinDate(parsedFlags.minDate);
const SKIP_DUMP_BEFORE_SCRAPE = Boolean(parsedFlags.skipDump);

let client: Client;
let infoLogStream: fs.WriteStream;
let errorLogStream: fs.WriteStream;
let lastFetchTimestamp = 0;

async function createScoresTable() {
	logInfo(infoLogStream, `Attempting to create ${DB_SCORES_TABLE} table with indexes and comments`);

	await client.query(`
		CREATE TABLE IF NOT EXISTS ${DB_SCORES_TABLE} (
			position      						SMALLINT NOT NULL,
			is_scraped      					BOOLEAN NOT NULL,
			retrieved_at     					TIMESTAMPTZ NOT NULL,
			lazer      								BOOLEAN NOT NULL,
      id                  			BIGINT PRIMARY KEY DEFERRABLE INITIALLY DEFERRED,
      user_id             			INTEGER NOT NULL,
      ruleset_id          			SMALLINT NOT NULL,
      beatmap_id          			BIGINT NOT NULL,
      has_replay          			BOOLEAN NOT NULL DEFAULT FALSE,
      grade                			CHAR(2) NOT NULL DEFAULT '',
      accuracy            			REAL NOT NULL DEFAULT 0,
      max_combo           			INTEGER NOT NULL DEFAULT 0,
      total_score         			INTEGER NOT NULL DEFAULT 0,
      classic_total_score 			BIGINT,
      total_score_without_mods 	INTEGER,
      is_perfect_combo    			BOOLEAN,
      legacy_perfect      			BOOLEAN,
      pp                 				REAL,
      legacy_total_score  			BIGINT NOT NULL DEFAULT 0,
      ended_at            			TIMESTAMPTZ NOT NULL,
      data               			 	JSONB NOT NULL DEFAULT '{}'::jsonb,

			CONSTRAINT score_beatmap_fk FOREIGN KEY (beatmap_id)
    	REFERENCES ${DB_BEATMAPS_TABLE}(id),
			CONSTRAINT score_user_fk FOREIGN KEY (user_id)
			REFERENCES ${DB_PLAYERS_TABLE}(id)
		)`);
	// could also add unique constraints to user_id + beatmap_id + ruleset_id and position + beatmap_id + ruleset_id

	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_beatmap_id_idx ON ${DB_SCORES_TABLE}(beatmap_id)`);
	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_position_idx ON ${DB_SCORES_TABLE}(position)`);
	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_ended_at_idx ON ${DB_SCORES_TABLE}(ended_at)`);
	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_user_id_idx ON ${DB_SCORES_TABLE}(user_id)`);
	await client.query(
		`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_beatmap_ruleset_position_idx ON ${DB_SCORES_TABLE}(beatmap_id, ruleset_id, position)`
	);
	// TODO: verify performance, maybe add JSONB GIN, score, pp, rank, ruleset_id (after adding other modes)

	await client.query(
		`COMMENT ON COLUMN ${DB_SCORES_TABLE}.position IS 'Meta (not from the API): 1-based position of the score on the beatmap'`
	);
	await client.query(
		`COMMENT ON COLUMN ${DB_SCORES_TABLE}.data IS 'mods, maximum_statistics, statistics columns from the API as JSONB'`
	);

	logInfo(infoLogStream, `Created ${DB_SCORES_TABLE} table if didn't exist`);
}

async function addBeatmapColumns() {
	logInfo(infoLogStream, `Adding 'last_scores_scrape' and 'last_scores_update' columns to ${DB_BEATMAPS_TABLE}`);

	// not the best solution due to converts, assuming osu!standard for now
	await client.query(
		`ALTER TABLE ${DB_BEATMAPS_TABLE} ADD COLUMN IF NOT EXISTS last_scores_scrape TIMESTAMPTZ DEFAULT NULL`
	);
	await client.query(
		`COMMENT ON COLUMN ${DB_BEATMAPS_TABLE}.last_scores_scrape IS 'Meta: time of the last score scraper run over this map'`
	);

	await client.query(
		`ALTER TABLE ${DB_BEATMAPS_TABLE} ADD COLUMN IF NOT EXISTS last_scores_update TIMESTAMPTZ DEFAULT NULL`
	);
	await client.query(
		`COMMENT ON COLUMN ${DB_BEATMAPS_TABLE}.last_scores_update IS 'Meta: time of the last update for the map from scores-ws'`
	);

	logInfo(
		infoLogStream,
		`Finished adding 'last_scores_scrape' and 'last_scores_update' columns to ${DB_BEATMAPS_TABLE}`
	);
}

// takes in 100 scores from the same beatmap, converted from endpoint
async function mergeSingleBeatmapScoresIntoExisting(scrapedScores: BeatmapScoreFull[]) {
	if (!scrapedScores?.length) return;

	const beatmapId = scrapedScores[0].beatmapId;
	const rulesetId = scrapedScores[0].rulesetId;
	const existingResult = await client.query(
		`SELECT * from ${DB_SCORES_TABLE} where beatmap_id = $1 and ruleset_id = $2`,
		[beatmapId, rulesetId]
	);

	const existingById = new Map<number, BeatmapScoreFull>();
	const existingByUser = new Map<number, BeatmapScoreFull>();

	for (const row of existingResult.rows) {
		const existingScore = convertDatabaseScore(row);
		existingById.set(existingScore.id, existingScore);
		if (!existingByUser.has(existingScore.userId)) existingByUser.set(existingScore.userId, existingScore);
		else
			logError(
				errorLogStream,
				`[${beatmapId}] WARNING: Multiple scores in DB for user ${existingScore.userId} in ruleset ${existingScore.rulesetId} (${existingScore.id}, ${existingByUser.get(existingScore.userId)!.id})`
			);
	}

	const mergedById = new Map(existingById);

	for (const score of scrapedScores) {
		const existingByIdScore = existingById.get(score.id);

		if (existingByIdScore) {
			if (existingByIdScore.totalScore == score.totalScore) {
				existingByIdScore.isScraped = score.isScraped;
				existingByIdScore.retrievedAt = score.retrievedAt;
				mergedById.set(existingByIdScore.id, existingByIdScore);
				continue;
			}
			logInfo(
				infoLogStream,
				`[${beatmapId}] Overwriting recalculated score #${existingByIdScore.id} in ruleset ${existingByIdScore.rulesetId} (${existingByIdScore.totalScore} -> ${score.totalScore})`
			);
			mergedById.delete(existingByIdScore.id);
		}

		const existingByUserScore = existingByUser.get(score.userId);
		if (existingByUserScore && existingByUserScore.id != score.id) {
			logInfo(
				infoLogStream,
				`[${beatmapId}] Overwriting improved score #${existingByUserScore.id} in ruleset ${existingByUserScore.rulesetId} (${existingByUserScore.totalScore} -> ${score.totalScore})`
			);
			mergedById.delete(existingByUserScore.id);
		}

		mergedById.set(score.id, score);
	}

	const finalScores = [...mergedById.values()].sort(sortScores);
	const { values, paramGroups } = prepareScoresTableValuesAndParamPlaceholders(finalScores);

	await client.query("BEGIN");
	try {
		await client.query(`DELETE FROM ${DB_SCORES_TABLE} WHERE beatmap_id = $1 AND ruleset_id = $2`, [
			beatmapId,
			rulesetId
		]);
		await client.query(
			`INSERT INTO ${DB_SCORES_TABLE} (${SCORE_TABLE_COLUMNS.join(", ")}) VALUES ${paramGroups.join(", ")}`,
			values
		);
		await client.query(`UPDATE ${DB_BEATMAPS_TABLE} SET last_scores_scrape = NOW() WHERE id = $1`, [beatmapId]);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

async function handleBeatmap(beatmapId: number, rowNo: number, headers: Record<string, string>) {
	await rateLimit(
		{
			get: () => lastFetchTimestamp,
			set: value => {
				lastFetchTimestamp = value;
			}
		},
		SCRAPE_SCORE_DELAY_MS
	);

	try {
		logInfo(infoLogStream, `[${beatmapId}][#${rowNo}] - Processing beatmap`);

		const response = await fetch(buildBeatmapScoresUrl(beatmapId), { headers });
		if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

		const data = (await response.json()) as ApiBeatmapScore;
		const convertedScores = data.scores.map((score, index) => convertApiScore(score, index + 1));
		await mergeSingleBeatmapScoresIntoExisting(convertedScores);

		logInfo(infoLogStream, `[${beatmapId}][#${rowNo}] - Processed ${convertedScores.length} scores`);
	} catch (e) {
		logError(errorLogStream, `[${beatmapId}][#${rowNo}] - Processing failed`, e);
	}
}

async function getBeatmapIds(maxRetrievedAt?: Date): Promise<number[]> {
	const params = maxRetrievedAt ? [maxRetrievedAt] : [];
	return (
		await client.query(
			`SELECT id FROM ${DB_BEATMAPS_TABLE} WHERE status IN ('ranked','approved','loved') AND mode = 'osu' ${maxRetrievedAt ? `AND (last_scores_scrape < $1 OR last_scores_scrape IS NULL)` : ""} ORDER BY id`,
			params
		)
	).rows.map(row => row.id);
}

async function scrapeScores() {
	try {
		infoLogStream = createLogStream(SCORE_SCRAPE_LOG_PATH);
		errorLogStream = createLogStream(SCORE_SCRAPE_ERROR_LOG_PATH);

		client = new Client({
			host: DB_HOST,
			port: DB_PORT,
			user: DB_USER,
			password: DB_PASSWORD,
			database: DB_NAME
		});

		await client.connect();
		await createScoresTable();
		if (!SKIP_DUMP_BEFORE_SCRAPE) await dumpTableToCsv(DB_SCORES_TABLE, SCORE_TABLE_COLUMNS, client, infoLogStream);
		await addBeatmapColumns();

		const headers = buildHeadersWithAuth(await getOAuthToken());
		const beatmapIds = await getBeatmapIds(ONLY_SCRAPE_IF_SAVED_BEFORE_THIS_DATE);
		logInfo(infoLogStream, `Found ${beatmapIds.length} beatmap IDs to process`);

		for (let i = 0; i < beatmapIds.length; i++) await handleBeatmap(beatmapIds[i], i + 1, headers);

		// TODO graceful shutdown handling to ensure logs are flushed and DB connection is closed even if the process is killed mid-run
		logInfo(infoLogStream, "Finished processing all beatmaps");
	} finally {
		await client.end();
		infoLogStream.end();
		errorLogStream.end();
	}
}

scrapeScores();
