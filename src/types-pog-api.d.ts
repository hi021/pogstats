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
