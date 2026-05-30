export type ScoreRank = "XH" | "X" | "SH" | "S" | "A" | "B" | "C" | "D";
export type RulesetId = 0 | 1 | 2 | 3;
export type Ruleset = "osu" | "taiko" | "fruits" | "mania";
export interface BeatmapScoreParams {
	mode?: Ruleset;
	mods?: string;
	legacy_only?: 0 | 1;
	type?: string;
	limit?: number;
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
