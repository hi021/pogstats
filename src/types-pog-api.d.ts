interface WithPlayerIdOrNameContext {
	idOrName: string | number;
}

interface PlayerLiveCountData {
	top_1: number;
	top_8: number;
	top_15: number;
	top_25: number;
	top_50: number;
	top_100: number;
}

type PlayerPositionSpread = Array<number>; // 0 - 99, add + 1 to get position, (guaranteed dense)

type PlayerGradeSpread = { [grade in ScoreGrade]: number }; // sparse

interface BeatmapWithoutPermaScore {
	id: number;
	beatmapset_id: number;
	status: BeatmapStatusId;
	artist: string;
	title: string;
	version: string;
	creator: string;
	approved_date: Date;
	base_star_rating: number;
	base_total_length: number;
	base_od: number;
	highest_non_perma_position: number;
}
