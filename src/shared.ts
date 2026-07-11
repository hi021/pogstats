import { BEATMAP_TABLE_COLUMNS, SCORE_TABLE_COLUMNS } from "./db.js";

export const RULESET_IDS: Readonly<RulesetId[]> = Object.freeze([0, 1, 2, 3]);
export const RANKING_POS_THRESHOLDS: Readonly<RankingPositionThreshold[]> = Object.freeze([100, 50, 25, 15, 8, 1]);

export function convertApiScore(
	apiScore: ApiScore | WsScore,
	position: number,
	isScraped = true,
	isPerma = false
): BeatmapScoreFull {
	return {
		position,
		isScraped,
		retrievedAt: new Date(),
		isLazer: apiScore.build_id != null,
		isPerma,
		id: apiScore.id,
		userId: apiScore.user_id,
		rulesetId: apiScore.ruleset_id,
		beatmapId: apiScore.beatmap_id,
		grade: apiScore.rank as ScoreRank, // safe because postgres pads to char(2) automatically
		accuracy: apiScore.accuracy,
		maxCombo: apiScore.max_combo,
		totalScore: apiScore.total_score,
		classicTotalScore: apiScore.classic_total_score,
		totalScoreWithoutMods: apiScore.total_score_without_mods,
		isPerfectCombo: apiScore.is_perfect_combo,
		pp: apiScore.pp,
		endedAt: new Date(apiScore.ended_at),
		data: {
			mods: apiScore.mods,
			maximumStatistics: apiScore.maximum_statistics,
			statistics: apiScore.statistics
		}
	};
}

export function convertDatabaseScore(dbScore: Record<string, unknown>): BeatmapScoreFull {
	return {
		position: dbScore.position as number,
		isScraped: dbScore.is_scraped as boolean,
		retrievedAt: dbScore.retrieved_at as Date,
		isLazer: dbScore.is_lazer as boolean,
		isPerma: dbScore.is_perma as boolean,
		id: Number(dbScore.id),
		userId: dbScore.user_id as number,
		rulesetId: dbScore.ruleset_id as number,
		beatmapId: Number(dbScore.beatmap_id),
		grade: dbScore.grade as ScoreRank,
		accuracy: dbScore.accuracy as number,
		maxCombo: dbScore.max_combo as number,
		totalScore: dbScore.total_score as number,
		classicTotalScore: Number(dbScore.classic_total_score),
		totalScoreWithoutMods: dbScore.total_score_without_mods as number | undefined,
		isPerfectCombo: dbScore.is_perfect_combo as boolean,
		pp: dbScore.pp as number | undefined,
		endedAt: dbScore.ended_at as Date,
		data: dbScore.data as BeatmapScoreAdditionalData
	};
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
	return player.username == "<POGSTATS::UNKNOWN>" && player.countryCode == "XX" && player.isMia;
}

export function prepareScoresTableValuesAndParamPlaceholders(scores: BeatmapScoreFull[]) {
	const values: unknown[] = [];
	const paramGroups = scores.map((score, index) => {
		const offset = index * SCORE_TABLE_COLUMNS.length;
		values.push(
			(score.position = index + 1),
			score.isScraped,
			score.retrievedAt,
			score.isLazer,
			score.id,
			score.userId,
			score.rulesetId,
			score.beatmapId,
			score.grade,
			score.accuracy,
			score.maxCombo,
			score.totalScore,
			score.classicTotalScore,
			score.totalScoreWithoutMods,
			score.isPerfectCombo,
			score.pp,
			score.endedAt,
			convertAdditionalDataToJsonb(score.data)
		);

		return `(${SCORE_TABLE_COLUMNS.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
	});

	return { values, paramGroups };
}

export function prepareBeatmapTableValuesAndParamPlaceholders(beatmaps: Beatmap[]) {
	const values: unknown[] = [];
	const paramGroups = beatmaps.map((beatmap, index) => {
		const offset = index * BEATMAP_TABLE_COLUMNS.length;
		values.push(
			beatmap.id,
			beatmap.beatmapsetId,
			beatmap.status,
			beatmap.artist,
			beatmap.title,
			beatmap.version,
			beatmap.creator,
			beatmap.creatorId,
			beatmap.rulesetId,
			beatmap.approvedDate,
			beatmap.starRating,
			beatmap.totalLength,
			beatmap.bpm,
			beatmap.cs,
			beatmap.od,
			beatmap.ar,
			beatmap.hp,
			beatmap.packs
		);

		return `(${BEATMAP_TABLE_COLUMNS.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
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
	if (a.ended_at != b.ended_at) return a.ended_at > b.ended_at ? 1 : -1; // comparing ISO date strings is fine as long as they are of the same format
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
	isMainEntryPoint: boolean,
	flagDefinitions: Defs,
	options?: { onHelp?: () => void; usageName?: string }
): ParsedFlags<Defs> {
	const parsed = {} as ParsedFlags<Defs>;
	if (!isMainEntryPoint) return parsed;

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

export function unnestObjectsIntoArrays<T extends Record<string, unknown>>(objs: T[], exemplaryObj?: T) {
	exemplaryObj = exemplaryObj || objs[0];
	const props: Array<keyof T> = Object.keys(exemplaryObj);
	const result = {} as { [K in keyof T]: Array<T[K]> };

	for (const prop of props) result[prop] = new Array(objs.length);

	for (let i = 0; i < objs.length; ++i) {
		for (const prop of props) result[prop][i] = objs[i][prop];
	}

	return result;
}
