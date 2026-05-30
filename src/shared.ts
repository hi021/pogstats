import fs from "fs";
import readline from "readline";
import { OSU_API_VERSION } from "./env.js";
import { BeatmapScoreParams } from "./types.js";

export const API_BASE_URL = "https://osu.ppy.sh/api/v2";
// export const RULESET_MAP = new Map(["osu", "taiko", "fruits", "mania"].map(mode => [mode, mode]));

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
