import {
	cacheServer,
	PLAYER_ID_TO_USERNAME_HASH,
	PLAYER_USERNAME_TO_ID_HASH,
	populateRankingSortedSet,
	RANKING_METRIC_TYPES
} from "../cache.js";
import { withDbClient } from "../db-generic.js";
import { DB_PLAYERS_TABLE, DB_RANKING_ROLLUP_TABLE } from "../env.js";
import { queryWithTiming } from "../metrics.js";
import { RANKING_POS_THRESHOLDS, parseArgs } from "../shared.js";

const FLAG_DEFINITIONS = Object.freeze({
	reset: {
		cli: "--reset",
		description: "Truncates the player hashes before repopulating them",
		takesValue: false
	},
	resetRankings: {
		cli: "--reset-rankings",
		description: "Deletes the ranking sorted sets before repopulating them (full rebuild, removes stale members)",
		takesValue: false
	},
	skipRankings: {
		cli: "--skip-rankings",
		description: "Skip populating the ranking sorted sets",
		takesValue: false
	}
} as const);

interface PlayerCacheRow {
	id: number;
	username: string;
}

interface RankingRollupRow {
	user_id: number;
	count: number;
	count_perma: number;
	count_ss: number;
	count_lazer: number;
	ranked_score: number;
	total_pp: number;
}

// Only osu! standard for now.
const RANKING_RULESET_ID: RulesetId = 0;

// TODO?: don't need to fetch all players to save memory, maybe figure out a way to fetch top players
// TODO!: add (long) TTL so they can be evicted if low on memory (volatile-lru)
async function populateValkey(reset = false, skipRankings = false, resetRankings = false) {
	const players = await withDbClient(
		async client => (await client.query<PlayerCacheRow>(`SELECT id, LOWER(username) AS username FROM ${DB_PLAYERS_TABLE}`)).rows
	);

	if (reset) await cacheServer.del(PLAYER_ID_TO_USERNAME_HASH, PLAYER_USERNAME_TO_ID_HASH);

	const pipeline = cacheServer.pipeline();
	for (const player of players) {
		const playerId = String(player.id);
		pipeline.hset(PLAYER_ID_TO_USERNAME_HASH, playerId, player.username);
		pipeline.hset(PLAYER_USERNAME_TO_ID_HASH, player.username, playerId);
	}

	const results = await pipeline.exec();
	const error = results?.find(([pipelineError]: [Error | null, unknown]) => pipelineError)?.[0];
	if (error) throw error;

	console.log(`Populated Valkey with ${players.length} player(s)`);

	if (!skipRankings) await populateRankings(resetRankings);
}

// Populates ranking:<type>:<rulesetId>:<positionBucket> sorted sets from RANKING_ROLLUP.
// For each position bucket B (WHERE position <= B), aggregates the metric per user_id and ZADDs the result.
// Only osu! standard (ruleset_id = 0) is populated for now.
async function populateRankings(reset = false) {
	const rulesetId = RANKING_RULESET_ID;
	let totalPopulated = 0;

	for (const bucket of RANKING_POS_THRESHOLDS) {
		const positionCondition = bucket === 100 ? "" : `AND r.position <= ${bucket}`;
		const rows = await withDbClient(
			async client =>
				(
					await queryWithTiming<RankingRollupRow>(
						client,
						"populateRankings_fetch_rollup",
						"populate_valkey",
						`SELECT
							r.user_id,
							COALESCE(SUM(r.count), 0)::INT AS count,
							COALESCE(SUM(r.count_perma), 0)::INT AS count_perma,
							COALESCE(SUM(r.count_ss), 0)::INT AS count_ss,
							COALESCE(SUM(r.count_lazer), 0)::INT AS count_lazer,
							COALESCE(SUM(r.ranked_score), 0)::BIGINT AS ranked_score,
							COALESCE(SUM(r.total_pp), 0)::INT AS total_pp
						FROM ${DB_RANKING_ROLLUP_TABLE} r
						WHERE r.ruleset_id = $1
						${positionCondition}
						GROUP BY r.user_id`,
						[rulesetId]
					)
				).rows
		);

		for (const type of RANKING_METRIC_TYPES) {
			const entries = rows.map(row => ({ playerId: Number(row.user_id), value: Number(row[type as keyof RankingRollupRow]) }));
			const count = await populateRankingSortedSet(type, rulesetId, bucket, entries, reset);
			totalPopulated += count;
		}

		console.log(`Populated ranking bucket top_${bucket} (${rows.length} users, ${RANKING_METRIC_TYPES.length} metrics)`);
	}

	console.log(
		`Populated Valkey rankings: ${totalPopulated} total member(s) across ${RANKING_POS_THRESHOLDS.length * RANKING_METRIC_TYPES.length} sorted set(s)`
	);
}

const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, import.meta.main, FLAG_DEFINITIONS);

try {
	await populateValkey(parsedFlags.reset, parsedFlags.skipRankings, parsedFlags.resetRankings);
} catch (e) {
	console.error("Error populating Valkey:\n", e);
	process.exitCode = 1;
} finally {
	await cacheServer.quit();
}
