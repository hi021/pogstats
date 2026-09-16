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
	resetUsernames: {
		cli: "--resetUsernames",
		description: "Truncates the player id/username hashes before repopulating them",
		takesValue: false
	},
	resetRankings: {
		cli: "--resetRankings",
		description: "Deletes the ranking sorted sets before repopulating them",
		takesValue: false
	},
	noUsernames: {
		cli: "--noUsernames",
		description: "Skip populating the player id/username hashes",
		takesValue: false
	},
	noRankings: {
		cli: "--noRankings",
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

// TODO: Only populating osu! standard rankings for now
const RANKING_RULESET_ID: RulesetId = 0;

// TODO?: don't need to fetch all players to save memory, maybe figure out a way to fetch top players
// TODO!: add (long) TTL so they can be evicted if low on memory (volatile-lru)
async function populateValkey(noUsernames = false, resetUsernames = false, noRankings = false, resetRankings = false) {
	if (!noUsernames) await populateUsernames(resetUsernames);
	if (!noRankings) await populateRankings(resetRankings);
}

async function populateUsernames(reset = false) {
	console.log(`Populating ${PLAYER_ID_TO_USERNAME_HASH} and ${PLAYER_USERNAME_TO_ID_HASH} hashes`);

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

	console.log(`Populated ${PLAYER_ID_TO_USERNAME_HASH} and ${PLAYER_USERNAME_TO_ID_HASH} with ${players.length} player(s)`);
}

async function populateRankings(reset = false) {
	console.log("Populating Valkey rankings");

	const rulesetId = RANKING_RULESET_ID;
	let totalPopulated = 0;

	for (const bucket of RANKING_POS_THRESHOLDS) {
		const positionCondition = bucket === 100 ? "" : `AND r.position <= ${bucket}`;
		const rollupAggregates = await withDbClient(
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
			const entries = rollupAggregates.map(row => ({
				playerId: Number(row.user_id),
				value: Number(row[type as keyof RankingRollupRow])
			}));
			const count = await populateRankingSortedSet(type, rulesetId, bucket, entries, reset);
			totalPopulated += count;
		}

		console.log(`Populated top ${bucket} ranking (${rollupAggregates.length} user(s), ${RANKING_METRIC_TYPES.length} metrics)`);
	}

	console.log(
		`Populated Valkey rankings with ${totalPopulated} total member(s) across ${RANKING_POS_THRESHOLDS.length * RANKING_METRIC_TYPES.length} sorted sets`
	);
}

const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, import.meta.main, FLAG_DEFINITIONS);

try {
	await populateValkey(parsedFlags.noUsernames, parsedFlags.resetUsernames, parsedFlags.noRankings, parsedFlags.resetRankings);
} catch (e) {
	console.error("Error populating Valkey:\n", e);
	process.exitCode = 1;
} finally {
	await cacheServer.quit();
}
