type ScoreRank = "XH" | "X" | "SH" | "S" | "A" | "B" | "C" | "D";
type RulesetId = 0 | 1 | 2 | 3;
type Ruleset = "osu" | "taiko" | "fruits" | "mania";
interface BeatmapScoreParams {
	mode?: Ruleset;
	mods?: string;
	legacy_only?: 0 | 1;
	type?: string;
	limit?: number;
}

// ------------------------------------------

interface ApiBeatmapScore {
	score_count: number;
	scores: ApiScore[];
}

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

// ------------------------------------------

////// Was supposed to be used for pog!stats, but saving BeatmapScoreFull instead in case someone finds it useful
// interface BeatmapScore {
// 	id: number;
// 	beatmapId: number;
// 	position: number;
// 	accuracy: number;
// 	timestamp: number;
// 	score: number;
// 	scoreClassic: number;
// 	pp?: number;
// 	rank: ScoreRank;
// 	mods: ApiMod[];
// 	userId: number;
// }
////// Final table schema for pog!stats could be something like this:
// id            bigint PRIMARY KEY,
// beatmap_id    bigint NOT NULL,
// position      smallint NOT NULL,
// accuracy      real NOT NULL,
// timestamp     timestamptz NOT NULL,
// score         integer NOT NULL,
// score_classic bigint NOT NULL,
// pp            real NOT NULL,
// rank          char(2) NOT NULL,
// mods          jsonb NOT NULL,
// user_id       integer NOT NULL

////// pekkie schema
//  	 id                  BIGINT NOT NULL,
//     user_id             BIGINT NOT NULL,
//     ruleset_id          SMALLINT NOT NULL,
//     beatmap_id          BIGINT NOT NULL,
//     has_replay          BOOLEAN NOT NULL DEFAULT FALSE,
//     ranked              BOOLEAN NOT NULL DEFAULT TRUE,  <--- dropping this one
//     rank                CHAR(2) NOT NULL DEFAULT '',
//     accuracy            NUMERIC(6,3) NOT NULL DEFAULT 0, <--- changing to REAL
//     max_combo           INTEGER NOT NULL DEFAULT 0,
//     total_score         BIGINT NOT NULL DEFAULT 0,
//     classic_total_score BIGINT,
//     total_score_without_mods BIGINT,
//     is_perfect_combo    BOOLEAN,
//     legacy_perfect      BOOLEAN,
//     pp                  DOUBLE PRECISION DEFAULT NULL, <--- changing to REAL
//     legacy_total_score  BIGINT NOT NULL DEFAULT 0,
//     ended_at            TIMESTAMPTZ NOT NULL,
//     build_id            SMALLINT DEFAULT NULL,      <----- dropping this one
//     stable              BOOLEAN NOT NULL DEFAULT FALSE,
//     data                JSONB NOT NULL DEFAULT '{}'::jsonb,

interface BeatmapScoreFull {
	position: number; // meta, not from API
	isScraped: boolean; // meta, not from API
	retrievedAt: Date; // meta, not from API
	stable: boolean; // meta, not from API (true only if build_id is present)
	id: number;
	userId: number;
	rulesetId: number;
	beatmapId: number;
	hasReplay: boolean;
	rank: ScoreRank;
	accuracy: number; // 0-1
	maxCombo: number;
	totalScore: number;
	classicTotalScore?: number;
	totalScoreWithoutMods?: number;
	isPerfectCombo: boolean;
	legacyPerfect: boolean;
	pp?: number;
	legacyTotalScore: number;
	endedAt: Date;
	data: BeatmapScoreAdditionalData;
}

interface BeatmapScoreAdditionalData {
	mods: ApiMod[];
	maximumStatistics: ApiScoreHitStats;
	statistics: ApiScoreHitStats;
	// could also include undocumented user object ({ pin?: unknown }) from the API, but seems useless
}
