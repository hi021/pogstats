import { Redis } from "ioredis";
import { DEV_ENV, VALKEY_HOST, VALKEY_PASSWORD, VALKEY_PORT } from "./env.js";

export const cacheServer = new Redis({
	port: VALKEY_PORT,
	host: VALKEY_HOST,
	password: VALKEY_PASSWORD || undefined,
	showFriendlyErrorStack: DEV_ENV
});

export const PLAYER_ID_TO_USERNAME_HASH = "players:id-to-username";
export const PLAYER_USERNAME_TO_ID_HASH = "players:username-to-id";

export const RANKING_METRIC_TYPES = ["count", "count_perma", "count_ss", "count_lazer", "ranked_score", "total_pp"] as const;
export type RankingMetricType = (typeof RANKING_METRIC_TYPES)[number];

export function buildRankingKey(type: RankingMetricType, rulesetId: RulesetId, positionBucket: RankingPositionThreshold) {
	return `ranking:${type}:${rulesetId}:${positionBucket}`;
}

export function buildRankingPositionField(bucket: RankingPositionThreshold, type: RankingMetricType) {
	return `top_${bucket}_${type}_position`;
}

export async function getCachedRankingPosition(
	type: RankingMetricType,
	rulesetId: RulesetId,
	positionBucket: RankingPositionThreshold,
	playerId: number
) {
	const rank = await cacheServer.zrevrank(buildRankingKey(type, rulesetId, positionBucket), String(playerId));
	return rank == null ? null : rank + 1;
}

export async function getCachedRankingPositionsForPlayer(
	rulesetId: RulesetId,
	positionBuckets: ReadonlyArray<RankingPositionThreshold>,
	playerId: number
): Promise<Map<string, number | null>> {
	const pipeline = cacheServer.pipeline();
	for (const bucket of positionBuckets) {
		for (const type of RANKING_METRIC_TYPES) {
			pipeline.zrevrank(buildRankingKey(type, rulesetId, bucket), String(playerId));
		}
	}
	const results = await pipeline.exec();

	const positions = new Map<string, number | null>();
	let i = 0;
	for (const bucket of positionBuckets) {
		for (const type of RANKING_METRIC_TYPES) {
			const [, rank] = results![i++];
			positions.set(buildRankingPositionField(bucket, type), rank == null ? null : (rank as number) + 1);
		}
	}
	return positions;
}

export async function getCachedRankingPositionsForPlayers(
	rulesetId: RulesetId,
	positionBuckets: ReadonlyArray<RankingPositionThreshold>,
	playerIds: ReadonlyArray<number>
): Promise<Map<number, Map<string, number | null>>> {
	if (!playerIds.length) return new Map();

	const pipeline = cacheServer.pipeline();
	for (const playerId of playerIds) {
		for (const bucket of positionBuckets) {
			for (const type of RANKING_METRIC_TYPES) {
				pipeline.zrevrank(buildRankingKey(type, rulesetId, bucket), String(playerId));
			}
		}
	}
	const results = await pipeline.exec();

	const positions = new Map<number, Map<string, number | null>>();
	let i = 0;
	for (const playerId of playerIds) {
		const playerPositions = new Map<string, number | null>();
		for (const bucket of positionBuckets) {
			for (const type of RANKING_METRIC_TYPES) {
				const [, rank] = results![i++];
				playerPositions.set(buildRankingPositionField(bucket, type), rank == null ? null : (rank as number) + 1);
			}
		}
		positions.set(playerId, playerPositions);
	}
	return positions;
}

export async function populateRankingSortedSet(
	type: RankingMetricType,
	rulesetId: RulesetId,
	positionBucket: RankingPositionThreshold,
	entries: Array<{ playerId: number; value: number }>,
	reset = false
) {
	const key = buildRankingKey(type, rulesetId, positionBucket);
	if (reset) await cacheServer.del(key);
	if (!entries.length) return 0;

	const pipeline = cacheServer.pipeline();
	for (const { playerId, value } of entries) pipeline.zadd(key, value, String(playerId));
	const results = await pipeline.exec();
	const error = results?.find(([err]: [Error | null, unknown]) => err)?.[0];
	if (error) throw error;

	return entries.length;
}

export async function getCachedPlayerUsername(playerId: string | number) {
	return await cacheServer.hget(PLAYER_ID_TO_USERNAME_HASH, String(playerId));
}

export async function getCachedPlayerId(username: string) {
	const playerId = await cacheServer.hget(PLAYER_USERNAME_TO_ID_HASH, username);
	return playerId == null ? null : Number(playerId);
}

// TODO?: cache new players when scraping players - low prio since already done in getPlayerIdByName and getPlayerIdById
export async function cachePlayer(playerId: string | number, username: string) {
	const id = String(playerId);
	await cacheServer
		.pipeline()
		.hset(PLAYER_ID_TO_USERNAME_HASH, id, username)
		.hset(PLAYER_USERNAME_TO_ID_HASH, username, id)
		.exec();
}
