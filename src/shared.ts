export const RULESET_IDS: Readonly<RulesetId[]> = Object.freeze([0, 1, 2, 3]);
export const RANKING_POS_THRESHOLDS: Readonly<RankingPositionThreshold[]> = Object.freeze([100, 50, 25, 15, 8, 1]);

export const SCORE_TABLE_COLUMNS = Object.freeze([
	"position",
	"is_scraped",
	"retrieved_at",
	"lazer",
	"id",
	"user_id",
	"ruleset_id",
	"beatmap_id",
	"has_replay",
	"grade",
	"accuracy",
	"max_combo",
	"total_score",
	"classic_total_score",
	"total_score_without_mods",
	"is_perfect_combo",
	"legacy_perfect",
	"pp",
	"legacy_total_score",
	"ended_at",
	"data"
]);

export const PLAYER_TABLE_COLUMNS = Object.freeze([
	"id",
	"username",
	"country_code",
	"is_active",
	"team_id",
	"cover_url",
	"retrieved_at",
	"is_from_osu_api",
	"is_mia"
]);

export function convertApiScore(apiScore: ApiScore | WsScore, position: number, isScraped = true): BeatmapScoreFull {
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

export function getRulesetName(id: RulesetId): Ruleset {
	switch (id) {
		case 0:
			return "osu";
		case 1:
			return "taiko";
		case 2:
			return "fruits";
		case 3:
			return "mania";
	}
}

export function buildPositionThresholdName(pos: RankingPositionThreshold): RankingPositionThresholdName {
	return `Top ${pos}`;
}

export function buildPositionThresholdCode(pos: RankingPositionThreshold): RankingPositionThresholdCode {
	return `top${pos}`;
}

export function isMissingPlayer(player: Player | MissingPlayer): player is MissingPlayer {
	return !(player as Player).username && player.isMia;
}

export function prepareScoresTableValuesAndParamPlaceholders(scores: BeatmapScoreFull[]) {
	const values: unknown[] = [];
	const paramGroups = scores.map((score, index) => {
		const offset = index * SCORE_TABLE_COLUMNS.length;
		values.push(
			(score.position = index + 1),
			score.isScraped,
			score.retrievedAt,
			score.lazer,
			score.id,
			score.userId,
			score.rulesetId,
			score.beatmapId,
			score.hasReplay,
			score.grade,
			score.accuracy,
			score.maxCombo,
			score.totalScore,
			score.classicTotalScore,
			score.totalScoreWithoutMods,
			score.isPerfectCombo,
			score.legacyPerfect,
			score.pp,
			score.legacyTotalScore,
			score.endedAt,
			convertAdditionalDataToJsonb(score.data)
		);

		return `(${SCORE_TABLE_COLUMNS.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
	});

	return { values, paramGroups };
}

export function preparePlayersTableValuesAndParamPlaceholders(players: Array<Player | MissingPlayer>) {
	const values: unknown[] = [];
	const paramGroups = players.map((player, index) => {
		const offset = index * PLAYER_TABLE_COLUMNS.length;
		const isMia = isMissingPlayer(player);

		values.push(
			player.id,
			isMia ? null : player.username,
			isMia ? null : player.countryCode,
			isMia ? null : player.isActive,
			isMia ? null : player.teamId,
			isMia ? null : player.coverUrl,
			isMia ? null : player.retrievedAt,
			isMia ? true : player.isFromOsuApi, // only osu! api is authoritative over this
			player.isMia
		);

		return `(${PLAYER_TABLE_COLUMNS.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
	});

	return { values, paramGroups };
}

export function convertAdditionalDataToJsonb(additionalData: BeatmapScoreAdditionalData) {
	return JSON.stringify(additionalData);
}

export function sortScores(a: BeatmapScoreFull, b: BeatmapScoreFull) {
	if (a.totalScore != b.totalScore) return b.totalScore - a.totalScore;
	if (a.endedAt.getTime() != b.endedAt.getTime()) return a.endedAt.getTime() - b.endedAt.getTime();
	return a.id - b.id;
}

export function sortWsScores(a: WsScore, b: WsScore) {
	if (a.total_score != b.total_score) return b.total_score - a.total_score;
	if (a.ended_at != b.ended_at) return a.ended_at > b.ended_at ? 1 : -1; // comparing ISO date string is fine as long as they are of the same format
	return a.id - b.id;
}

export type FlagDefinition = Readonly<{ cli: string; description: string; takesValue: boolean }>;
export type FlagDefinitions = Readonly<Record<string, FlagDefinition>>;
export type ParsedFlags<Defs extends FlagDefinitions> = {
	[K in keyof Defs]?: Defs[K] extends { takesValue: true } ? string : boolean;
};

export function printHelp<Defs extends FlagDefinitions>(
	flagDefinitions: Defs,
	usageName = process.argv[1]?.split("/").at(-1) ?? ""
) {
	console.log(`Usage: node ${usageName} [flags]\n`);
	console.log("Optional flags:");
	for (const def of Object.values(flagDefinitions) as FlagDefinition[])
		console.log(`  ${def.cli.padEnd(24)} ${def.description}`);
	console.log("  --help                   Show this help message");
}

export function parseArgs<Defs extends FlagDefinitions>(
	argv: string[],
	flagDefinitions: Defs,
	options?: { onHelp?: () => void; usageName?: string }
): ParsedFlags<Defs> {
	const parsed = {} as ParsedFlags<Defs>;
	argv = argv.slice(2);

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help") {
			if (options?.onHelp) {
				options.onHelp();
				return parsed;
			}

			printHelp(flagDefinitions, options?.usageName);
			process.exit(0);
		}

		if (!arg.startsWith("--")) throw new Error(`Unexpected argument: '${arg}'`);

		const [flagName, maybeValue] = arg.slice(2).split("=", 2) as [string, string | undefined];
		if (!Object.prototype.hasOwnProperty.call(flagDefinitions, flagName))
			throw new Error(`Unknown flag: --${flagName}`);

		const key = flagName as keyof Defs;
		const def = flagDefinitions[key];
		if (def.takesValue) {
			const value = maybeValue ?? argv[++i];
			if (!value || value.startsWith("--")) throw new Error(`Missing value for flag: --${flagName}`);
			parsed[key] = value as ParsedFlags<Defs>[keyof Defs];
		} else {
			if (maybeValue) throw new Error(`Unexpected value for flag: --${flagName}`);
			parsed[key] = true as ParsedFlags<Defs>[keyof Defs];
		}
	}

	return parsed;
}

export async function sleep(ms: number) {
	await new Promise(r => setTimeout(r, ms));
}

export function toCapitalFirstLetter(string: string) {
	return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}

export function splitIntoBatches(array: number[], batchSize: number): IdBatch[] {
	const batches: IdBatch[] = [];
	for (let i = 0; i < array.length; i += batchSize) {
		batches.push({
			batch_no: Math.floor(i / batchSize) + 1,
			ids: array.slice(i, i + batchSize)
		});
	}
	return batches;
}
