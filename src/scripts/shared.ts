import fs from "fs";
import path from "path";
import readline from "readline";
import { OSU_API_VERSION, VERBOSE } from "./env.js";

export const API_BASE_URL = "https://osu.ppy.sh/api/v2";

export const DEFAULT_HEADERS = {
	Accept: "application/json",
	"Content-Type": "application/json",
	"X-API-Version": OSU_API_VERSION
};

export const buildHeadersWithAuth = (token: string) => {
	return {
		...DEFAULT_HEADERS,
		Authorization: `Bearer ${token}`
	};
};

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

export async function readFileByLine(filePath: string, lineCallback: (line: string, rowNo: number) => Promise<void>) {
	const fileStream = fs.createReadStream(filePath);
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity
	});

	let rowNo = 0;
	for await (const line of rl) {
		await lineCallback(line, ++rowNo);
	}
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
	const logMessage = `${timestamp} ${message}\n${error}`;
	if (VERBOSE) console.error(logMessage);
	stream.write(`${logMessage}\n`);
	// stream.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
}
