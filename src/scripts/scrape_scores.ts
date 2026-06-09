// Sequentially "scrapes" all top 100 scores for each beatmap ID listed under BEATMAP_ID_PATH and stores them in DB_SCORES_TABLE postgres table.
// Re-authenticates w/ OAuth2 for every script run
// Includes peppy-pleasing rate limiting (SCRAPE_SCORE_DELAY_MS) and saves logs to SCORE_SCRAPE_LOG_PATH and SCORE_SCRAPE_ERROR_LOG_PATH

import fs from "fs";
import { Client } from "pg";
import {
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
} from "./env.js";
import { getOAuthToken } from "./osu_auth.js";
import {
	buildBeatmapScoresUrl,
	buildHeadersWithAuth,
	createLogStream,
	dumpTableToCsv,
	logError,
	logInfo
} from "./shared.js";

const SCORE_TABLE_COLUMNS = Object.freeze([
	"position",
	"is_scraped",
	"retrieved_at",
	"stable",
	"id",
	"user_id",
	"ruleset_id",
	"beatmap_id",
	"has_replay",
	"rank",
	"accuracy",
	"max_combo",
	"total_score",
	"classic_total_score",
	"total_score_without_mods",
	"is_perfect_combo",
	"legacy_perfect",
	"pp",
	"legacy_total_score",
	"ended_at",
	"data"
]);

const FLAG_DEFINITIONS = Object.freeze({
	minDate: {
		cli: "--minDate <date>",
		description: "Only scrape beatmaps last scraped before this date (ISO 8601 or YYYY-MM-DD).",
		takesValue: true
	},
	skipDump: {
		cli: "--skipDump",
		description: "Skip dumping the current scores table before scraping.",
		takesValue: false
	}
} as const);

// TODO generalize and move to shared
type FlagName = keyof typeof FLAG_DEFINITIONS;
type FlagDefinition = (typeof FLAG_DEFINITIONS)[FlagName];
interface ParsedFlags {
	minDate?: string;
	skipDump?: boolean;
}

function printHelp() {
	console.log(`Usage: node ${process.argv[1]} [flags]\n`);
	console.log("Optional flags:");
	for (const def of Object.values(FLAG_DEFINITIONS) as FlagDefinition[])
		console.log(`  ${def.cli.padEnd(24)} ${def.description}`);
	console.log("  --help                   Show this help message");
}

function parseArgs(argv: string[]): ParsedFlags {
	const parsed = {} as ParsedFlags;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help") {
			printHelp();
			process.exit(0);
		}

		if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);

		const [flagName, maybeValue] = arg.slice(2).split("=", 2) as [string, string | undefined];
		if (!Object.prototype.hasOwnProperty.call(FLAG_DEFINITIONS, flagName))
			throw new Error(`Unknown flag: --${flagName}`);

		const def = FLAG_DEFINITIONS[flagName as FlagName];
		if (def.takesValue) {
			const value = maybeValue ?? argv[++i];
			if (!value || value.startsWith("--")) throw new Error(`Missing value for flag: --${flagName}`);
			parsed[flagName as "minDate"] = value;
		} else {
			if (maybeValue) throw new Error(`Unexpected value for flag: --${flagName}`);
			parsed[flagName as "skipDump"] = true;
		}
	}

	return parsed;
}

function getMinDate(value: string | undefined) {
	if (!value) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error(`Invalid date for --minDate: ${value}`);

	return date;
}

const parsedFlags = parseArgs(process.argv.slice(2));
const ONLY_SCRAPE_IF_SAVED_BEFORE_THIS_DATE = getMinDate(parsedFlags.minDate);
const SKIP_DUMP_BEFORE_SCRAPE = Boolean(parsedFlags.skipDump);

let client: Client;
let infoLogStream: fs.WriteStream;
let errorLogStream: fs.WriteStream;
let lastFetchTimestamp = 0;

async function rateLimit() {
	const now = Date.now();
	const elapsed = now - lastFetchTimestamp;
	if (lastFetchTimestamp > 0 && elapsed < SCRAPE_SCORE_DELAY_MS)
		await new Promise(resolve => setTimeout(resolve, SCRAPE_SCORE_DELAY_MS - elapsed));

	lastFetchTimestamp = Date.now();
}

