import { ClientBase, QueryResult } from "pg";
import { DB_BEATMAPS_TABLE, DB_PLAYERS_TABLE, DB_SCORES_TABLE } from "./env.js";
import { queryWithTiming } from "./metrics.js";
import { parsePositionThresholdAndRankingType } from "./shared.js";

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
		const result: QueryResult<{ id: number }> = await client.query(`SELECT id FROM ${DB_PLAYERS_TABLE} WHERE id = $1`, [id]);
		return result?.rows?.[0]?.id;
	} catch (e) {
		return null; // assume the id wasn't a valid number
	}
}

// TODO: move to redis
export async function getRankingId(client: ClientBase, rulesetId: RulesetId, code: string) {}

export async function getRankingForPlayer(
	client: ClientBase,
	rankingCode: string,
	rulesetId: RulesetId,
	playerId: number,
	date?: string
) {
	// TODO: ...or check if date is today
	if (!date) return getLiveRankingForPlayer(client, rankingCode, rulesetId, playerId);
	// TODO: otherwise historical ranking
}

export async function getLiveRankingForPlayer(client: ClientBase, rankingCode: string, rulesetId: RulesetId, playerId: number) {
	const parsedRanking = parsePositionThresholdAndRankingType(rankingCode);
	if (!parsedRanking) return;

	switch (parsedRanking.rankingType) {
		case "":
			return getLiveCountRankingForPlayer(client, playerId, rulesetId);
		case "-weighted":
			console.log("weighted");
			break;
		case "-total-pp":
			console.log("-total-pp");
			break;
		case "-weighted-pp":
			console.log("-weighted-pp");
			break;
		case "-ranked-score":
			console.log("-ranked-score");
			break;
		case "-ss":
			console.log("-ss");
			break;
	}
}

export async function getLiveCountRankingForPlayer(client: ClientBase, playerId: number, rulesetId: RulesetId) {
	const result = await queryWithTiming<PlayerLiveCountData>(
		client,
		"getLiveCountRankingForPlayer",
		"pog_api_v2",
		`
    SELECT 
      COUNT(s.id) FILTER (WHERE s.position BETWEEN 1 AND 1) AS top_1,
      COUNT(s.id) FILTER (WHERE s.position BETWEEN 1 AND 8) AS top_8,
      COUNT(s.id) FILTER (WHERE s.position BETWEEN 1 AND 15) AS top_15,
      COUNT(s.id) FILTER (WHERE s.position BETWEEN 1 AND 25) AS top_25,
      COUNT(s.id) FILTER (WHERE s.position BETWEEN 1 AND 50) AS top_50,
      COUNT(s.id) FILTER (WHERE s.position BETWEEN 1 AND 100) AS top_100
    FROM ${DB_SCORES_TABLE} s
    WHERE user_id = $1`,
		[playerId]
	);

	return result.rows?.[0];
}

export async function getPositionSpreadForPlayer(client: ClientBase, playerId: number, rulesetId: RulesetId) {
	const result = await queryWithTiming<{spread: PlayerPositionSpread}>(
		client,
		"getPositionSpreadForPlayer",
		"pog_api_v2",
		`
		WITH counts AS (
				SELECT position, COUNT(id) AS cnt
				FROM ${DB_SCORES_TABLE}
				WHERE user_id = $1
					AND ruleset_id = $2
					AND position BETWEEN 1 AND 100
				GROUP BY position
		),
		arr AS (SELECT array_agg(cnt ORDER BY position) AS a FROM counts)

		SELECT json_agg(COALESCE(arr.a[i], 0) ORDER BY i) AS spread
		FROM arr, generate_series(1, 100) AS g(i)`,
		[playerId, rulesetId]
	);

	return result.rows?.[0]?.spread ?? [];
}

export async function getGradeSpreadForPlayer(
	client: ClientBase,
	playerId: number,
	rulesetId: RulesetId,
	positionThreshold: RankingPositionThreshold = 100
) {
	const result = await queryWithTiming<{spread: PlayerGradeSpread}>(
		client,
		"getGradeSpreadForPlayer",
		"pog_api_v2",
		`
		SELECT json_object_agg(grade, cnt) AS spread
		FROM (
			SELECT grade, COUNT(id) AS cnt
			FROM ${DB_SCORES_TABLE}
			WHERE user_id = $1
				AND ruleset_id = $2
				AND position BETWEEN 1 AND $3
			GROUP BY grade
		)`,
		[playerId, rulesetId, positionThreshold]
	);

	return result.rows?.[0]?.spread ?? {};
}

// TODO?: materialized view that updates every few minutes?
export async function getEasiestBeatmapsWithoutPermaScore(client: ClientBase, rulesetId: RulesetId, positionThreshold: number) {
	const result = await client.query<BeatmapWithoutPermaScore>(
		`
		SELECT
				b.id,
				b.beatmapset_id,
				b.status,
				b.artist,
				b.title,
				b.version,
				b.creator,
				b.approved_date,
				b.star_rating AS base_star_rating,
				b.total_length AS base_total_length,
				b.od AS base_od,
				s.position AS highest_non_perma_position
		FROM ${DB_BEATMAPS_TABLE} b
			LEFT JOIN (
					SELECT DISTINCT ON (beatmap_id, ruleset_id)
							beatmap_id,
							ruleset_id,
							position
					FROM ${DB_SCORES_TABLE}
					WHERE ruleset_id = $1
						AND is_perma = FALSE
					ORDER BY beatmap_id, ruleset_id, position
			) s ON s.beatmap_id = b.id AND s.ruleset_id = b.ruleset_id
		WHERE b.star_rating < 2.5
			AND b.od <= 5
			AND s.position <= $2`,
		[rulesetId, positionThreshold]
	);

	return result.rows;
}

export async function getBeatmapCount(client: ClientBase, rulesetId: RulesetId, statuses: BeatmapStatusId[]) {
	const result = await client.query<{ beatmaps: number }>(
		`SELECT COUNT(id) AS beatmaps
		FROM ${DB_BEATMAPS_TABLE}
		WHERE ruleset_id = $1
			AND status = ANY($2::SMALLINT[])`,
		[rulesetId, statuses]
	);

	return result.rows[0]?.beatmaps ?? -1;
}
