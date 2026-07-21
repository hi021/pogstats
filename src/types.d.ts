type ApiScoreGrade = "XH" | "X" | "SH" | "S" | "A" | "B" | "C" | "D";
type ScoreGrade = "XH" | "X " | "SH" | "S " | "A " | "B " | "C " | "D "; // postgres char(2) with trailing space for single char ranks
type PlayerScoreGrade = "ss" | "ssh" | "s" | "sh" | "a";

type RulesetId = 0 | 1 | 2 | 3;
type Ruleset = "osu" | "taiko" | "fruits" | "mania";
type RankingPositionThreshold = 100 | 50 | 25 | 15 | 8 | 1;
type RankingPositionThresholdName = `Top ${RankingPositionThreshold}`;
type RankingPositionThresholdCode = `top${RankingPositionThreshold}`;
type BeatmapStatusId = -2 | -1 | 0 | 1 | 2 | 3 | 4; // -2 - graveyard, -1 - wip, 0 - pending, 1 - ranked, 2 - approved, 3 - qualified, 4 - loved
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
type BeatmapRuleset = { beatmap_id: number; ruleset_id: RulesetId };

type ActionSource =
	| "scrape_players"
	| "scrape_scores"
	| "scrape_beatmaps"
	| "import_beatmap"
	| "pog_api_v2"
	| "pog_ws"
	| "scores_ws"
	| "osu_auth"
	| "unknown";

// ------------------------------------------

////// differences between pekkie schema
//     total_score - INTEGER instead of BIGINT
//     total_score_without_mods - INTEGER instead of BIGINT
//     pp - REAL instead of DOUBLE PRECISION
//     build_id - dropped
//     has_replay - dropped
//     legacy_perfect - dropped
//     legacy_total_score - dropped
// 		 lazer - renamed to is_lazer
//     + 3 other meta columns: is_scraped, retrieved_at, position, is_perma
interface ScoreSortData {
	id: number;
	totalScore: number;
	endedAt: Date;
}

interface BeatmapScoreFull extends ScoreSortData {
	position: number; // meta, not from API, 0 means score is MIA (from potentially restricted player)
	isScraped: boolean; // meta, not from API - whether it came from /beatmaps/{id}/scores (scrape_scores script)
	retrievedAt: Date; // meta, not from API; can be sligtly off from the date in beatmap_ruleset_update_dates table
	isLazer: boolean; // meta, not from API (true only if build_id is present)
	isPerma: boolean; // meta, whether highest possible total_score on map
	userId: number;
	rulesetId: number;
	beatmapId: number;
	grade: ScoreGrade;
	accuracy: number; // 0-1
	maxCombo: number;
	classicTotalScore?: number; // seems to always be present
	totalScoreWithoutMods?: number;
	isPerfectCombo: boolean;
	pp?: number;
	data: BeatmapScoreAdditionalData;
}

type ScoreBasicData = ScoreSortData & Pick<BeatmapScoreFull, "userId" | "grade"> & Pick<Player, "username" | "countryCode">;

interface BeatmapScoreAdditionalData {
	mods: ApiMod[];
	maximumStatistics: ApiScoreHitStats;
	statistics: ApiScoreHitStats;
	// could also include undocumented object - current_user_attributes: { pin?: unknown } from the API, but seems useless
}

interface ProvenScoresPerRulesetBeatmap {
	beatmap_id: number;
	ruleset_id: RulesetId;
	proven_user_ids: number[];
	proven_ids: number[];
}

interface BeatenScoreData {
	position_threshold: RankingPositionThreshold;
	score_id: number;
	user_id: number;
	username: string;
	country: string;
}

interface BeatingScoreData {
	score_id: number;
	position: number;
	grade: ScoreGrade;
	proven_user_id: number;
	proven_username: string;
	proven_country: string;
	beatmap_id: string;
	artist: string;
	title: string;
	version: string;
	is_beatmap_new: boolean;
	beaten_scores: BeatenScoreData[];
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
	isMia: boolean; // meta - missing in action, as in not returned by the API and probably restricted
	// TODO?: maybe poggers stats, e.g. peak/lowest for each ranking type, etc.
}

type MissingPlayer = Player & { username: "<POGSTATS::UNKNOWN>"; countryCode: "XX"; isMia: true };

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
		[grade in PlayerScoreGrade]?: number;
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
	status: BeatmapStatusId;
	artist: string;
	title: string;
	version: string; // diff name
	creator: string;
	creatorId: number;
	rulesetId: RulesetId;
	approvedDate: Date;
	starRating: number;
	totalLength: number; // in seconds
	bpm: number;
	cs: number;
	od: number;
	ar: number;
	hp: number;
	packs: string; // comma-separated, e.g. "R92,S255,T49", TODO: separate junction table if needed for queries
	updatedAt: Date; // meta
}

// ------------------------------------------

// maybe high resolution rank history for all rankings (like historical player snipes but for rank changes instead?) some day?
interface RankingType {
	id: number;
	ruleset_id: RulesetId;
	position_threshold: RankingPositionThreshold;
	name: string;
	code: string;
}

// TODO DDL
interface HistoricalRankingEntry {
	rankingId: number; // FK to Ranking Type id
	date: Date;
	userId: number;
	position: number;
	value: number; // top50 count, total pp, etc.
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

interface HistoricalPlayerSnipes {
	id?: number;
	userId: number;
	scoreId: number;
	snipedBy: number; // user id
	snipedWith: number; // score id
	beatmapId: number;
	rulesetId: RulesetId;
	positionThreshold: RankingPositionThreshold;
	date: Date; // will be the same as snipedBy.endedAt but important if using timescaledb
}

// ------------------------------------------

interface ConfigEntry {
	key: string;
	value_int?: number;
	value_text?: string;
	value_json?: Record<string, unknown>;
}
