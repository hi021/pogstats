import { Ruleset, RulesetId, ScoreRank } from "./types.js";

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
	type: string;
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
