import { ClientBase } from "pg";
import { DB_PLAYER_RULESET_STATS_TABLE, DB_PLAYERS_TABLE, DB_RANKING_ROLLUP_TABLE } from "./env.js";
import { queryWithTiming } from "./metrics.js";
import { isAfterDate, isDateInvalid, isToday, parsePositionThresholdAndRankingType } from "./shared.js";

export async function getRankingForPlayer(
	client: ClientBase,
	rankingCodes: string[],
	rulesetId: RulesetId,
	playerId: number,
	date?: string
) {
	if (!date || isToday(new Date(date))) return getLiveRankingForPlayer(client, rankingCodes, rulesetId, playerId);
	if (isDateInvalid(date) || isAfterDate(new Date(date), new Date())) return; // TODO: idk error message somehow
	// TODO: otherwise historical ranking
}

// TODO: use timedQuery
export async function getLiveRankingForPlayer(
	client: ClientBase,
	rankingCodes: string[],
	rulesetId: RulesetId,
	playerId: number
) {
	if (!rankingCodes?.length || rankingCodes.length > 25) return;
  
	const parsedRankings = rankingCodes.map(parsePositionThresholdAndRankingType);
	const positionThresholds: RankingPositionThreshold[] = [];
	const rankingTypes: string[] = [];
	for (const parsed of parsedRankings) {
		if (!parsed) return; // TODO: error message
		positionThresholds.push(parsed.positionThreshold);
		rankingTypes.push(parsed.rankingType);
	}

	const aggSelects = buildMultiBucketAggregations(rankingTypes, positionThresholds);
	const outerSelects = buildMultiBucketOuterSelects(rankingTypes, positionThresholds);

	const query = `
    WITH agg AS (
      SELECT r.user_id, ${aggSelects}
      FROM ${DB_RANKING_ROLLUP_TABLE} r
      WHERE r.ruleset_id = $1
      GROUP BY r.user_id
    ),
    ranked AS (
      SELECT 
          p.id,
          p.username,rollupTable
          p.country_code,
          COALESCE(prs.weighted_pp, 0)::REAL AS weighted_pp,
          COALESCE(prs.weighted_count, 0)::INT AS weighted_count,
          ${outerSelects}
      FROM ${DB_PLAYERS_TABLE} p
        JOIN agg ON agg.user_id = p.id
        LEFT JOIN ${DB_PLAYER_RULESET_STATS_TABLE} prs ON prs.user_id = p.id AND prs.ruleset_id = $1
    )
    SELECT * 
    FROM ranked 
    WHERE id = $2;
  `;

	const res = await client.query(query, [rulesetId, playerId]);
	return res?.rows[0];
}

/////
// TODO: store the ranking positions in the player ruleset stats table.....
/////

// TODO
function buildMultiBucketAggregations(rankingTypes: string[], positionThresholds: RankingPositionThreshold[]) {
	return positionThresholds
		.map(bucket => {
			const filter = bucket === 100 ? "" : ` FILTER (WHERE r.position <= ${bucket})`;
			let sql = `COALESCE(SUM(r.count)${filter}, 0)::INT AS top_${bucket}_count`;

			sql += `,
        COALESCE(SUM(r.count_ss)${filter}, 0)::INT AS top_${bucket}_count_ss,
        COALESCE(SUM(r.count_lazer)${filter}, 0)::INT AS top_${bucket}_count_lazer,
        COALESCE(SUM(r.count_perma)${filter}, 0)::INT AS top_${bucket}_count_perma,
        COALESCE(SUM(r.ranked_score)${filter}, 0)::BIGINT AS top_${bucket}_ranked_score,
        COALESCE(SUM(r.total_pp)${filter}, 0)::INT AS top_${bucket}_total_pp,
        COALESCE(AVG(r.avg_acc)${filter}, 0)::REAL AS top_${bucket}_avg_acc,
        COALESCE(AVG(r.avg_map_len)${filter}, 0)::REAL AS top_${bucket}_avg_map_len`;

			return sql;
		})
		.join(",\n");
}

// TODO
function buildMultiBucketOuterSelects(rankingTypes: string[], positionThresholds: RankingPositionThreshold[]) {
	return positionThresholds
		.map(bucket => {
			let sql = `(DENSE_RANK() OVER (ORDER BY agg.top_${bucket}_count DESC NULLS LAST, p.id ASC))::INT AS top_${bucket}_count_position,
        agg.top_${bucket}_count`;

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

			return sql;
		})
		.join(",\n");
}

export async function getPaginatedRankingForBucket(
	client: ClientBase,
	rulesetId: RulesetId,
	positionThreshold: RankingPositionThreshold,
	lowerBound: number,
	upperBound: number
): Promise<SingleBucketRankingData[]> {
	const MAX_LIMIT = 10000;
	const safeLower = Math.max(1, lowerBound);
	const safeUpper = Math.min(MAX_LIMIT, upperBound);
	const limit = safeUpper - safeLower + 1;
	const offset = safeLower - 1;

	if (limit <= 0 || limit >= 1000) return [];

	const positionCondition = positionThreshold == 100 ? "" : `AND r.position <= ${positionThreshold}`;

	let aggSelects = `COALESCE(SUM(r.count), 0)::INT AS count`;
	let outerSelects = `(DENSE_RANK() OVER (ORDER BY agg.count DESC NULLS LAST, p.id ASC))::INT AS count_position,
        agg.count`;

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

	// TODO: probably want these outside any bucket
	outerSelects += `,
      COALESCE(prs.weighted_pp, 0)::REAL AS weighted_pp,
      COALESCE(prs.weighted_count, 0)::INT AS weighted_count`;

	const query = `
    WITH agg AS (
      SELECT r.user_id, ${aggSelects}
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
      LEFT JOIN ${DB_PLAYER_RULESET_STATS_TABLE} prs ON prs.user_id = p.id AND prs.ruleset_id = $1
    ORDER BY agg.count DESC NULLS LAST, p.id ASC
    LIMIT $2 OFFSET $3;
  `;

	const res = await client.query(query, [rulesetId, limit, offset]);
	return res.rows;
}

// TODO join to player_ruleset_stats to get weighted_pp and weighted_count
// TODO use buildAggregations()
// TODO validate whether dense_rank really is more performant than rank
export async function getFullRankingFromRollup(client: ClientBase, rulesetId: RulesetId) {
	return await queryWithTiming<FullPlayerRankingData[]>(
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
      p.country_code AS countryCode,
  
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
		[rulesetId]
	);
}
