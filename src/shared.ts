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

export function convertAdditionalDataToJsonb(additionalData: BeatmapScoreAdditionalData) {
	return JSON.stringify(additionalData);
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
