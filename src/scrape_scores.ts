// Sequentially "scrapes" all top 100 scores for each beatmap ID listed under BEATMAP_ID_PATH and stores them in DB_SCORES_TABLE postgres table.
// Re-authenticates w/ OAuth2 for every script run
// Includes peppy-pleasing rate limiting (SCRAPE_SCORE_DELAY_MS) and saves logs to SCORE_SCRAPE_LOG_PATH and SCORE_SCRAPE_ERROR_LOG_PATH

import fs from "fs";
import { Client } from "pg";
import { getOAuthToken } from "./auth.js";
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
import { buildBeatmapScoresUrl, buildHeadersWithAuth, createLogStream, logError, logInfo } from "./shared.js";

//////// Set this, can be null
const ONLY_SCRAPE_IF_SAVED_BEFORE_THIS_DATE = new Date("2026-05-31T19:13:50.471Z");
////////

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
		rank: apiScore.rank,
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

function convertAdditionalDataToJsonb(additionalData: BeatmapScoreAdditionalData) {
	return JSON.stringify(additionalData);
}

async function createScoresTable() {
	logInfo(infoLogStream, `Attempting to create ${DB_SCORES_TABLE} table and add indexes and comments`);

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
	// TODO: after adding scores table
	// 			CONSTRAINT user_fk FOREIGN KEY (user_id)
	// REFERENCES ${DB_PLAYERS_TABLE}(id)

	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_beatmap_id_idx ON ${DB_SCORES_TABLE}(beatmap_id)`);
	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_position_idx ON ${DB_SCORES_TABLE}(position)`);
	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_ended_at_idx ON ${DB_SCORES_TABLE}(ended_at)`);
	await client.query(`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_user_id_idx ON ${DB_SCORES_TABLE}(user_id)`);

	await client.query(
		`COMMENT ON COLUMN ${DB_SCORES_TABLE}.position IS 'Meta (not from the API): 1-based position of the score on the beatmap'`
	);
	await client.query(
		`COMMENT ON COLUMN ${DB_SCORES_TABLE}.data IS 'mods, maximum_statistics, statistics columns from the API as JSONB'`
	);
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
}

// takes in 100 scores from the same beatmap converted from endpoint
async function insertScoresFromScrape(scores: BeatmapScoreFull[]) {
	if (!scores?.length) return;

	const columns = [
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
	];

	const values: unknown[] = [];
	const paramGroups = scores.map((score, index) => {
		const offset = index * columns.length;
		values.push(
			score.position,
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

		return `(${columns.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
	});

	// TODO: this probably should update the entire record, scores can be recalculated, etc.
	const query = `INSERT INTO ${DB_SCORES_TABLE} (${columns.join(", ")}) VALUES ${paramGroups.join(", ")} ON CONFLICT (id) DO NOTHING`;
	await client.query(query, values);
	await client.query(`UPDATE ${DB_BEATMAPS_TABLE} SET last_scores_scrape = NOW() WHERE id = $1`, [scores[0].beatmapId]);
}

async function handleBeatmap(beatmapId: number, rowNo: number, headers: Record<string, string>) {
	await rateLimit();

	try {
		logInfo(infoLogStream, `[${beatmapId}][#${rowNo}] - Processing beatmap`);

		const response = await fetch(buildBeatmapScoresUrl(beatmapId), { headers });
		if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

		const data = (await response.json()) as ApiBeatmapScore;
		const convertedScores = data.scores.map((score, index) => convertApiScore(score, index + 1));
		await insertScoresFromScrape(convertedScores);

		logInfo(infoLogStream, `[${beatmapId}][#${rowNo}] - Processed ${convertedScores.length} scores`);
	} catch (e) {
		logError(errorLogStream, `[${beatmapId}][#${rowNo}] - Processing failed`, e);
	}
}

async function getBeatmapIds(maxRetrievedAt?: Date): Promise<number[]> {
	return (
		await client.query(
			`SELECT id FROM ${DB_BEATMAPS_TABLE} WHERE status IN ('ranked','approved','loved') AND mode = 'osu' ${maxRetrievedAt ? `AND (last_scores_scrape < $1 OR last_scores_scrape IS NULL)` : ""} ORDER BY id`,
			[maxRetrievedAt]
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
		await addBeatmapColumns();

		const headers = buildHeadersWithAuth(await getOAuthToken());
		const beatmapIds = await getBeatmapIds(ONLY_SCRAPE_IF_SAVED_BEFORE_THIS_DATE);
		logInfo(infoLogStream, `Found ${beatmapIds.length} beatmap IDs to process`);

		for (let i = 0; i < beatmapIds.length; i++) {
			await handleBeatmap(beatmapIds[i], i + 1, headers);
		}

		logInfo(infoLogStream, "Finished processing all beatmaps");
	} finally {
		await client.end();
		infoLogStream.end();
		errorLogStream.end();
	}
}

scrapeScores();
