import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER, OSU_API_VERSION, VERBOSE } from "../env.js";

export const AUTH_ENDPOINT = "https://osu.ppy.sh/oauth/token";
export const USER_AUTH_ENDPOINT = "https://osu.ppy.sh/oauth/authorize";
export const API_BASE_URL = "https://osu.ppy.sh/api/v2";
export const BEATMAP_DB_BASE_URL = "https://osu.respektive.pw";
export const BEATMAP_DB_BEATMAP_FETCH_URL = `${BEATMAP_DB_BASE_URL}/b`;

export const USER_AGENT = "pog!stats (+https://github.com/hi021/pogstats)";
export const DEFAULT_HEADERS = {
	Accept: "application/json",
	"Content-Type": "application/json",
	"User-Agent": USER_AGENT
};
export const DEFAULT_OSU_API_HEADERS = {
	...DEFAULT_HEADERS,
	"X-API-Version": OSU_API_VERSION
};

export function formatMilliseconds(ms: number) {
	if (!ms) return "instant";
	if (ms < 60 * 1000) return `${Math.round((ms / 1000) * 10) / 10} s`;
	const h = Math.floor(ms / (60 * 60 * 1000));
	ms -= h * 60 * 60 * 1000;
	const m = Math.round(ms / (60 * 1000));

	let s = h ? h + (h == 1 ? " hour " : " hours ") : "";
	s += m ? m + (m == 1 ? " minute" : " minutes") : "";
	return s.trim();
}

export const buildHeadersWithAuth = (token: string) => {
	return {
		...DEFAULT_OSU_API_HEADERS,
		Authorization: `Bearer ${token}`
	};
};

export function parseIdList(idString?: string): number[] | undefined {
	if (!idString) return;

	const ids = idString.split(",").map(id => {
		const parsed = parseInt(id.trim(), 10);
		if (isNaN(parsed) || parsed <= 0) throw new Error(`Invalid ID: ${id.trim()}`);
		return parsed;
	});

	return ids;
}

export function getMinDate(value: string | undefined) {
	if (!value) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error(`Invalid date for --minDate: ${value}`);

	return date;
}

export function convertApiPlayerLookup(player: ApiUserLookup, retrievedAt: Date, isFromOsuApi = true, isMia = false): Player {
	return {
		id: player.id,
		username: player.username,
		countryCode: player.country_code,
		isActive: player.is_active,
		teamId: player.team?.id,
		coverUrl: player.cover?.url,
		retrievedAt,
		isFromOsuApi,
		isMia
	};
}

export function convertApiBeatmap(map: ApiBeatmapDbBeatmap, retrievedAt: Date): Beatmap {
	return {
		id: map.beatmap_id,
		beatmapsetId: map.beatmapset_id,
		status: map.approved,
		artist: map.artist,
		title: map.title,
		version: map.version,
		creator: map.creator,
		creatorId: map.creator_id,
		rulesetId: map.mode,
		approvedDate: new Date(map.approved_date),
		starRating: map.star_rating,
		totalLength: map.total_length,
		bpm: map.bpm,
		cs: map.cs,
		od: map.od,
		ar: map.ar,
		hp: map.hp,
		packs: map.packs,
		updatedAt: retrievedAt
	};
}

export function doesBeatmapHaveLeaderboards(map: ApiBeatmapDbBeatmap) {
	return [1, 2, 4].includes(map.approved);
}

export type TimestampAccessor = {
	get: () => number;
	set: (value: number) => void;
};

export async function rateLimit(accessor: TimestampAccessor, delayMs: number) {
	const now = Date.now();
	const lastFetchTimestamp = accessor.get();
	const elapsed = now - lastFetchTimestamp;
	if (lastFetchTimestamp > 0 && elapsed < delayMs) await new Promise(resolve => setTimeout(resolve, delayMs - elapsed));

	accessor.set(Date.now());
}

export const buildScoresUrl = (scoreCursor?: number | string, ruleset?: Ruleset) => {
	const url = new URL(`${API_BASE_URL}/scores`);
	if (scoreCursor != null) url.searchParams.append("cursor_string", scoreCursor.toString());
	if (ruleset) url.searchParams.append("ruleset", ruleset);
	return url;
};

