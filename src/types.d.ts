type ApiScoreRank = "XH" | "X" | "SH" | "S" | "A" | "B" | "C" | "D";
type ScoreRank = "XH" | "X " | "SH" | "S " | "A " | "B " | "C " | "D "; // postgres char(2) with trailing space for single char ranks
type PlayerScoreRank = "ss" | "ssh" | "s" | "sh" | "a";

type RulesetId = 0 | 1 | 2 | 3;
type Ruleset = "osu" | "taiko" | "fruits" | "mania";
type RankingPositionThreshold = 100 | 50 | 25 | 15 | 8 | 1;
type RankingPositionThresholdName = `Top ${RankingPositionThreshold}`;
type RankingPositionThresholdCode = `top${RankingPositionThreshold}`;
interface BeatmapScoreParams {
	mode?: Ruleset;
	mods?: string;
	legacy_only?: 0 | 1;
	type?: string;
	limit?: number;
}

// ------------------------------------------

////// Final table schema for pog!stats could be smaller, e.g.:
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

////// differences betweeen pekkie schema
//     total_score - INTEGER instead of BIGINT
//     total_score_without_mods - INTEGER instead of BIGINT
//     pp - REAL instead of DOUBLE PRECISION
//     build_id - dropped
//     + 3 other meta columns: is_scraped, retrieved_at, position

interface BeatmapScoreFull {
	position: number; // meta, not from API
	isScraped: boolean; // meta, not from API
	retrievedAt: Date; // meta, not from API
	lazer: boolean; // meta, not from API (true only if build_id is present)
	id: number;
	userId: number;
	rulesetId: number;
	beatmapId: number;
	hasReplay: boolean;
	grade: ScoreRank;
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
	// could also include undocumented object - current_user_attributes: { pin?: unknown } from the API, but seems useless
}

// ------------------------------------------

interface Player {
	id: number;
	username: string;
	countryCode: string;
	isActive: boolean;
	joinDate: Date;
	teamId?: number;
	coverUrl?: string;
	stats: { [ruleset in Ruleset]?: PlayerRulesetStats };
	pogBadges?: number[]; // meta
	retrievedAt: Date; // meta
	isFromOsuApi: boolean; // meta
	isMia: boolean; // meta - missing in action as in not returned by the API and probably restricted
	// TODO?: maybe meta fields from poggersltd
}

interface PlayerRulesetStats {
	playCount: number;
	playTime: number; // in seconds
	pp: number;
	rank?: number; // can be out of date, but Chiffa wanted it; null for players not in the ranking
	rankedScore: number;
	gradeCounts: {
		[grade in PlayerScoreRank]?: number;
	};
}

interface PlayerTeam {
	id: number;
	name: string;
	shortName: string;
	flagUrl?: string;
}

// ------------------------------------------

interface RankingType {
	id: number;
	rulesetId: number;
	positionThreshold: number;
	name: string;
	code: string;
}

interface HistoricalRankingEntry {
	rankingId: number; // FK to Ranking Type id
	date: Date;
	userId: number;
	position: number;
	value: number; // e.g. top50 count, total pp, etc.
	previousEntryId: number; // FK to the same table - same rankingId and userId, but earlier date
	updatedAt: Date;
	datasetId?: number; // FK to Dataset Type id
}

interface DatasetType {
	id: number;
	name: string;
	code: string;
}

// ------------------------------------------

interface ConfigEntry {
	key: string;
	valueInt?: number;
	valueText?: string;
	valueJson?: Record<string, unknown>;
}
