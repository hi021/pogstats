// Sequentially "scrapes" all top 100 scores for each ranked, approved, and loved beatmap last updated before `ONLY_SCRAPE_IF_SAVED_BEFORE_THIS_DATE` from api v2
// Stores results in the DB_SCORES_TABLE postgres table.
// Re-authenticates w/ OAuth2 for every script run
// Includes peppy-pleasing rate limiting (SCRAPE_SCORE_DELAY_MS) and saves logs to SCORE_SCRAPE_LOG_PATH and SCORE_SCRAPE_ERROR_LOG_PATH

import fs from "fs";
import { ClientBase } from "pg";
import { SCORE_TABLE_COLUMNS, SCORE_TABLE_COLUMNS_ALL, withDbClient, withDbClientTransaction } from "../db-generic.js";
import { fetchNewPlayers, updateBeatmapScoresRetrievalDate } from "../db.js";
import {
	DB_BEATMAP_RULESET_UPDATE_DATES_TABLE,
	DB_BEATMAPS_TABLE,
	DB_SCORES_TABLE,
	SCORE_SCRAPE_ERROR_LOG_PATH,
	SCORE_SCRAPE_LOG_PATH,
	SCRAPE_SCORE_DELAY_MS
} from "../env.js";
import { queryWithTiming, timedFetch } from "../metrics.js";
import {
	convertApiScore,
	convertDatabaseScore,
	parseArgs,
	prepareScoresTableValuesAndParamPlaceholders,
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

const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, import.meta.main, FLAG_DEFINITIONS);
const ONLY_SCRAPE_IF_SAVED_BEFORE_THIS_DATE = getMinDate(parsedFlags.minDate);
const SKIP_DUMP_BEFORE_SCRAPE = Boolean(parsedFlags.skipDump);

let infoLogStream: fs.WriteStream;
let errorLogStream: fs.WriteStream;
let lastFetchTimestamp = 0;

// takes in 100 scores from the same beatmap, converted from endpoint
async function mergeSingleBeatmapScoresIntoExisting(client: ClientBase, scrapedScores: BeatmapScoreFull[]) {
	if (!scrapedScores?.length) return;

	const beatmapId = scrapedScores[0].beatmapId;
	const rulesetId = scrapedScores[0].rulesetId;
	const existingResult = await queryWithTiming(
		client,
		"mergeSingleBeatmapScoresIntoExisting_get_existing",
		"scrape_scores",
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

	await queryWithTiming(
		client,
		"mergeSingleBeatmapScoresIntoExisting_delete_scores",
		"scrape_scores",
		`DELETE FROM ${DB_SCORES_TABLE} WHERE beatmap_id = $1 AND ruleset_id = $2`,
		[beatmapId, rulesetId]
	);
	await queryWithTiming(
		client,
		"mergeSingleBeatmapScoresIntoExisting_insert_scores",
		"scrape_scores",
		`INSERT INTO ${DB_SCORES_TABLE} (${SCORE_TABLE_COLUMNS.join(", ")}) VALUES ${paramGroups.join(", ")}`,
		values
	);

	await updateBeatmapScoresRetrievalDate(client, beatmapId, rulesetId, "last_scores_scrape", "scrape_scores");
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

		const url = buildBeatmapScoresUrl(beatmapId);
		const res = await timedFetch(url, { headers }, "scrape_scores", url.hostname + url.pathname);
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

		const data = (await res.json()) as ApiBeatmapScore;
		const convertedScores = data.scores.map((score, index) => convertApiScore(score, index + 1));
		const playerIds = convertedScores.map(s => s.userId);
		await withDbClientTransaction(async client => {
			await fetchNewPlayers(client, playerIds, undefined, "scrape_scores");
			await mergeSingleBeatmapScoresIntoExisting(client, convertedScores);
		});

		logInfo(infoLogStream, `[${beatmapId}][#${rowNo}] - Processed ${convertedScores.length} scores`);
	} catch (e) {
		logError(errorLogStream, `[${beatmapId}][#${rowNo}] - Processing failed`, e);
	}
}

// TODO: only osu!standard for now, change if implementing modes
async function getBeatmapIds(client: ClientBase, maxRetrievedAt?: Date): Promise<number[]> {
	const params = maxRetrievedAt ? [maxRetrievedAt] : [];
	return (
		await queryWithTiming(
			client,
			"getBeatmapIds",
			"scrape_scores",
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
		if (!SKIP_DUMP_BEFORE_SCRAPE)
			withDbClient(
				async client => await dumpTableToCsv(DB_SCORES_TABLE, SCORE_TABLE_COLUMNS_ALL, client, infoLogStream)
			);

		let beatmapIds: number[] = [];
		const headers = buildHeadersWithAuth(await getOAuthToken());
		await withDbClient(
			async client => (beatmapIds = await getBeatmapIds(client, ONLY_SCRAPE_IF_SAVED_BEFORE_THIS_DATE))
		);
		logInfo(infoLogStream, `Found ${beatmapIds.length} beatmap IDs to process`);

		for (let i = 0; i < beatmapIds.length; i++) await handleBeatmap(beatmapIds[i], i + 1, headers);

		// TODO graceful shutdown handling to ensure logs are flushed and DB connection is closed even if the process is killed mid-run
		logInfo(infoLogStream, "Finished processing all beatmaps");
	} finally {
		infoLogStream.end();
		errorLogStream.end();
	}
}

scrapeScores();
