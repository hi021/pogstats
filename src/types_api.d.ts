interface ApiBeatmapScore {
	score_count: number;
	scores: ApiScore[];
}

/// FROM SCORES-WS:

// {
//   classic_total_score: 758792,
//   preserve: true,
//   processed: true,
//   ranked: true,
//   maximum_statistics: { perfect: 969, legacy_combo_increase: 807 },
//   mods: [ { acronym: 'CL' } ],
//   statistics: { ok: 17, meh: 5, good: 53, miss: 26, great: 263, perfect: 605 },
//   total_score_without_mods: 790408,
//   beatmap_id: 701223,
//   best_id: null,
//   id: 6867233214,
//   rank: 'A',
//   type: 'solo_score',
//   user_id: 37474187,
//   accuracy: 0.933783,
//   build_id: null,
//   ended_at: '2026-06-12T19:42:38Z',
//   has_replay: false,
//   is_perfect_combo: false,
//   legacy_perfect: false,
//   legacy_score_id: 661304575,
//   legacy_total_score: 794499,
//   max_combo: 983,
//   passed: true,
//   pp: 114.001,
//   ruleset_id: 3,
//   started_at: null,
//   total_score: 758792,
//   replay: false,
//   current_user_attributes: { pin: null }
// }

// TODO
interface WsScore {

}

// TODO recheck against actual response
interface ApiScore {
	accuracy: number; // 0-1
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
	total_score_without_mods: number; // undocumented
	mods: ApiMod[];
	passed: true;
	playlist_item_id: number;
	pp?: number;
	preserve: boolean;
	processed: boolean;
	rank: ApiScoreRank;
	ranked: boolean;
	room_id: number;
	ruleset_id: RulesetId;
	started_at?: string; // ISO 8601 format, e.g. "2020-01-01T00:00:00+00:00"
	statistics: ApiScoreHitStats;
	total_score: number;
	type: string;
	user_id: number;
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
	avatarUrl: string;
	countryCode: string;
	defaultGroup?: string;
	id: number;
	isActive: boolean;
	isBot: boolean;
	isDeleted: boolean;
	isOnline: boolean;
	isSupporter: boolean;
	lastVisit?: string;
	pmFriendsOnly: boolean;
	profileColour?: string;
	username: string;
	// extended:
	accountHistory?: ApiUserAccountHistory[];
	activeTournamentBanner?: ApiProfileBanner;
	activeTournamentBanners?: ApiProfileBanner[];
	badges?: ApiUserBadge[];
	beatmapPlaycountsCount?: number;
	blocks?: unknown;
	country?: unknown;
	cover?: unknown;
	// TODO: I think it's this:
	//  id	integer
	//  tournament_id	integer
	//  image	string?
	//  image@2x	string?
	favouriteBeatmapsetCount?: number;
	followUserMapping?: number[];
	followerCount?: number;
	friends?: unknown;
	graveyardBeatmapsetCount?: number;
	groups?: ApiUserGroup[];
	guestBeatmapsetCount?: number;
	isRestricted?: boolean;
	kudosu?: ApiKudosu;
	lovedBeatmapsetCount?: number;
	mappingFollowerCount?: number;
	monthlyPlaycounts?: ApiUserMonthlyPlaycount[];
	nominatedBeatmapsetCount?: number;
	page?: unknown;
	pendingBeatmapsetCount?: unknown;
	previousUsernames?: unknown;
	rankHighest?: ApiRankHighest;
	rankHistory?: unknown;
	rankedBeatmapsetCount?: unknown;
	replaysWatchedCounts?: unknown;
	scoresBestCount?: number;
	scoresFirstCount?: number;
	scoresRecentCount?: number;
	sessionVerified?: boolean;
	statistics?: ApiUserStatistics;
	statisticsRulesets?: ApiUserStatisticsRulesets;
	supportLevel?: unknown;
	unreadPmCount?: unknown;
	userAchievements?: unknown;
	userPreferences?: unknown;
}

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
	tournamentId: number;
	image?: string;
	image2x?: string;
}

interface ApiUserBadge {
	awardedAt: string;
	description: string;
	image2xUrl: string;
	imageUrl: string;
	url: string;
}

interface ApiUserGroup {
	colour?: string;
	hasListing: boolean;
	hasPlaymodes: boolean;
	id: number;
	identifier: string;
	isProbationary: boolean;
	name: string;
	shortName: string;
	playmodes?: string[];
}

interface ApiKudosu {
	available: number;
	total: number;
}

interface ApiRankHighest {
	rank: number;
	updatedAt: string;
}

type ApiProfilePageSection = "me" | "recent_activity" | "beatmaps" | "historical" | "kudosu" | "top_ranks" | "medals";

interface ApiUserStatistics {
	count100: number;
	count300: number;
	count50: number;
	countMiss: number;
	countryRank?: number;
	gradeCounts: {
		a: number;
		s: number;
		sh: number;
		ss: number;
		ssh: number;
	};
	hitAccuracy: number;
	accuracy: number;
	isRanked: boolean;
	level: {
		current: number;
		progress: number;
	};
	maximumCombo: number;
	playCount: number;
	playTime: number;
	pp: number;
	ppExp: number;
	globalRank?: number;
	globalRankExp?: number;
	rankedScore: number;
	replaysWatchedByOthers: number;
	totalHits: number;
	totalScore: number;
}

interface ApiUserMonthlyPlaycount {
	startDate: string;
	count: number;
}

interface ApiUserStatisticsRulesets {
	[ruleset: string]: ApiUserStatistics;
}
