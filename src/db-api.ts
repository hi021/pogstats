import { ClientBase } from "pg";
import { cachePlayer, getCachedPlayerId, getCachedPlayerUsername } from "./cache.js";
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

export async function getPlayerIdByLowercaseName(client: ClientBase, name: string) {
	const cachedPlayerId = await getCachedPlayerId(name);
	if (cachedPlayerId) return cachedPlayerId;

	const result = await client.query<{ id: number }>(`SELECT id FROM ${DB_PLAYERS_TABLE} WHERE LOWER(username) = $1`, [name]);

	const playerId = result?.rows?.[0]?.id as number | undefined;
	if (playerId) await cachePlayer(playerId, name);
	return playerId;
}

// validates if id is a real number and the player exists in the database
export async function getPlayerIdById(client: ClientBase, id: string | number) {
	try {
		const cachedUsername = await getCachedPlayerUsername(id);
		if (cachedUsername) return Number(id);

		const result = await client.query<{ id: number; username: string }>(
			`SELECT id, LOWER(username) AS username FROM ${DB_PLAYERS_TABLE} WHERE id = $1`,
			[id]
		);

		const playerId = result?.rows?.[0]?.id ?? null;
		if (playerId) await cachePlayer(playerId, result.rows[0].username);
		return playerId;
	} catch (e) {
		return null; // assume the id wasn't a valid number
	}
}

// TODO: move to redis (but later, skip for now)
export async function getRankingId(client: ClientBase, rulesetId: RulesetId, code: string) {}

// TODO: better typing (maybe based on the full parameter too)
export async function getPlayerInfo(client: ClientBase, playerId: number, full = true) {
	const result = await queryWithTiming<Player>(
		client,
		"getPlayerInfo",
		"pog_api_v2",
		`SELECT
			p.id,
			p.username,
			p.country_code
			${full ? ", p.is_active, p.team_id, p.cover_url" : ""}
		FROM ${DB_PLAYERS_TABLE} p
		WHERE p.id = $1`,
		[playerId]
	);

	return result.rows?.[0];
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
	positionThreshold = 100
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
	positionThreshold = 100
) {
	// this could benefit from storing extracted mod arrays as a separate indexed column in scores table
	const result = await queryWithTiming<{ spread: PlayerModSpread }>(
		client,
		"getModSpreadForPlayer",
		"pog_api_v2",
		`WITH base AS (
		    SELECT
		        ARRAY(
		            SELECT DISTINCT CASE m->>'acronym'
		                WHEN 'NC' THEN 'DT'
		                WHEN 'DC' THEN 'HT'
		                WHEN 'DT' THEN 'DT'
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
		            END AS acronym
		            FROM jsonb_array_elements(s.data->'mods') AS m
		            WHERE m->>'acronym' IN ('NC', 'DC', 'DT', 'HT', 'BL', 'FL', 'HR', 'HD', 'TC', 'EZ', 'RX', 'AP', 'TD')
		            ORDER BY acronym
		        ) AS mods_arr
		    FROM ${DB_SCORES_TABLE} s
		    WHERE s.user_id = $1
		      AND s.ruleset_id = $2
		      AND s.position BETWEEN 1 AND $3
		),
		expanded AS (
		    SELECT
		        CASE
		            WHEN cardinality(v.mod_var) = 0 THEN 'NM'
		            ELSE array_to_string(v.mod_var, ',')
		        END AS variant_key
		    FROM base b
		    CROSS JOIN LATERAL (
		        SELECT b.mods_arr AS mod_var
		        UNION ALL
		        SELECT array_remove(b.mods_arr, 'HD')
		        WHERE 'HD' = ANY(b.mods_arr)
		        UNION ALL
		        SELECT array_remove(b.mods_arr, 'TC')
		        WHERE 'TC' = ANY(b.mods_arr)
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

// TODO?: materialized view that updates every ~30 minutes?
export async function getEasiestBeatmapsWithoutPermaScore(
	client: ClientBase,
	rulesetId: RulesetId,
	positionThreshold: number,
	page = 1
) {
	const PAGE_SIZE = 100;
	const safePage = Number.isInteger(page) && page > 0 ? page : 1;
	const offset = (safePage - 1) * PAGE_SIZE;

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
			AND s.position <= $2
			LIMIT $3 OFFSET $4`,
		[rulesetId, positionThreshold, PAGE_SIZE, offset]
	);

	return result.rows;
}

export async function getBeatmapCount(client: ClientBase, rulesetId: RulesetId, statuses: readonly BeatmapStatusId[]) {
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

export async function getBeatmapsByFilters(client: ClientBase, filters: Partial<BeatmapFilterQuery>, page = 1) {
	const PAGE_SIZE = 48;
	const safePage = Number.isInteger(page) && page > 0 ? page : 1;
	const offset = (safePage - 1) * PAGE_SIZE;

	const whereClauses: string[] = [];
	const values: unknown[] = [];

	let paramIndex = 1;
	for (const [key, value] of Object.entries(filters)) {
		if (key == "status") {
			whereClauses.push(`status = ANY($${paramIndex++}::SMALLINT[])`);
			values.push(value as BeatmapStatusId[]);
		} else if (key == "ruleset") {
			whereClauses.push(`ruleset_id = $${paramIndex++}`);
			values.push(value as RulesetId);
		} else if (["artist", "title", "creator", "version"].includes(key)) {
			// TODO: Rank by pg_trgm similarity()
			whereClauses.push(`${key} ILIKE $${paramIndex++}`);
			values.push(`%${value}%`);
		} else if (["approved_date", "star_rating", "total_length", "bpm", "cs", "od", "ar", "hp"].includes(key)) {
			const [min, max] = value as [number | Date | null, number | Date | null];

			if (min != null) {
				whereClauses.push(`${key} >= $${paramIndex++}`);
				values.push(min);
			}
			if (max != null) {
				whereClauses.push(`${key} <= $${paramIndex++}`);
				values.push(max);
			}
		}
	}

	const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

	const result = await queryWithTiming<Beatmap>(
		client,
		"getBeatmapsByFilters",
		"pog_api_v2",
		`SELECT *
		FROM ${DB_BEATMAPS_TABLE}
		${whereClause}
		LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
		[...values, PAGE_SIZE, offset]
	);

	return result.rows;
}
