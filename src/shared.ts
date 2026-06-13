export function convertApiScore(apiScore: ApiScore, position: number, isScraped = true): BeatmapScoreFull {
	return {
		position,
		isScraped,
		retrievedAt: new Date(),
		lazer: apiScore.build_id != null,
		id: apiScore.id,
		userId: apiScore.user_id,
		rulesetId: apiScore.ruleset_id,
		beatmapId: apiScore.beatmap_id,
		hasReplay: apiScore.has_replay,
		grade: apiScore.rank as ScoreRank, // safe because postgres pads to char(2) automatically
		accuracy: apiScore.accuracy,
		maxCombo: apiScore.max_combo,
		totalScore: apiScore.total_score,
		classicTotalScore: apiScore.classic_total_score,
		totalScoreWithoutMods: apiScore.total_score_without_mods,
		isPerfectCombo: apiScore.is_perfect_combo,
		legacyPerfect: apiScore.legacy_perfect,
		pp: apiScore.pp,
		legacyTotalScore: apiScore.legacy_total_score,
		endedAt: new Date(apiScore.ended_at),
		data: {
			mods: apiScore.mods,
			maximumStatistics: apiScore.maximum_statistics,
			statistics: apiScore.statistics
		}
	};
}

export function convertDatabaseScore(dbScore: Record<string, unknown>) {
	return {
		position: dbScore.position,
		isScraped: dbScore.is_scraped,
		retrievedAt: dbScore.retrieved_at,
		lazer: dbScore.lazer,
		id: Number(dbScore.id),
		userId: dbScore.user_id,
		rulesetId: dbScore.ruleset_id,
		beatmapId: Number(dbScore.beatmap_id),
		hasReplay: dbScore.has_replay,
		grade: dbScore.grade,
		accuracy: dbScore.accuracy,
		maxCombo: dbScore.max_combo,
		totalScore: dbScore.total_score,
		classicTotalScore: Number(dbScore.classic_total_score),
		totalScoreWithoutMods: dbScore.total_score_without_mods,
		isPerfectCombo: dbScore.is_perfect_combo,
		legacyPerfect: dbScore.legacy_perfect,
		pp: dbScore.pp,
		legacyTotalScore: Number(dbScore.legacy_total_score),
		endedAt: dbScore.ended_at,
		data: dbScore.data
	} as BeatmapScoreFull;
}

export function convertAdditionalDataToJsonb(additionalData: BeatmapScoreAdditionalData) {
	return JSON.stringify(additionalData);
}
