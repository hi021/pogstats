// Sequentially "scrapes" all top 100 scores for each ranked, approved, and loved beatmap last updated before `ONLY_SCRAPE_IF_SAVED_BEFORE_THIS_DATE` from api v2
// Stores results in the DB_SCORES_TABLE postgres table.
// Re-authenticates w/ OAuth2 for every script run
// Includes peppy-pleasing rate limiting (SCRAPE_SCORE_DELAY_MS) and saves logs to SCORE_SCRAPE_LOG_PATH and SCORE_SCRAPE_ERROR_LOG_PATH

import fs from "fs";
import { Client } from "pg";
import { updateBeatmapScoresRetrievalDate } from "../db.js";
import {
	DB_BEATMAP_RULESET_UPDATE_DATES_TABLE,
	DB_BEATMAPS_TABLE,
	DB_HOST,
	DB_NAME,
	DB_PASSWORD,
	DB_PORT,
	DB_SCORES_TABLE,
	DB_USER,
	SCORE_SCRAPE_ERROR_LOG_PATH,
	SCORE_SCRAPE_LOG_PATH,
	SCRAPE_SCORE_DELAY_MS
} from "../env.js";
import {
	convertApiScore,
	convertDatabaseScore,
	parseArgs,
	prepareScoresTableValuesAndParamPlaceholders,
	SCORE_TABLE_COLUMNS,
	sortScores
} from "../shared.js";
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
		await updateBeatmapScoresRetrievalDate(beatmapId, rulesetId, "last_scores_scrape");
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
			set: value => (lastFetchTimestamp = value)
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

// TODO: only osu!standard for now, change if implementing modes
async function getBeatmapIds(maxRetrievedAt?: Date): Promise<number[]> {
	const params = maxRetrievedAt ? [maxRetrievedAt] : [];
	return (
		await client.query(
			`
			SELECT b.id
			FROM ${DB_BEATMAPS_TABLE} b
			LEFT JOIN ${DB_BEATMAP_RULESET_UPDATE_DATES_TABLE} u
				ON u.beatmap_id = b.id AND u.ruleset_id = 0
			WHERE b.status IN (1,2,4)
				AND b.ruleset_id = 0
				${maxRetrievedAt ? `AND (u.last_scores_scrape IS NULL OR u.last_scores_scrape < $1)` : ""}
			ORDER BY b.id`,
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
		if (!SKIP_DUMP_BEFORE_SCRAPE) await dumpTableToCsv(DB_SCORES_TABLE, SCORE_TABLE_COLUMNS, client, infoLogStream);

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