function convertApiScore(apiScore: ApiScore, position: number): BeatmapScoreFull {
	return {
		position,
		isScraped: true,
		retrievedAt: new Date(),
		stable: !apiScore.build_id,
		id: apiScore.id,
		userId: apiScore.user_id,
		rulesetId: apiScore.ruleset_id,
		beatmapId: apiScore.beatmap_id,
		hasReplay: apiScore.has_replay,
		rank: apiScore.rank as ScoreRank, // safe because postgres pads to char(2) automatically
		accuracy: apiScore.accuracy,
		maxCombo: apiScore.max_combo,
		totalScore: apiScore.total_score,
		classicTotalScore: apiScore.classic_total_score,
		totalScoreWithoutMods: apiScore.total_score_without_mods,
		isPerfectCombo: apiScore.is_perfect_combo,
		legacyPerfect: apiScore.legacy_perfect,
		pp: apiScore.pp,
		legacyTotalScore: apiScore.legacy_total_score,
		endedAt: new Date(apiScore.ended_at),
		data: {
			mods: apiScore.mods,
			maximumStatistics: apiScore.maximum_statistics,
			statistics: apiScore.statistics
		}
	};
}

function convertDatabaseScore(dbScore: Record<string, unknown>) {
	return {
		position: dbScore.position,
		isScraped: dbScore.is_scraped,
		retrievedAt: dbScore.retrieved_at,
		stable: dbScore.stable,
		id: dbScore.id,
		userId: dbScore.user_id,
		rulesetId: dbScore.ruleset_id,
		beatmapId: dbScore.beatmap_id,
		hasReplay: dbScore.has_replay,
		rank: dbScore.rank,
		accuracy: dbScore.accuracy,
		maxCombo: dbScore.max_combo,
		totalScore: dbScore.total_score,
		classicTotalScore: dbScore.classic_total_score,
		totalScoreWithoutMods: dbScore.total_score_without_mods,
		isPerfectCombo: dbScore.is_perfect_combo,
		legacyPerfect: dbScore.legacy_perfect,
		pp: dbScore.pp,
		legacyTotalScore: dbScore.legacy_total_score,
		endedAt: dbScore.ended_at,
		data: dbScore.data
	} as BeatmapScoreFull;
}

function convertAdditionalDataToJsonb(additionalData: BeatmapScoreAdditionalData) {
	return JSON.stringify(additionalData);
}

async function createScoresTable() {
	logInfo(infoLogStream, `Attempting to create ${DB_SCORES_TABLE} table with indexes and comments`);

	await client.query(`
		CREATE TABLE IF NOT EXISTS ${DB_SCORES_TABLE} (
			position      						SMALLINT NOT NULL,
			is_scraped      					BOOLEAN NOT NULL,
			retrieved_at     					TIMESTAMPTZ NOT NULL,
			stable      							BOOLEAN NOT NULL,
      id                  			BIGINT PRIMARY KEY,
      user_id             			INTEGER NOT NULL,
      ruleset_id          			SMALLINT NOT NULL,
      beatmap_id          			BIGINT NOT NULL,
      has_replay          			BOOLEAN NOT NULL DEFAULT FALSE,
      rank                			CHAR(2) NOT NULL DEFAULT '',
      accuracy            			REAL NOT NULL DEFAULT 0,
      max_combo           			INTEGER NOT NULL DEFAULT 0,
      total_score         			INTEGER NOT NULL DEFAULT 0,
      classic_total_score 			BIGINT,
      total_score_without_mods 	INTEGER,
      is_perfect_combo    			BOOLEAN NOT NULL DEFAULT FALSE,
      legacy_perfect      			BOOLEAN NOT NULL DEFAULT FALSE,
      pp                 				REAL DEFAULT NULL,
      legacy_total_score  			BIGINT NOT NULL DEFAULT 0,
      ended_at            			TIMESTAMPTZ NOT NULL,
      data               			 	JSONB NOT NULL DEFAULT '{}'::jsonb,

			CONSTRAINT beatmap_fk FOREIGN KEY (beatmap_id)
    	REFERENCES ${DB_BEATMAPS_TABLE}(id)
		)`);
	// TODO: after adding players table
	// 			CONSTRAINT user_fk FOREIGN KEY (user_id)
	// REFERENCES ${DB_PLAYERS_TABLE}(id)

	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_beatmap_id_idx ON ${DB_SCORES_TABLE}(beatmap_id)`);
	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_position_idx ON ${DB_SCORES_TABLE}(position)`);
	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_ended_at_idx ON ${DB_SCORES_TABLE}(ended_at)`);
	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_user_id_idx ON ${DB_SCORES_TABLE}(user_id)`);
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

