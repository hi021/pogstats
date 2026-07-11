import fs from "fs";
import path from "path";
import { Client } from "pg";
import readline from "readline";
import { OSU_API_VERSION, VERBOSE } from "../env.js";

export const AUTH_ENDPOINT = "https://osu.ppy.sh/oauth/token";
export const USER_AUTH_ENDPOINT = "https://osu.ppy.sh/oauth/authorize";
export const API_BASE_URL = "https://osu.ppy.sh/api/v2";
export const BEATMAP_DB_BASE_URL = "https://osu.respektive.pw";

export const USER_AGENT = "pog!stats (+https://github.com/hi021/pogstats)"
export const DEFAULT_HEADERS = {
	Accept: "application/json",
	"Content-Type": "application/json",
	"X-API-Version": OSU_API_VERSION,
	"User-Agent": USER_AGENT
};

// I am the GOD of ajvascript
export function buildRandomString() {
	return String.fromCharCode(
		Math.round(Math.random() * 25 + 65),
		Math.round(Math.random() * 25 + 65),
		Math.round(Math.random() * 25 + 65),
		Math.round(Math.random() * 25 + 65),
		Math.round(Math.random() * 25 + 65),
		Math.round(Math.random() * 25 + 65),
		Math.round(Math.random() * 25 + 65),
		Math.round(Math.random() * 25 + 65)
	);
}

export const buildHeadersWithAuth = (token: string) => {
	return {
		...DEFAULT_HEADERS,
		Authorization: `Bearer ${token}`
	};
};

export function getMinDate(value: string | undefined) {
	if (!value) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error(`Invalid date for --minDate: ${value}`);

	return date;
}

export function convertApiPlayerLookup(
	player: ApiUserLookup,
	retrievedAt: Date,
	isFromOsuApi = true,
	isMia = false
): Player {
	return {
		id: player.id,
		username: player.username,
		countryCode: player.country_code,
		isActive: player.is_active,
		teamId: player.team?.id,
		coverUrl: player.cover?.url, // TODO: verify the difference between url and custom_url
		retrievedAt,
		isFromOsuApi,
		isMia
	};
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

export const buildBeatmapScoresUrl = (
	beatmapId: number | string,
	params: BeatmapScoreParams = { mode: "osu", limit: 100 }
) => {
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

export async function readFileByLine(filePath: string, lineCallback: (line: string, rowNo: number) => Promise<void>) {
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

export function logError(
	stream: fs.WriteStream,
	message: string,
	error?: unknown,
	timestamp = new Date().toISOString()
) {
	const logMessage = `${timestamp} ${message}\n$${Error.isError(error) ? (error.stack ?? error.message) : String(error)}`;
	if (VERBOSE) console.error(logMessage);
	stream.write(`${logMessage}\n`);
}

function csvEscape(value: unknown): string {
	if (value === null || value === undefined) return "";
	return typeof value === "object" ? `"${JSON.stringify(value).replace(/"/g, '""')}"` : String(value);
}

export async function dumpTableToCsv(
	tableName: string,
	columns: readonly string[],
	client: Client,
	infoLogStream?: fs.WriteStream,
	customQuery?: string,
	resultPath = "../../data"
) {
	const result = await client.query(customQuery || `SELECT * FROM ${tableName}`);
	const dumpFilePath = path.resolve(
		process.cwd(),
		resultPath,
		`${tableName}_table_dump_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`
	);
	fs.mkdirSync(path.dirname(dumpFilePath), { recursive: true });

	const stream = fs.createWriteStream(dumpFilePath, { encoding: "utf8" });
	stream.write(`${columns.join(",")}\n`);
	for (const row of result.rows) {
		const line = columns.map(column => csvEscape(row[column])).join(",");
		stream.write(`${line}\n`);
	}

	await new Promise<void>((resolve, reject) => {
		stream.on("finish", resolve);
		stream.on("error", reject);
		stream.end();
	});

	infoLogStream && logInfo(infoLogStream, `Dumped ${result.rows.length} rows from ${tableName} to ${dumpFilePath}`);
}
