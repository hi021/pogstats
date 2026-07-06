type ApiScoreRank = "XH" | "X" | "SH" | "S" | "A" | "B" | "C" | "D";
type ScoreRank = "XH" | "X " | "SH" | "S " | "A " | "B " | "C " | "D "; // postgres char(2) with trailing space for single char ranks
type PlayerScoreRank = "ss" | "ssh" | "s" | "sh" | "a";

type RulesetId = 0 | 1 | 2 | 3;
type Ruleset = "osu" | "taiko" | "fruits" | "mania";
type RankingPositionThreshold = 100 | 50 | 25 | 15 | 8 | 1;
type RankingPositionThresholdName = `Top ${RankingPositionThreshold}`;
type RankingPositionThresholdCode = `top${RankingPositionThreshold}`;
type MapStatusId = 0 | 1 | 2 | 3 | 4; // 0 - pending, 1 - ranked, 2 - approved, 3 - qualified, 4 - loved
interface BeatmapScoreParams {
	mode?: Ruleset;
	mods?: string;
	legacy_only?: 0 | 1;
	type?: string;
	limit?: number;
}

type OsuAuthScope =
	| "chat.read"
	| "chat.write"
	| "chat.write_manage"
	| "delegate"
	| "forum.write"
	| "forum.write_manage"
	| "friends.read"
	| "group_permissions"
	| "identify"
	| "multiplayer.write_manage"
	| "public";

type IdBatch = { batch_no: number; ids: number[] };

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
//     + 3 other meta columns: is_scraped, retrieved_at, position, is_perma

interface BeatmapScoreFull {
	position: number; // meta, not from API, 0 = score is MIA (from potentially restricted player)
	isScraped: boolean; // meta, not from API
	retrievedAt: Date; // meta, not from API
	lazer: boolean; // meta, not from API (true only if build_id is present)
	isPerma: boolean; // meta, whether highest possible total_score on map
	id: number;
	userId: number;
	rulesetId: number;
	beatmapId: number;
	hasReplay: boolean;
	grade: ScoreRank;
	accuracy: number; // 0-1
	maxCombo: number;
	totalScore: number;
	classicTotalScore?: number; // seems to always be present
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
	teamId?: number;
	coverUrl?: string;
	retrievedAt: Date; // meta
	isFromOsuApi: boolean; // meta
	isMia: boolean; // meta - missing in action as in not returned by the API and probably restricted
	// TODO?: maybe poggers stats, e.g. peak/lowest for each ranking type, etc.
}

type MissingPlayer = Pick<Player, "id" | "retrievedAt" | "isFromOsuApi" | "isMia"> & { isMia: true };

type PlayerInRanking = Pick<Player, "id" | "username" | "countryCode" | "teamId" | "coverUrl"> & {
	pogBadges?: PogBadge[];
};

type PlayerWithStats = Player & { stats: { [ruleset in Ruleset]?: PlayerRulesetStats } };

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

interface PlayerMiaHistoryEntry {
	userId: number;
	startDate: Date;
	endDate?: Date;
}

// ------------------------------------------

interface PogBadge {
	id: number;
	name?: string;
	imgUrl: string;
}

// ------------------------------------------

interface Beatmap {
	id: number;
	beatmapsetId: number;
	status: MapStatusId;
	artist: string;
	title: string;
	version: string; // diff name
	creator: string;
	creatorId: number;
	mode: RulesetId;
	approvedDate: Date;
	starRating: number;
	totalLength: number; // in seconds
	bpm: number;
	cs: number;
	od: number;
	ar: number;
	hp: number;
	packs: string; // comma-separated, e.g. "R92,S255,T49", TODO: separate junction table if needed for queries
}

// ------------------------------------------

interface RankingType {
	id: number;
	rulesetId: number;
	positionThreshold: number;
	name: string;
	code: string;
}

// TODO DDL
interface HistoricalRankingEntry {
	rankingId: number; // FK to Ranking Type id
	date: Date;
	userId: number;
	position: number;
	value: number; // e.g. top50 count, total pp, etc.
	previousEntryId: number; // FK to the same table - same rankingId and userId, but earlier date
	updatedAt: Date;
	sourceId?: number; // FK to Data Source id
}

// TODO DDL
interface DataSource {
	id: number;
	name: string;
	comment: string;
}

// ------------------------------------------

interface ConfigEntry {
	key: string;
	valueInt?: number;
	valueText?: string;
	valueJson?: Record<string, unknown>;
}
