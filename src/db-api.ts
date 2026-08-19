import { ClientBase, QueryResult } from "pg";
import { DB_BEATMAPS_TABLE, DB_PLAYERS_TABLE, DB_RANKING_ROLLUP_TABLE, DB_SCORES_TABLE } from "./env.js";
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

// TODO: rethink this - maybe just don't split by ranking type?
export async function getLiveRankingForPlayer(client: ClientBase, rankingCode: string, rulesetId: RulesetId, playerId: number) {
	const parsedRanking = parsePositionThresholdAndRankingType(rankingCode);
	if (!parsedRanking) return;

	switch (parsedRanking.rankingType) {
		case "":
			return getLiveRankingForPlayer(client, playerId, rulesetId);
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

// TODO: move to types.d.ts
export type SingleBucketRankingData<B extends PositionBucket, CountOnly extends boolean> = {
  id: number;
  username: string;
  country_code: string;
  count_position: number;
  count: number;
} & (CountOnly extends true
  ? {}
  : {
      count_ss_position: number;
      count_ss: number;
      count_lazer_position: number;
      count_lazer: number;
      count_perma_position: number;
      count_perma: number;
      ranked_score_position: number;
      ranked_score: string;  // TODO: validate if string or if BIGINT converter works
      total_pp_position: number;
      total_pp: number;
      avg_acc: number;
      avg_map_len: number;
	  // TODO: probably want these outside position buckets?
    }) & (B extends 100
  ? {
      weighted_pp: number;
      weighted_count: number;
    }
  : {});

type MetricBucketStats<B extends number, CountOnly extends boolean> = CountOnly extends true
  ? {
      [K in B as `top_${K}_count_position`]: number;
      [K in B as `top_${K}_count`]: number;
    }
  : {
      [K in B as `top_${K}_count_position`]: number;
      [K in B as `top_${K}_count`]: number;
      [K in B as `top_${K}_count_ss_position`]: number;
      [K in B as `top_${K}_count_ss`]: number;
      [K in B as `top_${K}_count_lazer_position`]: number;
      [K in B as `top_${K}_count_lazer`]: number;
      [K in B as `top_${K}_count_perma_position`]: number;
      [K in B as `top_${K}_count_perma`]: number;
      [K in B as `top_${K}_ranked_score_position`]: number;
      [K in B as `top_${K}_ranked_score`]: string;
      [K in B as `top_${K}_total_pp_position`]: number;
      [K in B as `top_${K}_total_pp`]: number;
      [K in B as `top_${K}_avg_acc`]: number;
      [K in B as `top_${K}_avg_map_len`]: number;
    };

type AllBucketsStats<CountOnly extends boolean> =
  MetricBucketStats<1, CountOnly> &
  MetricBucketStats<8, CountOnly> &
  MetricBucketStats<15, CountOnly> &
  MetricBucketStats<25, CountOnly> &
  MetricBucketStats<50, CountOnly> &
  MetricBucketStats<100, CountOnly>;

// TODO: Pick<> from Player interface
export type FullPlayerRankingData<CountOnly extends boolean> = {
  id: number;
  username: string;
  country_code: string;
  weighted_pp: number;
  weighted_count: number;
} & AllBucketsStats<CountOnly>;

// TODO: Pick<> from Player interface
export type PlayerRankingData<CountOnly extends boolean> = {
  id: number;
  username: string;
  country_code: string;
} & AllBucketsStats<CountOnly>;
//

// TODO: move all of these into a separate file
// TODO: import POSITION_THRESHOLDS
function buildAggregations(countOnly: boolean) {
  return POSITION_THRESHOLDS.map(bucket => {
    const filter = bucket == 100 ? '' : ` FILTER (WHERE r.position <= ${bucket})`;
    let sql = `COALESCE(SUM(r.count)${filter}, 0)::INT AS top_${bucket}_count`;
    
    if (!countOnly) {
      sql += `,
        COALESCE(SUM(r.count_ss)${filter}, 0)::INT AS top_${bucket}_count_ss,
        COALESCE(SUM(r.count_lazer)${filter}, 0)::INT AS top_${bucket}_count_lazer,
        COALESCE(SUM(r.count_perma)${filter}, 0)::INT AS top_${bucket}_count_perma,
        COALESCE(SUM(r.ranked_score)${filter}, 0)::BIGINT AS top_${bucket}_ranked_score,
        COALESCE(SUM(r.total_pp)${filter}, 0)::INT AS top_${bucket}_total_pp,
        COALESCE(AVG(r.avg_acc)${filter}, 0)::REAL AS top_${bucket}_avg_acc,
        COALESCE(AVG(r.avg_map_len)${filter}, 0)::REAL AS top_${bucket}_avg_map_len`;
    }
    return sql;
  }).join(',\n        ');
}

// TODO: store the ranking positions in the player ruleset stats table.....
function buildOuterSelects(countOnly: boolean) {
  return POSITION_THRESHOLDS.map(bucket => {
    let sql = `(DENSE_RANK() OVER (ORDER BY agg.top_${bucket}_count DESC NULLS LAST, p.id))::INT AS top_${bucket}_position,
        agg.top_${bucket}_count`;
    
    if (!countOnly) {
      sql += `,
        agg.top_${bucket}_count_ss,
        agg.top_${bucket}_count_lazer,
        agg.top_${bucket}_count_perma,
        agg.top_${bucket}_ranked_score,
        agg.top_${bucket}_total_pp,
        agg.top_${bucket}_avg_acc,
        agg.top_${bucket}_avg_map_len`;
    }
    return sql;
  }).join(',\n        ');
}

function buildMultiBucketAggregations(countOnly: boolean): string {
  return BUCKETS.map(bucket => {
    const filter = bucket === 100 ? '' : ` FILTER (WHERE r.position <= ${bucket})`;
    let sql = `COALESCE(SUM(r.count)${filter}, 0)::INT AS top_${bucket}_count`;

    if (!countOnly) {
      sql += `,
        COALESCE(SUM(r.count_ss)${filter}, 0)::INT AS top_${bucket}_count_ss,
        COALESCE(SUM(r.count_lazer)${filter}, 0)::INT AS top_${bucket}_count_lazer,
        COALESCE(SUM(r.count_perma)${filter}, 0)::INT AS top_${bucket}_count_perma,
        COALESCE(SUM(r.ranked_score)${filter}, 0)::BIGINT AS top_${bucket}_ranked_score,
        COALESCE(SUM(r.total_pp)${filter}, 0)::INT AS top_${bucket}_total_pp,
        COALESCE(AVG(r.avg_acc)${filter}, 0)::REAL AS top_${bucket}_avg_acc,
        COALESCE(AVG(r.avg_map_len)${filter}, 0)::REAL AS top_${bucket}_avg_map_len`;
    }
    return sql;
  }).join(',\n        ');
}

function buildMultiBucketOuterSelects(countOnly: boolean): string {
  return BUCKETS.map(bucket => {
    let sql = `(DENSE_RANK() OVER (ORDER BY agg.top_${bucket}_count DESC NULLS LAST, p.id ASC))::INT AS top_${bucket}_count_position,
        agg.top_${bucket}_count`;

    if (!countOnly) {
      sql += `,
        (DENSE_RANK() OVER (ORDER BY agg.top_${bucket}_count_ss DESC NULLS LAST, p.id ASC))::INT AS top_${bucket}_count_ss_position,
        agg.top_${bucket}_count_ss,
        (DENSE_RANK() OVER (ORDER BY agg.top_${bucket}_count_lazer DESC NULLS LAST, p.id ASC))::INT AS top_${bucket}_count_lazer_position,
        agg.top_${bucket}_count_lazer,
        (DENSE_RANK() OVER (ORDER BY agg.top_${bucket}_count_perma DESC NULLS LAST, p.id ASC))::INT AS top_${bucket}_count_perma_position,
        agg.top_${bucket}_count_perma,
        (DENSE_RANK() OVER (ORDER BY agg.top_${bucket}_ranked_score DESC NULLS LAST, p.id ASC))::INT AS top_${bucket}_ranked_score_position,
        agg.top_${bucket}_ranked_score,
        (DENSE_RANK() OVER (ORDER BY agg.top_${bucket}_total_pp DESC NULLS LAST, p.id ASC))::INT AS top_${bucket}_total_pp_position,
        agg.top_${bucket}_total_pp,
        agg.top_${bucket}_avg_acc,
        agg.top_${bucket}_avg_map_len`;
    }
    return sql;
  }).join(',\n');
}

export async function getLiveRankingForPlayer<T extends boolean = true>(
  client: ClientBase,
  playerId: number,
  rulesetId: RulesetId,
  countOnly: T = true as T
): Promise<FullPlayerRankingData<T> | null> {
  const aggSelects = buildMultiBucketAggregations(countOnly);
  const outerSelects = buildMultiBucketOuterSelects(countOnly);

  const rollupTable = process.env.DB_RANKING_ROLLUP_TABLE || 'player_position_stats';
  const playersTable = process.env.DB_PLAYERS_TABLE || 'players';
  const statsTable = process.env.DB_PLAYER_RULESET_STATS_TABLE || 'player_ruleset_stats';

  const query = `
    WITH agg AS (
        SELECT
            r.user_id,
            ${aggSelects}
        FROM ${rollupTable} r
        WHERE r.ruleset_id = $1
        GROUP BY r.user_id
    ),
    ranked AS (
        SELECT 
            p.id,
            p.username,
            p.country_code,
            COALESCE(prs.weighted_pp, 0)::FLOAT AS weighted_pp,
            COALESCE(prs.weighted_count, 0)::INT AS weighted_count,
            ${outerSelects}
        FROM ${playersTable} p
        JOIN agg ON agg.user_id = p.id
        LEFT JOIN ${statsTable} prs ON prs.user_id = p.id AND prs.ruleset_id = $1
    )
    SELECT * 
    FROM ranked 
    WHERE id = $2;
  `;

  const res = await client.query(query, [rulesetId, playerId]);
  return res.rows[0] || null;
}

export async function getPaginatedRankingForBucket<
  B extends PositionThreshold,
  T extends boolean = false
>(
  client: ClientBase,
  rulesetId: RulesetId,
  bucket: B,
  lowerBound: number,
  upperBound: number,
  countOnly: T = false as T
): Promise<SingleBucketRankingData<B, T>[]> {
  // Hard cap at 10,000 players max
  const MAX_LIMIT = 10000;
  const safeLower = Math.max(1, lowerBound);
  const safeUpper = Math.min(MAX_LIMIT, upperBound);
  const limit = Math.max(0, safeUpper - safeLower + 1);
  const offset = safeLower - 1;

  if (limit === 0) return [];

  const positionCondition = bucket == 100 ? '' : `AND r.position <= ${bucket}`;
  const isTop100 = bucket == 100;

  let aggSelects = `COALESCE(SUM(r.count), 0)::INT AS count`;
  let outerSelects = `(DENSE_RANK() OVER (ORDER BY agg.count DESC NULLS LAST, p.id ASC))::INT AS count_position,
        agg.count`;

  if (!countOnly) {
    aggSelects += `,
      COALESCE(SUM(r.count_ss), 0)::INT AS count_ss,
      COALESCE(SUM(r.count_lazer), 0)::INT AS count_lazer,
      COALESCE(SUM(r.count_perma), 0)::INT AS count_perma,
      COALESCE(SUM(r.ranked_score), 0)::BIGINT AS ranked_score,
      COALESCE(SUM(r.total_pp), 0)::INT AS total_pp,
      COALESCE(AVG(r.avg_acc), 0)::REAL AS avg_acc,
      COALESCE(AVG(r.avg_map_len), 0)::REAL AS avg_map_len`;

    outerSelects += `,
      (DENSE_RANK() OVER (ORDER BY agg.count_ss DESC NULLS LAST, p.id ASC))::INT AS count_ss_position,
      agg.count_ss,
      (DENSE_RANK() OVER (ORDER BY agg.count_lazer DESC NULLS LAST, p.id ASC))::INT AS count_lazer_position,
      agg.count_lazer,
      (DENSE_RANK() OVER (ORDER BY agg.count_perma DESC NULLS LAST, p.id ASC))::INT AS count_perma_position,
      agg.count_perma,
      (DENSE_RANK() OVER (ORDER BY agg.ranked_score DESC NULLS LAST, p.id ASC))::INT AS ranked_score_position,
      agg.ranked_score,
      (DENSE_RANK() OVER (ORDER BY agg.total_pp DESC NULLS LAST, p.id ASC))::INT AS total_pp_position,
      agg.total_pp,
      agg.avg_acc,
      agg.avg_map_len`;
  }

	// TODO: probably want these outside the bucket
  if (isTop100) {
    outerSelects += `,
      COALESCE(prs.weighted_pp, 0)::REAL AS weighted_pp,
      COALESCE(prs.weighted_count, 0)::INT AS weighted_count`;
  }

  const query = `
    WITH agg AS (
        SELECT
            r.user_id,
            ${aggSelects}
        FROM ${DB_RANKING_ROLLUP_TABLE} r
        WHERE r.ruleset_id = $1
        ${positionCondition}
        GROUP BY r.user_id
    )
    SELECT
        p.id,
        p.username,
        p.country_code,
        ${outerSelects}
    FROM ${DB_PLAYERS_TABLE} p
    JOIN agg ON agg.user_id = p.id
    ${isTop100 ? `LEFT JOIN ${DB_PLAYER_RULESET_STATS_TABLE} prs ON prs.user_id = p.id AND prs.ruleset_id = $1` : ''}
    ORDER BY agg.count DESC NULLS LAST, p.id ASC
    LIMIT $2 OFFSET $3;
  `;

  const res = await client.query(query, [rulesetId, limit, offset]);
  return res.rows;
}

export async function getLiveRankingForPlayer<T extends boolean = true>(
  client: ClientBase, 
  playerId: number, 
  rulesetId: RulesetId, 
  countOnly: T = true as T
) {
	// TODO: rename
  const aggSelects = buildAggregations(countOnly);
  const outerSelects = buildOuterSelects(countOnly);

  const res = await queryWithTiming<PlayerRankingData<T>>(client, "getLiveRankingForPlayer","pog_api_v2", 
`WITH agg AS (
        SELECT
            r.user_id,
            ${aggSelects}
        FROM ${DB_RANKING_ROLLUP_TABLE} r
        WHERE r.ruleset_id = $1
        GROUP BY r.user_id
    ),
    ranked AS (
        SELECT 
            p.id,
            p.username,
            p.country_code,
            ${outerSelects}
        FROM ${DB_PLAYERS_TABLE} p
        JOIN agg ON agg.user_id = p.id
    )
    SELECT *
    FROM ranked
    WHERE id = $2
  `,
[rulesetId, playerId]);
  return res.rows?.[0] || null;
}
//

// TODO format + type PlayerFullRankingData
// TODO use buildAggregations()
// TODO validate whether dense_rank really is more performant than rank
export async function getFullRankingFromRollup(client: ClientBase, rulesetId: RulesetId) {
	return await queryWithTiming<PlayerFullRankingData[]>(
		client,
		"getFullRankingFromRollup",
		"pog_api_v2",
		`WITH agg AS (
		    SELECT
		        r.user_id,
		        
		        SUM(r.count) FILTER (WHERE r.position <= 1) AS top_1_count,
		        SUM(r.count_ss) FILTER (WHERE r.position <= 1) AS top_1_count_ss,
		        SUM(r.count_lazer) FILTER (WHERE r.position <= 1) AS top_1_count_lazer,
		        SUM(r.count_perma) FILTER (WHERE r.position <= 1) AS top_1_count_perma,
		        SUM(r.ranked_score) FILTER (WHERE r.position <= 1) AS top_1_ranked_score,
		        SUM(r.total_pp) FILTER (WHERE r.position <= 1) AS top_1_total_pp,
		        AVG(r.avg_acc) FILTER (WHERE r.position <= 1) AS top_1_avg_acc,
		        AVG(r.avg_map_len) FILTER (WHERE r.position <= 1) AS top_1_avg_map_len,
		
		        SUM(r.count) FILTER (WHERE r.position <= 8) AS top_8_count,
		        SUM(r.count_ss) FILTER (WHERE r.position <= 8) AS top_8_count_ss,
		        SUM(r.count_lazer) FILTER (WHERE r.position <= 8) AS top_8_count_lazer,
		        SUM(r.count_perma) FILTER (WHERE r.position <= 8) AS top_8_count_perma,
		        SUM(r.ranked_score) FILTER (WHERE r.position <= 8) AS top_8_ranked_score,
		        SUM(r.total_pp) FILTER (WHERE r.position <= 8) AS top_8_total_pp,
		        AVG(r.avg_acc) FILTER (WHERE r.position <= 8) AS top_8_avg_acc,
		        AVG(r.avg_map_len) FILTER (WHERE r.position <= 8) AS top_8_avg_map_len,
		
		        SUM(r.count) FILTER (WHERE r.position <= 15) AS top_15_count,
		        SUM(r.count_ss) FILTER (WHERE r.position <= 15) AS top_15_count_ss,
		        SUM(r.count_lazer) FILTER (WHERE r.position <= 15) AS top_15_count_lazer,
		        SUM(r.count_perma) FILTER (WHERE r.position <= 15) AS top_15_count_perma,
		        SUM(r.ranked_score) FILTER (WHERE r.position <= 15) AS top_15_ranked_score,
		        SUM(r.total_pp) FILTER (WHERE r.position <= 15) AS top_15_total_pp,
		        AVG(r.avg_acc) FILTER (WHERE r.position <= 15) AS top_15_avg_acc,
		        AVG(r.avg_map_len) FILTER (WHERE r.position <= 15) AS top_15_avg_map_len,
		
		        SUM(r.count) FILTER (WHERE r.position <= 25) AS top_25_count,
		        SUM(r.count_ss) FILTER (WHERE r.position <= 25) AS top_25_count_ss,
		        SUM(r.count_lazer) FILTER (WHERE r.position <= 25) AS top_25_count_lazer,
		        SUM(r.count_perma) FILTER (WHERE r.position <= 25) AS top_25_count_perma,
		        SUM(r.ranked_score) FILTER (WHERE r.position <= 25) AS top_25_ranked_score,
		        SUM(r.total_pp) FILTER (WHERE r.position <= 25) AS top_25_total_pp,
		        AVG(r.avg_acc) FILTER (WHERE r.position <= 25) AS top_25_avg_acc,
		        AVG(r.avg_map_len) FILTER (WHERE r.position <= 25) AS top_25_avg_map_len,
	
				SUM(r.count) FILTER (WHERE r.position <= 50) AS top_50_count,
		        SUM(r.count_ss) FILTER (WHERE r.position <= 50) AS top_50_count_ss,
		        SUM(r.count_lazer) FILTER (WHERE r.position <= 50) AS top_50_count_lazer,
		        SUM(r.count_perma) FILTER (WHERE r.position <= 50) AS top_50_count_perma,
		        SUM(r.ranked_score) FILTER (WHERE r.position <= 50) AS top_50_ranked_score,
		        SUM(r.total_pp) FILTER (WHERE r.position <= 50) AS top_50_total_pp,
		        AVG(r.avg_acc) FILTER (WHERE r.position <= 50) AS top_50_avg_acc,
		        AVG(r.avg_map_len) FILTER (WHERE r.position <= 50) AS top_50_avg_map_len,
		
		        SUM(r.count) AS top_100_count,
		        SUM(r.count_ss) AS top_100_count_ss,
		        SUM(r.count_lazer) AS top_100_count_lazer,
		        SUM(r.count_perma) AS top_100_count_perma,
		        SUM(r.ranked_score) AS top_100_ranked_score,
		        SUM(r.total_pp) AS top_100_total_pp,
		        AVG(r.avg_acc) AS top_100_avg_acc,
		        AVG(r.avg_map_len) AS top_100_avg_map_len
		    FROM ${DB_RANKING_ROLLUP_TABLE} r
		    WHERE r.ruleset_id = $1
		    GROUP BY r.user_id
		)
		SELECT 
		    p.id,
		    p.username,
		    p.country_code,
		
		    DENSE_RANK() OVER (ORDER BY agg.top_1_count DESC NULLS LAST, p.id) AS top_1_position, 
		    agg.top_1_count, agg.top_1_count_ss, agg.top_1_count_lazer, agg.top_1_count_perma, 
		    agg.top_1_ranked_score, agg.top_1_total_pp, agg.top_1_avg_acc, agg.top_1_avg_map_len,
		
		    DENSE_RANK() OVER (ORDER BY agg.top_8_count DESC NULLS LAST, p.id) AS top_8_position, 
		    agg.top_8_count, agg.top_8_count_ss, agg.top_8_count_lazer, agg.top_8_count_perma, 
		    agg.top_8_ranked_score, agg.top_8_total_pp, agg.top_8_avg_acc, agg.top_8_avg_map_len,
		
		    DENSE_RANK() OVER (ORDER BY agg.top_15_count DESC NULLS LAST, p.id) AS top_15_position, 
		    agg.top_15_count, agg.top_15_count_ss, agg.top_15_count_lazer, agg.top_15_count_perma, 
		    agg.top_15_ranked_score, agg.top_15_total_pp, agg.top_15_avg_acc, agg.top_15_avg_map_len,
		
		    DENSE_RANK() OVER (ORDER BY agg.top_25_count DESC NULLS LAST, p.id) AS top_25_position, 
		    agg.top_25_count, agg.top_25_count_ss, agg.top_25_count_lazer, agg.top_25_count_perma, 
		    agg.top_25_ranked_score, agg.top_25_total_pp, agg.top_25_avg_acc, agg.top_25_avg_map_len,
		
		    DENSE_RANK() OVER (ORDER BY agg.top_50_count DESC NULLS LAST, p.id) AS top_50_position, 
		    agg.top_50_count, agg.top_50_count_ss, agg.top_50_count_lazer, agg.top_50_count_perma, 
		    agg.top_50_ranked_score, agg.top_50_total_pp, agg.top_50_avg_acc, agg.top_50_avg_map_len,
		
		    DENSE_RANK() OVER (ORDER BY agg.top_100_count DESC NULLS LAST, p.id) AS top_100_position, 
		    agg.top_100_count, agg.top_100_count_ss, agg.top_100_count_lazer, agg.top_100_count_perma, 
		    agg.top_100_ranked_score, agg.top_100_total_pp, agg.top_100_avg_acc, agg.top_100_avg_map_len
		FROM ${DB_PLAYERS_TABLE} p
		JOIN agg ON agg.user_id = p.id`,
		[rulesetId]);
}

export async function getPositionSpreadForPlayer(client: ClientBase, playerId: number, rulesetId: RulesetId) {
	const result = await queryWithTiming<{ spread: PlayerPositionSpread }>(
		client,
		"getPositionSpreadForPlayer",
		"pog_api_v2",
		`SELECT get_position_spread($1, $2::SMALLINT) AS spread`,
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
	const result = await queryWithTiming<{ spread: PlayerGradeSpread }>(
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

// TODO: type and optimize query
export async function getModSpreadForPlayer(
	client: ClientBase,
	playerId: number,
	rulesetId: RulesetId,
	positionThreshold: RankingPositionThreshold = 100
) {
	const result = await queryWithTiming<{ spread: PlayerModSpread }>(
		client,
		"getModSpreadForPlayer",
		"pog_api_v2",
		`WITH base AS (
			SELECT
					s.id,
					COALESCE(
							array_agg(DISTINCT norm_acronym ORDER BY norm_acronym)
									FILTER (WHERE norm_acronym IS NOT NULL),
							ARRAY[]::text[]
					) AS mods_arr
			FROM ${DB_SCORES_TABLE} s
			LEFT JOIN LATERAL jsonb_array_elements(s.data->'mods') m ON true
			LEFT JOIN LATERAL (
					SELECT CASE m->>'acronym'
							WHEN 'NC' THEN 'DT'
							WHEN 'DT' THEN 'DT'
							WHEN 'DC' THEN 'HT'
							WHEN 'HT' THEN 'HT'
							WHEN 'BL' THEN 'BL'
							WHEN 'FL' THEN 'FL'
							WHEN 'HR' THEN 'HR'
							WHEN 'HD' THEN 'HD'
							WHEN 'TC' THEN 'TC'
							WHEN 'EZ' THEN 'EZ'
							WHEN 'RX' THEN 'RX'
							WHEN 'AP' THEN 'AP'
							WHEN 'TD' THEN 'TD'
							ELSE NULL
					END AS norm_acronym
			) n ON true
			WHERE s.user_id = $1
				and s.ruleset_id = $2
				and s.position BETWEEN 1 AND $3
			GROUP BY s.id
	), expanded AS (
			SELECT
					b.id,
					CASE
							WHEN cardinality(mods_variant) = 0 THEN 'NM'
							ELSE array_to_string(mods_variant, ',')
					END AS variant_key
			FROM base b
			CROSS JOIN LATERAL (
					SELECT
							('HD' = ANY(b.mods_arr)) AS has_hd,
							('TC' = ANY(b.mods_arr)) AS has_tc
			) flags
			CROSS JOIN LATERAL (
					SELECT
							CASE
									WHEN NOT flags.has_hd AND NOT flags.has_tc
											THEN ARRAY[0]          -- only full
									WHEN flags.has_hd
											THEN ARRAY[0,1]        -- full, -HD
									WHEN flags.has_tc
											THEN ARRAY[0,2]        -- full, -TC
							END AS variants
			) vset
			CROSS JOIN LATERAL unnest(vset.variants) AS gs(variant_id)
			CROSS JOIN LATERAL (
					SELECT CASE gs.variant_id
							WHEN 0 THEN b.mods_arr
							WHEN 1 THEN array_remove(b.mods_arr, 'HD')
							WHEN 2 THEN array_remove(b.mods_arr, 'TC')
					END AS mods_variant
			) v
	)
	SELECT jsonb_object_agg(variant_key, cnt) AS spread
	FROM (
			SELECT variant_key, COUNT(*) AS cnt
			FROM expanded
			GROUP BY variant_key
	) t`, 
 [playerId, rulesetId, positionThreshold]);

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
				b.ar as base_ar,
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
		WHERE b.star_rating < 2.7
			AND b.od <= 4.5
			AND b.ar <= 6
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