export const buildBeatmapScoresUrl = (beatmapId: number | string, params: BeatmapScoreParams = { mode: "osu", limit: 100 }) => {
	const url = new URL(`${API_BASE_URL}/beatmaps/${beatmapId}/scores`);
	for (const [key, value] of Object.entries(params)) {
		if (value != null) url.searchParams.append(key, String(value));
	}

	return url;
};

export const buildUsersUrl = (userIds: Array<number | string>) => {
	const url = new URL(`${API_BASE_URL}/users`);
	url.searchParams.append("ids[]", userIds.join(","));
	return url;
};

export const buildUserLookupUrl = (userIds: Array<number | string>) => {
	const url = new URL(`${API_BASE_URL}/users/lookup`);
	for (const userId of userIds) url.searchParams.append("ids[]", String(userId));
	return url;
};

export const buildBeatmapDbUrl = (beatmapIds: Array<number | string>) => {
	return new URL(`${BEATMAP_DB_BEATMAP_FETCH_URL}/${beatmapIds.join(",")}`);
};

export async function readFileByLine(filePath: string, lineCallback: (line: string, rowNo: number) => Promise<any>) {
	const fileStream = fs.createReadStream(filePath);
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity
	});

	let rowNo = 0;
	for await (const line of rl) await lineCallback(line, ++rowNo);
}

export function createLogStream(filePath: string) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	return fs.createWriteStream(filePath, { flags: "a", encoding: "utf-8" });
}

export function logInfo(stream: fs.WriteStream, message: string, timestamp = new Date().toISOString()) {
	const logMessage = `${timestamp} ${message}`;
	if (VERBOSE) console.log(logMessage);
	stream.write(`${logMessage}\n`);
}

export function logError(stream: fs.WriteStream, message: string, error?: unknown, timestamp = new Date().toISOString()) {
	const logMessage = `${timestamp} ${message}\n$${Error.isError(error) ? (error.stack ?? error.message) : String(error)}`;
	if (VERBOSE) console.error(logMessage);
	stream.write(`${logMessage}\n`);
}

export async function dumpTableToCsv(
	tableName: string,
	infoLogStream?: fs.WriteStream,
	customQuery?: string,
	resultPath = "../../data"
) {
	if (!DB_USER || !DB_NAME) throw new Error("DB_USER or DB_NAME env variables are not set");

	const dumpFilePath = path.resolve(
		process.cwd(),
		resultPath,
		`${tableName}_table_dump_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`
	);
	fs.mkdirSync(path.dirname(dumpFilePath), { recursive: true });

	const query = customQuery || `SELECT * FROM ${tableName}`;
	const psqlArgs = [
		"-h",
		DB_HOST,
		"-p",
		String(DB_PORT),
		"-U",
		DB_USER,
		"-d",
		DB_NAME,
		"-c",
		`COPY (${query}) TO STDOUT WITH CSV HEADER`
	] as const;

	const psql = spawn("psql", psqlArgs, {
		env: {
			...process.env,
			PGPASSWORD: DB_PASSWORD
		},
		stdio: ["ignore", "pipe", "pipe"],
		shell: false
	});

	if (!psql.stdout || !psql.stderr) throw new Error("psql did not provide stdout/stderr streams");

	const writeStream = fs.createWriteStream(dumpFilePath, { encoding: "utf8" });
	psql.stdout.pipe(writeStream);

	let stderr = "";
	psql.stderr.on("data", (chunk: Buffer | string) => (stderr += chunk.toString()));

	await Promise.all([
		new Promise<void>((resolve, reject) => {
			writeStream.on("finish", resolve);
			writeStream.on("error", reject);
		}),
		new Promise<void>((resolve, reject) => {
			psql.on("error", reject);
			psql.on("close", code => {
				if (code !== 0) reject(new Error(`psql COPY failed with code ${code}: ${stderr}`));
				else resolve();
			});
		})
	]);

	infoLogStream && logInfo(infoLogStream, `Dumped table ${tableName} to ${dumpFilePath}`);
}