// takes in 100 scores from the same beatmap converted from endpoint
async function mergeSingleBeatmapScoresIntoExisting(scores: BeatmapScoreFull[]) {
	if (!scores?.length) return;

	const beatmapId = scores[0].beatmapId;
	const existingResult = await client.query(`SELECT * from ${DB_SCORES_TABLE} s where s.beatmap_id = $1`, [beatmapId]);

	const existingById = new Map<number, BeatmapScoreFull>();
	const existingByUser = new Map<number, BeatmapScoreFull>();

	for (const row of existingResult.rows) {
		const existingScore = convertDatabaseScore(row);
		existingById.set(existingScore.id, existingScore);
		if (!existingByUser.has(existingScore.userId)) existingByUser.set(existingScore.userId, existingScore);
	}

	const mergedById = new Map(existingById);

	for (const score of scores) {
		const existingByIdScore = existingById.get(score.id);

		if (existingByIdScore) {
			if (existingByIdScore.totalScore == score.totalScore) {
				existingByIdScore.isScraped = score.isScraped;
				existingByIdScore.retrievedAt = score.retrievedAt;
				mergedById.set(existingByIdScore.id, existingByIdScore);
				continue;
			}
			mergedById.delete(existingByIdScore.id);
		}

		const existingByUserScore = existingByUser.get(score.userId);
		if (existingByUserScore && existingByUserScore.id != score.id) mergedById.delete(existingByUserScore.id);

		mergedById.set(score.id, score);
	}

	// TODO bug with position still
	const finalScores = Array.from(mergedById.values()).sort((a, b) => {
		if (a.totalScore != b.totalScore) return b.totalScore - a.totalScore;
		if (a.endedAt.getTime() != b.endedAt.getTime()) return a.endedAt.getTime() - b.endedAt.getTime();
		return a.id - b.id;
	});

	const values: unknown[] = [];
	const paramGroups = finalScores.map((score, index) => {
		const offset = index * SCORE_TABLE_COLUMNS.length;
		values.push(
			(score.position = index + 1),
			score.isScraped,
			score.retrievedAt,
			score.stable,
			score.id,
			score.userId,
			score.rulesetId,
			score.beatmapId,
			score.hasReplay,
			score.rank,
			score.accuracy,
			score.maxCombo,
			score.totalScore,
			score.classicTotalScore ?? null,
			score.totalScoreWithoutMods ?? null,
			score.isPerfectCombo,
			score.legacyPerfect,
			score.pp ?? null,
			score.legacyTotalScore,
			score.endedAt,
			convertAdditionalDataToJsonb(score.data)
		);

		return `(${SCORE_TABLE_COLUMNS.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
	});

	const query = `INSERT INTO ${DB_SCORES_TABLE} (${SCORE_TABLE_COLUMNS.join(", ")}) VALUES ${paramGroups.join(", ")}`;

	await client.query("BEGIN");
	try {
		await client.query(query, values);
		await client.query(`UPDATE ${DB_BEATMAPS_TABLE} SET last_scores_scrape = NOW() WHERE id = $1`, [beatmapId]);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

async function handleBeatmap(beatmapId: number, rowNo: number, headers: Record<string, string>) {
	await rateLimit();

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

		for (let i = 0; i < beatmapIds.length; i++) {
			await handleBeatmap(beatmapIds[i], i + 1, headers);
		}

		// TODO graceful shutdown handling to ensure logs are flushed and DB connection is closed even if the process is killed mid-run
		logInfo(infoLogStream, "Finished processing all beatmaps");
	} finally {
		await client.end();
		infoLogStream.end();
		errorLogStream.end();
	}
}

scrapeScores();
