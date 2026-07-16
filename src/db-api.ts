import { ClientBase, QueryResult } from "pg";
import { DB_PLAYERS_TABLE, DB_SCORES_TABLE } from "./env.js";
import { parsePositionThresholdAndRankingType } from "./shared.js";
import { queryWithTiming, timeDbQuery } from "./metrics.js";

export async function getPlayerIdByIdOrName(client: ClientBase, idOrName: string | number) {
	if (!idOrName) return null;
	if (typeof idOrName == "number") return idOrName;
	return (await getPlayerIdByName(client, idOrName)) || (await getPlayerIdById(client, idOrName));
}

export async function getPlayerIdByName(client: ClientBase, name: string) {
	return await getPlayerIdByLowercaseName(client, name.trim().toLowerCase());
}

// TODO: move to redis
export async function getPlayerIdByLowercaseName(client: ClientBase, name: string) {
	const result: QueryResult<{ id: number }> = await client.query(
		`SELECT id FROM ${DB_PLAYERS_TABLE} WHERE LOWER(username) = $1`,
		[name]
	);
	return (result?.rows?.[0]?.id ?? null) as number | null;
}

// TODO: move to redis
// validates if id is a real number and the player exists in the database
export async function getPlayerIdById(client: ClientBase, id: string | number) {
	try {
		const result: QueryResult<{ id: number }> = await client.query(`SELECT id FROM ${DB_PLAYERS_TABLE} WHERE id = $1`, [
			id
		]);
		return result?.rows?.[0]?.id;
	} catch (e) {
		return null; // assume the id wasn't a valid number
	}
}

// TODO: move to redis
export async function getRankingId(client: ClientBase, rulesetId: RulesetId, code: string) {}

export async function getRankingForPlayer(client: ClientBase, rankingCode: string, playerId: number, date?: string) {
	if (!date) return getLiveRankingForPlayer(client, rankingCode, playerId); // ...or check if date is today
}

export async function getLiveRankingForPlayer(client: ClientBase, rankingCode: string, playerId: number) {
	const parsedRanking = parsePositionThresholdAndRankingType(rankingCode);
	if (!parsedRanking) return;

	switch (parsedRanking.rankingType) {
		case "":
			return getLiveCountRankingForPlayer(client, playerId);
		case "-pp":
			return;
	}
}

export async function getLiveCountRankingForPlayer(client: ClientBase, playerId: number) {
	const result = await queryWithTiming<PlayerLiveCountData>(
		client,
		"getLiveCountRankingForPlayer",
		"pog_api_v2",
		`
    SELECT 
      COUNT(s.id) FILTER (WHERE s.position <= 1) AS top_1,
      COUNT(s.id) FILTER (WHERE s.position <= 8) AS top_8,
      COUNT(s.id) FILTER (WHERE s.position <= 15) AS top_15,
      COUNT(s.id) FILTER (WHERE s.position <= 25) AS top_25,
      COUNT(s.id) FILTER (WHERE s.position <= 50) AS top_50,
      COUNT(s.id) FILTER (WHERE s.position <= 100) AS top_100
    FROM ${DB_SCORES_TABLE} s
    WHERE user_id = $1`,
		[playerId]
	);

	return result.rows?.[0];
}
