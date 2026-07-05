interface ApiBeatmapScore {
	score_count: number;
	scores: ApiScore[];
}

type WsScore = Omit<ApiScore, "user">;

interface ApiScore {
	accuracy: number; // 0-1
	beatmap_id: number;
	best_id?: number;
	build_id?: number;
	classic_total_score: number;
	ended_at: string; // ISO 8601 format, e.g. "2020-01-01T00:00:00+00:00"
	has_replay: boolean;
	replay: boolean;
	id: number;
	is_perfect_combo: boolean;
	legacy_perfect: boolean;
	legacy_score_id?: number;
	legacy_total_score: number;
	max_combo: number;
	maximum_statistics: ApiScoreHitStats;
	statistics: ApiScoreHitStats;
	total_score_without_mods: number; // undocumented
	mods: ApiMod[];
	passed: true;
	pp?: number;
	preserve: boolean;
	processed: boolean;
	ranked: boolean;
	rank: ApiScoreRank;
	type: string;
	ruleset_id: RulesetId;
	started_at?: string; // ISO 8601 format, e.g. "2020-01-01T00:00:00+00:00"
	total_score: number;
	user_id: number;
	room_id?: number;
	playlist_item_id?: number;
	current_user_attributes: { pin?: unknown };
	user: Record<string, unknown>;
}

interface ApiMod {
	acronym: string;
	settings?: Record<string, unknown>;
}

type ApiScoreHitStats = Partial<Record<ApiScoreHitType, number>>;
type ApiScoreHitType =
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

// -------------------------------------

interface ApiUser {
	avatar_url: string;
	country_code: string;
	default_group?: string;
	id: number;
	is_active: boolean;
	is_bot: boolean;
	is_deleted: boolean;
	is_online: boolean;
	is_supporter: boolean;
	last_visit?: string;
	pm_friends_only: boolean;
	profile_colour?: string;
	username: string;

	// extended:
	account_history?: ApiUserAccountHistory[];
	active_tournament_banner?: ApiProfileBanner;
	active_tournament_banners?: ApiProfileBanner[];
	badges?: ApiUserBadge[];
	beatmap_playcounts_count?: number;
	blocks?: unknown;
	country?: ApiCountry;
	cover?: ApiProfileCover;
	favourite_beatmapset_count?: number;
	follow_user_mapping?: number[];
	follower_count?: number;
	friends?: unknown;
	graveyard_beatmapset_count?: number;
	groups?: ApiUserGroup[];
	guest_beatmapset_count?: number;
	is_restricted?: boolean;
	kudosu?: ApiKudosu;
	loved_beatmapset_count?: number;
	mapping_follower_count?: number;
	monthly_playcounts?: ApiUserMonthlyPlaycount[];
	nominated_beatmapset_count?: number;
	page?: unknown;
	pending_beatmapset_count?: unknown;
	previous_usernames?: unknown;
	rank_highest?: ApiRankHighest;
	rank_history?: unknown;
	ranked_beatmapset_count?: unknown;
	replays_watched_counts?: unknown;
	scores_best_count?: number;
	scores_first_count?: number;
	scores_recent_count?: number;
	session_verified?: boolean;
	statistics?: ApiUserStatistics;
	statistics_rulesets?: ApiUserStatisticsRulesets;
	support_level?: unknown;
	unread_pm_count?: unknown;
	user_achievements?: unknown;
	user_preferences?: unknown;
	team?: ApiUserTeam;
}

type ApiUserLookup = Pick<
	ApiUser,
	| "avatar_url"
	| "country_code"
	| "default_group"
	| "id"
	| "is_active"
	| "is_bot"
	| "is_deleted"
	| "is_online"
	| "is_supporter"
	| "last_visit"
	| "pm_friends_only"
	| "profile_colour"
	| "username"
	| "country"
	| "cover"
	| "groups"
	| "team"
>;

interface ApiUserAccountHistory {
	description?: string;
	id: number;
	length: number;
	permanent: boolean;
	timestamp: string;
	type: string;
}

interface ApiProfileBanner {
	id: number;
	tournament_id: number;
	image?: string;
	image2x?: string;
}

interface ApiProfileCover {
	custom_url?: string;
	url: string;
	id?: unknown;
}

interface ApiUserBadge {
	awarded_at: string;
	description: string;
	image2x_url: string;
	image_url: string;
	url: string;
}

interface ApiUserGroup {
	colour?: string;
	has_listing: boolean;
	has_playmodes: boolean;
	id: number;
	identifier: string;
	is_probationary: boolean;
	name: string;
	short_name: string;
	playmodes?: string[];
}

interface ApiUserTeam {
	flag_url?: string;
	id: number;
	name: string;
	short_name: string;
}

interface ApiCountry {
	code: string;
	name: string;
}

interface ApiKudosu {
	available: number;
	total: number;
}

interface ApiRankHighest {
	rank: number;
	updated_at: string;
}

type ApiProfilePageSection = "me" | "recent_activity" | "beatmaps" | "historical" | "kudosu" | "top_ranks" | "medals";

interface ApiUserStatistics {
	count_100: number;
	count_300: number;
	count_50: number;
	count_miss: number;

	country_rank?: number;

	grade_counts: {
		a: number;
		s: number;
		sh: number;
		ss: number;
		ssh: number;
	};

	hit_accuracy: number;
	accuracy: number;
	is_ranked: boolean;

	level: {
		current: number;
		progress: number;
	};

	maximum_combo: number;
	play_count: number;
	play_time: number;
	pp: number;
	pp_exp: number;

	global_rank?: number;
	global_rank_exp?: number;

	ranked_score: number;
	replays_watched_by_others: number;
	total_hits: number;
	total_score: number;
}

interface ApiUserMonthlyPlaycount {
	start_date: string;
	count: number;
}

interface ApiUserStatisticsRulesets {
	[ruleset: string]: ApiUserStatistics;
}

interface ApiBeatmapDbBeatmap {
  beatmap_id: number;
  beatmapset_id: number;
  approved: MapStatusId; 
  total_length: number; // in seconds
  hit_length: number; // in seconds
  version: string; // diff name
  artist: string;
  title: string;
  creator: string;
  creator_id: number;
  mode: RulesetId;
  cs: number;
  od: number;
  ar: number;
  hp: number;
  approved_date: string; // ISO 8601 format, e.g. "2020-01-01T00:00:00.000Z"
  submitted_date: string; // ISO
  last_updated_date: string; // ISO
  bpm: number;
  bpm_min?: number;
  bpm_max?: number;
  source: string;
  tags: string; // joined by spaces
  genre_id: number;
  language_id: number;
  max_combo: number;
  star_rating: number;
  star_rating_aim?: number;
  star_rating_speed?: number;
  hit_objects: number;
  num_circles: number;
  num_sliders: number;
  num_spinners: number;
  favorites: number;
  plays: number;
  passes: number;
  recalculate: number; // 0 or 1?
  max_score: number; // useless stable scoring
  packs: string;
  rating: number;
  video: number; // 0 or 1
  storyboard: number; // 0 or 1
  download_unavailable: number; // 0 or 1
  audio_unavailable: number; // 0 or 1
  file_md5: string;
  eyup_star_rating: number;
  max_score_fullmod: number; // useless stable scoring
}
