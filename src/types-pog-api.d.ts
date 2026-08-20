interface WithPlayerIdOrNameContext {
	idOrName: string | number;
}

type PlayerPositionSpread = Array<number>; // 0 - 99, add + 1 to get position, (guaranteed dense)

type PlayerGradeSpread = { [grade in ScoreGrade]: number }; // sparse

type PlayerModSpread = { [modKey: string]: number }; // modKey is made of mod acronyms joined by "," e.g. "HD,HR"

type BeatmapWithoutPermaScore = Pick<
	Beatmap,
	"id" | "beatmapset_id" | "status" | "artist" | "title" | "version" | "creator" | "approved_date"
> & {
	base_star_rating: number;
	base_total_length: number;
	base_od: number;
	highest_non_perma_position: number;
};

type SingleBucketRankingData = {
	id: number;
	username: string;
	country_code: string;
	count_position: number;
	count: number;

	count_ss_position: number;
	count_ss: number;
	count_lazer_position: number;
	count_lazer: number;
	count_perma_position: number;
	count_perma: number;
	ranked_score_position: number;
	ranked_score: string; // TODO: validate if string or if BIGINT converter works
	total_pp_position: number;
	total_pp: number;
	avg_acc: number;
	avg_map_len: number;

	// TODO: probably want these in a separate type
	weighted_pp: number;
	weighted_count: number;
};

type MetricBucketStats<B extends RankingPositionThreshold> = {
	[K in B as `top_${K}_count_position`]: number;
} & {
	[K in B as `top_${K}_count`]: number;
} & {
	[K in B as `top_${K}_count_ss_position`]: number;
} & {
	[K in B as `top_${K}_count_ss`]: number;
} & {
	[K in B as `top_${K}_count_lazer_position`]: number;
} & {
	[K in B as `top_${K}_count_lazer`]: number;
} & {
	[K in B as `top_${K}_count_perma_position`]: number;
} & {
	[K in B as `top_${K}_count_perma`]: number;
} & {
	[K in B as `top_${K}_ranked_score_position`]: number;
} & {
	[K in B as `top_${K}_ranked_score`]: string; // TODO: validate if string or if BIGINT converter works
} & {
	[K in B as `top_${K}_total_pp_position`]: number;
} & {
	[K in B as `top_${K}_total_pp`]: number;
} & {
	[K in B as `top_${K}_avg_acc`]: number;
} & {
	[K in B as `top_${K}_avg_map_len`]: number;
};
type AllBucketsStats = MetricBucketStats<RankingPositionThreshold>;

type PlayerRankingData = Pick<Player, "id" | "username" | "countryCode"> & AllBucketsStats;
type FullPlayerRankingData = PlayerRankingData & Pick<Player, "weightedPp" | "weightedCount">;
