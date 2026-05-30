import dotenv from "dotenv";

dotenv.config({ path: "../.env", quiet: true });

export const OSU_CLIENT_ID = process.env.OSU_CLIENT_ID;
export const OSU_CLIENT_SECRET = process.env.OSU_CLIENT_SECRET;
if (!OSU_CLIENT_ID || !OSU_CLIENT_SECRET)
	throw new Error("OSU_CLIENT_ID and OSU_CLIENT_SECRET must be set in the environment variables.");

export const OSU_API_VERSION = process.env.OSU_API_VERSION || "20260530";

export const DB_URI = process.env.DB_URI || "mongodb://localhost:27017";
export const DB_NAME = process.env.DB_NAME || "pog_stats";
export const DB_SCORES_COLLECTION = process.env.DB_SCORES_COLLECTION || "scores";
export const DB_PLAYERS_COLLECTION = process.env.DB_PLAYERS_COLLECTION || "players";
export const DB_BEATMAPS_COLLECTION = process.env.DB_BEATMAPS_COLLECTION || "beatmaps";

export const BEATMAP_ID_PATH = process.env.BEATMAP_ID_PATH || "../data/beatmap_ids.txt";
export const SCORE_SCRAPE_LOG_PATH = process.env.SCORE_SCRAPE_LOG_PATH || "../data/logs/scrape_scores.log";
export const SCORE_SCRAPE_ERROR_LOG_PATH =
	process.env.SCORE_SCRAPE_ERROR_LOG_PATH || "../data/logs/scrape_scores_errors.log";

const parsedScrapeDelayMs = Number(process.env.SCRAPE_SCORE_DELAY_MS);
export const SCRAPE_SCORE_DELAY_MS = Number.isFinite(parsedScrapeDelayMs) ? parsedScrapeDelayMs : 950;

export const VERBOSE = process.env.VERBOSE?.toLowerCase() === "true";
