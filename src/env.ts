import dotenv from "dotenv";

dotenv.config({ path: "../../.env", quiet: true });

export const OSU_CLIENT_ID = process.env.OSU_CLIENT_ID;
export const OSU_CLIENT_SECRET = process.env.OSU_CLIENT_SECRET;
export const OSU_API_VERSION = process.env.OSU_API_VERSION || "20260720";

export const DB_HOST = process.env.DB_HOST || "localhost";
const parsedDbPort = Number(process.env.DB_PORT);
export const DB_PORT = Number.isFinite(parsedDbPort) ? parsedDbPort : 5432;
export const DB_USER = process.env.DB_USER;
export const DB_PASSWORD = process.env.DB_PASSWORD;
export const DB_NAME = process.env.DB_NAME || "pogstats";

export const DB_CONFIG_TABLE = process.env.DB_CONFIG_TABLE || "CONFIG";
export const DB_SCORES_TABLE = process.env.DB_SCORES_TABLE || "SCORES";
export const DB_PLAYERS_TABLE = process.env.DB_PLAYERS_TABLE || "PLAYERS";
// export const DB_PLAYER_RULESET_STATS_TABLE = process.env.DB_PLAYER_RULESET_STATS_TABLE || "PLAYER_RULESET_STATS";
export const DB_PLAYER_POG_BADGES_TABLE = process.env.DB_PLAYER_POG_BADGES_TABLE || "PLAYER_POG_BADGES";
export const DB_POG_BADGES_TABLE = process.env.DB_POG_BADGES_TABLE || "POG_BADGES";
export const DB_BEATMAPS_TABLE = process.env.DB_BEATMAPS_TABLE || "BEATMAPS";
// export const DB_BEATMAPSETS_TABLE = process.env.DB_BEATMAPSETS_TABLE || "BEATMAPSETS";
export const DB_BEATMAP_RULESET_UPDATE_DATES_TABLE =
	process.env.DB_BEATMAP_RULESET_UPDATE_DATES_TABLE || "BEATMAP_RULESET_UPDATE_DATES";
export const DB_RANKING_TYPES_TABLE = process.env.DB_RANKING_TYPES_TABLE || "RANKING_TYPES";
export const DB_HISTORICAL_RANKINGS_TABLE = process.env.DB_HISTORICAL_RANKINGS_TABLE || "HISTORICAL_RANKINGS";
export const DB_HISTORICAL_PLAYER_SNIPES_TABLE =
	process.env.DB_HISTORICAL_PLAYER_SNIPES_TABLE || "HISTORICAL_PLAYER_SNIPES";
export const DB_PLAYER_MIA_HISTORY_TABLE = process.env.DB_PLAYER_MIA_HISTORY_TABLE || "PLAYER_MIA_HISTORY";

const parsedServerPort = Number(process.env.SERVER_PORT);
export const SERVER_PORT = Number.isFinite(parsedServerPort) ? parsedServerPort : 3727;

const parsedMetricsPort = Number(process.env.METRICS_PORT);
export const METRICS_PORT = Number.isFinite(parsedMetricsPort) ? parsedMetricsPort : SERVER_PORT;

export const DEV_ENV = process.env.DEV_ENV?.toLowerCase() === "true";
export const VERBOSE = process.env.VERBOSE?.toLowerCase() === "true";

export const SCORE_SCRAPE_LOG_PATH = process.env.SCORE_SCRAPE_LOG_PATH || "../../data/logs/scrape_scores.log";
export const SCORE_SCRAPE_ERROR_LOG_PATH =
	process.env.SCORE_SCRAPE_ERROR_LOG_PATH || "../../data/logs/scrape_scores_errors.log";

const parsedScoreScrapeDelayMs = Number(process.env.SCRAPE_SCORE_DELAY_MS);
export const SCRAPE_SCORE_DELAY_MS = Number.isFinite(parsedScoreScrapeDelayMs) ? parsedScoreScrapeDelayMs : 1800;
const parsedPlayerScrapeDelayMs = Number(process.env.SCRAPE_PLAYER_DELAY_MS);
export const SCRAPE_PLAYER_DELAY_MS = Number.isFinite(parsedPlayerScrapeDelayMs)
	? parsedPlayerScrapeDelayMs
	: SCRAPE_SCORE_DELAY_MS;
