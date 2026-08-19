import { ClientBase, QueryResult } from "pg";
import { DB_BEATMAPS_TABLE, DB_PLAYERS_TABLE, DB_SCORES_TABLE } from "./env.js";
import { queryWithTiming } from "./metrics.js";

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
					array_agg(DISTINCT norm_acronym ORDER BY norm_acronym) FILTER (WHERE norm_acronym IS NOT NULL),
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
								THEN ARRAY[0]          -- full only
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
		[playerId, rulesetId, positionThreshold]
	);

	return result.rows?.[0]?.spread ?? {};
}

// TODO?: materialized view that updates every few minutes?
export async function getEasiestBeatmapsWithoutPermaScore(client: ClientBase, rulesetId: RulesetId, positionThreshold: number) {
	const result = await queryWithTiming<BeatmapWithoutPermaScore>(
		client,
		"getEasiestBeatmapsWithoutPermaScore",
		"pog_api_v2",
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
	const result = await queryWithTiming<{ beatmaps: number }>(
		client,
		"getBeatmapCount",
		"pog_api_v2",
		`SELECT COUNT(id) AS beatmaps
		FROM ${DB_BEATMAPS_TABLE}
		WHERE ruleset_id = $1
			AND status = ANY($2::SMALLINT[])`,
		[rulesetId, statuses]
	);

	return result.rows[0]?.beatmaps ?? -1;
}
