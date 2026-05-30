import fs from "fs";
import { Collection, Double, Int32, Long, MongoClient } from "mongodb";
import path from "path";
import { getOAuthToken } from "./auth.js";
import {
	BEATMAP_ID_PATH,
	DB_NAME,
	DB_SCORES_COLLECTION,
	DB_URI,
	SCORE_SCRAPE_ERROR_LOG_PATH,
	SCORE_SCRAPE_LOG_PATH,
	SCRAPE_SCORE_DELAY_MS,
	VERBOSE
} from "./env.js";
import {
	ApiBeatmapScore,
	ApiScore,
	BeatmapScore,
	buildBeatmapScoresUrl,
	buildHeadersWithAuth,
	readFileByLine
} from "./shared.js";

let collection: Collection<BeatmapScore>;
let infoLogStream: fs.WriteStream;
let errorLogStream: fs.WriteStream;
let lastFetchTimestamp = 0;

function createLogStream(filePath: string) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	return fs.createWriteStream(filePath, { flags: "a", encoding: "utf-8" });
}

function logInfo(message: string, timestamp = new Date().toISOString()) {
	const logMessage = `${timestamp} ${message}`;
	if (VERBOSE) console.log(logMessage);
	infoLogStream.write(`${logMessage}\n`);
}

function logError(message: string, error?: unknown, timestamp = new Date().toISOString()) {
	const logMessage = `${timestamp} ${message}\n${error}`;
	if (VERBOSE) console.error(logMessage);
	errorLogStream.write(`${logMessage}\n`);
	// errorLogStream.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
}

async function rateLimit() {
	const now = Date.now();
	const elapsed = now - lastFetchTimestamp;
	if (lastFetchTimestamp > 0 && elapsed < SCRAPE_SCORE_DELAY_MS)
		await new Promise(resolve => setTimeout(resolve, SCRAPE_SCORE_DELAY_MS - elapsed));

	lastFetchTimestamp = Date.now();
}

function convertApiScore(apiScore: ApiScore, position: number): BeatmapScore {
	return {
		_id: new Long(apiScore.id),
		beatmapId: new Long(apiScore.beatmap_id),
		position: new Int32(position),
		accuracy: new Double(Math.round(apiScore.accuracy * 10000000) / 10000000),
		timestamp: new Long(Date.parse(apiScore.ended_at)),
		score: new Int32(apiScore.total_score),
		scoreClassic: new Long(apiScore.classic_total_score),
		pp: apiScore.pp ? new Double(Math.round(apiScore.pp * 1000) / 1000) : new Double(0),
		rank: apiScore.rank,
		mods: apiScore.mods,
		userId: new Int32(apiScore.user_id)
	};
}

async function handleBeatmap(idRaw: string, rowNo: number, headers: Record<string, string>) {
	const beatmapId = idRaw.trim();
	if (!beatmapId) return;

	await rateLimit();

	try {
		logInfo(`[${beatmapId}][#${rowNo}] - Processing beatmap`);

		const response = await fetch(buildBeatmapScoresUrl(beatmapId), { headers });
		if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

		const data = (await response.json()) as ApiBeatmapScore;
		const convertedScores = data.scores.map((score, index) => convertApiScore(score, index + 1));
		await collection.insertMany(convertedScores);

		logInfo(`[${beatmapId}][#${rowNo}] - Processed ${convertedScores.length} scores`);
	} catch (e) {
		logError(`[${beatmapId}][#${rowNo}] - Processing failed`, e);
	}
}

async function scrapeScores() {
	const token = await getOAuthToken();
	const headers = buildHeadersWithAuth(token);
	const client = new MongoClient(DB_URI);

	infoLogStream = createLogStream(SCORE_SCRAPE_LOG_PATH);
	errorLogStream = createLogStream(SCORE_SCRAPE_ERROR_LOG_PATH);

	try {
		await client.connect();
		collection = client.db(DB_NAME).collection(DB_SCORES_COLLECTION);

		await readFileByLine(BEATMAP_ID_PATH, (idRaw: string, rowNo: number) => handleBeatmap(idRaw, rowNo, headers));
		logInfo("Finished processing all beatmaps");
	} finally {
		await client.close();
		infoLogStream.end();
		errorLogStream.end();
	}
}

scrapeScores();
