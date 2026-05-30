import fs from "fs";
import readline from "readline";
import { OSU_API_VERSION } from "./env.js";

export type ScoreRank = "XH" | "X" | "SH" | "S" | "A" | "B" | "C" | "D";
export type ScoreType = "score_best_osu" | "score_best_taiko" | "score_best_fruits" | "score_best_mania"; // ???
export type RulesetId = 0 | 1 | 2 | 3;
export type Ruleset = "osu" | "taiko" | "fruits" | "mania";
export interface BeatmapScoreParams {
	mode?: Ruleset;
	mods?: string;
	legacy_only?: 0 | 1;
	type?: string;
	limit?: number;
}

export interface ApiBeatmapScoreLegacy {
	score_count: number;
	scores: ApiScoreLegacy[];
}

export interface ApiScoreHitStatsLegacy {
	count_100: number;
	count_300: number;
	count_50: number;
	count_geki: null | number;
	count_katu: null | number;
	count_miss: number;
}

export interface ApiScoreLegacy {
	accuracy: number; //0-1
	best_id: number;
	created_at: string; // ISO 8601 format, e.g. "2026-05-30T07:32:56Z"
	id: number;
	max_combo: number;
	mode: Ruleset;
	mode_int: RulesetId;
	mods: string[];
	passed: true;
	perfect: boolean;
	pp: number;
	rank: ScoreRank;
	replay: boolean;
	score: number;
	statistics: ApiScoreHitStatsLegacy;
	type: ScoreType;
	user_id: number;
	current_user_attributes: { pin: unknown | null };
	user: ApiScorePlayerLegacy;
}

export interface ApiScorePlayerLegacy {
	avatar_url: string;
	country_code: string; // TODO?: country code list
	default_group: string;
	id: number;
	is_active: boolean;
	is_bot: boolean;
	is_deleted: boolean;
	is_online: boolean;
	is_supporter: boolean;
	last_visit: string; // ISO 8601 format, e.g. "2026-05-30T07:32:56Z"
	pm_friends_only: boolean;
	profile_colour: string | null;
	username: string;
	country: { code: string; name: string }; // TODO?: country code list
	cover: {
		custom_url: string;
		url: string;
		id: unknown | null;
	};
	team: unknown | null;
}

// ------------------------------------------
export interface ApiBeatmapScore {
	score_count: number;
	scores: ApiScore[];
}

export interface ApiScore {
	accuracy: number; //0-1
	beatmap_id: number;
	best_id?: number;
	build_id?: number;
	classic_total_score: number;
	ended_at: string; // ISO 8601 format, e.g. "2020-01-01T00:00:00+00:00"
	has_replay: boolean;
	id: number;
	is_perfect_combo: boolean;
	legacy_perfect: boolean;
	legacy_score_id?: number;
	legacy_total_score: number;
	max_combo: number;
	maximum_statistics: ApiScoreHitStats;
	mods: ApiMod[];
	passed: true;
	playlist_item_id: number;
	pp?: number;
	preserve: boolean;
	processed: boolean;
	rank: ScoreRank;
	ranked: boolean;
	room_id: number;
	ruleset_id: RulesetId;
	started_at?: string; // ISO 8601 format, e.g. "2020-01-01T00:00:00+00:00"
	statistics: ApiScoreHitStats;
	total_score: number;
	type: string;
	user_id: number;
}

export interface ApiMod {
	acronym: string;
	settings?: Record<string, unknown>;
}

export type ApiScoreHitType =
	| "miss"
	| "meh"
	| "ok"
	| "good"
	| "great"
	| "perfect"
	| "smallTickMiss"
	| "smallTickHit"
	| "largeTickMiss"
	| "largeTickHit"
	| "smallBonus"
	| "largeBonus"
	| "ignoreMiss"
	| "ignoreHit"
	| "comboBreak"
	| "sliderTailHit"
	| "legacyComboIncrease";
export type ApiScoreHitStats = Record<ApiScoreHitType, number>;

// ------------------------------------------
export interface BeatmapScore {
	_id: import("mongodb").Long;
	beatmapId: import("mongodb").Long;
	position: import("mongodb").Int32;
	accuracy: import("mongodb").Double;
	timestamp: import("mongodb").Long;
	score: import("mongodb").Int32;
	scoreClassic: import("mongodb").Long;
	pp: import("mongodb").Double;
	rank: ScoreRank;
	mods: ApiMod[];
	userId: import("mongodb").Int32;
}

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
