import { ClientBase, QueryResult } from "pg";
import {
	BEATMAP_RULESET_UPDATE_DATES_TABLE_COLUMNS,
	BEATMAP_TABLE_COLUMNS,
	BEATMAP_TABLE_COLUMNS_ALL,
	buildUpdateAssignmentsString,
	HISTORICAL_PLAYER_SNIPES_TABLE_COLUMNS,
	withDbClient
} from "./db-generic.js";
import {
	DB_BEATMAP_RULESET_UPDATE_DATES_TABLE,
	DB_BEATMAPS_TABLE,
	DB_CONFIG_TABLE,
	DB_HISTORICAL_PLAYER_SNIPES_TABLE,
	DB_PLAYER_MIA_HISTORY_TABLE,
	DB_PLAYERS_TABLE,
	DB_SCORES_TABLE,
	VERBOSE
} from "./env.js";
import { queryWithTiming, recordMissingEntity } from "./metrics.js";
import { preparePlayerSnipesTableValuesAndParamPlaceholders, unnestObjectsIntoArrays } from "./shared.js";
import { scrapeBeatmaps } from "./scripts/scrape_beatmaps.js";
import { scrapePlayers } from "./scripts/scrape_players.js";

export function buildBeatmapAdvisoryLockKey(beatmapId: number, rulesetId: number) {
	return (BigInt(beatmapId) << 32n) | BigInt(rulesetId);
}

export async function acquireBeatmapAdvisoryLock(
	client: ClientBase,
	beatmapId: number,
	rulesetId: number,
	source: ActionSource = "unknown"
) {
	const lockKey = buildBeatmapAdvisoryLockKey(beatmapId, rulesetId);
	await queryWithTiming(client, "acquireBeatmapAdvisoryLock", source, "SELECT pg_advisory_xact_lock($1)", [lockKey]);
}

// Saving the lowest score id from given batch just to be safe for now - probably unnecessary, as the ids seem to be ordered
export async function saveLastScoreId(scoreId: number, source: ActionSource = "unknown") {
	if (isNaN(scoreId) || !isFinite(scoreId)) return;
	await withDbClient(client =>
		queryWithTiming(
			client,
			"saveLastScoreId",
			source,
			`UPDATE ${DB_CONFIG_TABLE} SET value_text = '${scoreId}' WHERE key = 'last_ws_score_id'`
		)
	);
}

export async function getLastScoreId(source: ActionSource = "unknown") {
	const result = await withDbClient<QueryResult<ConfigEntry>>(client =>
		queryWithTiming(
			client,
			"getLastScoreId",
			source,
			`SELECT value_text FROM ${DB_CONFIG_TABLE} WHERE key = 'last_ws_score_id'`
		)
	);
	return Number(result.rows?.[0]?.value_text || 0);
}

export async function updateBeatmapScoresRetrievalDate(
	client: ClientBase,
	beatmapId: number,
	rulesetId: number,
	column: "last_scores_scrape" | "last_scores_update" = "last_scores_update",
	source: ActionSource = "unknown"
) {
	await queryWithTiming(
		client,
		"updateBeatmapScoresRetrievalDate",
		source,
		`
		INSERT INTO ${DB_BEATMAP_RULESET_UPDATE_DATES_TABLE} (${BEATMAP_RULESET_UPDATE_DATES_TABLE_COLUMNS.slice(0, 2).join(", ")}, ${column})
		VALUES ($1, $2, NOW())
		ON CONFLICT (beatmap_id, ruleset_id) DO UPDATE SET ${column} = EXCLUDED.${column}`,
		[beatmapId, rulesetId]
	);
}

export async function getInexistentPlayerIds(client: ClientBase, playerIds: number[], source: ActionSource = "unknown") {
	return (
		await queryWithTiming(
			client,
			"getInexistentPlayerIds",
			source,
			`WITH input_ids AS (SELECT DISTINCT unnest($1::integer[]) AS id)
			SELECT i.id FROM input_ids i
			LEFT JOIN ${DB_PLAYERS_TABLE} u ON u.id = i.id
			WHERE u.id IS NULL`,
			[playerIds]
		)
	).rows.map(r => r.id) as number[];
}

export async function getInexistentBeatmapIds(client: ClientBase, beatmapIds: number[], source: ActionSource = "unknown") {
	return (
		await queryWithTiming(
			client,
			"getInexistentBeatmapIds",
			source,
			`WITH input_ids AS (SELECT DISTINCT unnest($1::bigint[]) AS id)
			 SELECT i.id FROM input_ids i
				LEFT JOIN ${DB_BEATMAPS_TABLE} b ON b.id = i.id
			 WHERE b.id IS NULL`,
			[beatmapIds]
		)
	).rows.map(r => r.id) as number[];
}

export async function fetchNewBeatmaps(
	client: ClientBase,
	beatmapIds: number[],
	callback?: () => void,
	source: ActionSource = "unknown"
) {
	try {
		const missingIds = await getInexistentBeatmapIds(client, beatmapIds, source);
		if (missingIds?.length) {
			if (VERBOSE) console.log(`Found ${missingIds.length} new beatmap id(s) not in the database`);
			recordMissingEntity("beatmap", missingIds.length);
			await scrapeBeatmaps(missingIds);
		}

		callback?.();
	} catch (e) {
		console.error(`[${source}] failed to fetch missing beatmaps:\n`, e);
	}
}

export async function fetchNewPlayers(
	client: ClientBase,
	playerIds: number[],
	callback?: () => void,
	source: ActionSource = "unknown"
) {
	try {
		const missingIds = await getInexistentPlayerIds(client, playerIds, source);
		if (missingIds?.length) {
			if (VERBOSE) console.log(`Found ${missingIds.length} new player id(s) not in the database`);
			recordMissingEntity("player", missingIds.length);
			await scrapePlayers(missingIds);
		}

		callback?.();
	} catch (e) {
		console.error(`[${source}] failed to fetch missing players:\n`, e);
	}
}

export async function insertHistoricalPlayerSnipes(
	client: ClientBase,
	snipes: HistoricalPlayerSnipes[],
	source: ActionSource = "unknown"
) {
	if (!snipes?.length) return;

	const { values, paramGroups } = preparePlayerSnipesTableValuesAndParamPlaceholders(snipes);
	await queryWithTiming(
		client,
		"insertHistoricalPlayerSnipes",
		source,
		`INSERT INTO ${DB_HISTORICAL_PLAYER_SNIPES_TABLE} (${HISTORICAL_PLAYER_SNIPES_TABLE_COLUMNS.join(",")})
		 VALUES ${paramGroups.join(", ")}`,
		values
	);
}

export async function recalculateScorePositionsForMaps(
	client: ClientBase,
	beatmaps: BeatmapRuleset[],
	source: ActionSource = "unknown"
) {
	const ids = unnestObjectsIntoArrays(beatmaps);
	return recalculateScorePositionsForMapIds(client, ids.beatmap_id, ids.ruleset_id, source);
}

export async function recalculateScorePositionsForMapIds(
	client: ClientBase,
	beatmapIds: number[],
	rulesetIds: RulesetId[],
	source: ActionSource = "unknown"
) {
	if (!beatmapIds?.length || !rulesetIds?.length) return;

	await queryWithTiming(
		client,
		"recalculateScorePositionsForMapIds",
		source,
		`
   	WITH input_raw AS (
      SELECT
        UNNEST($1::int[]) AS beatmap_id,
        UNNEST($2::int[]) AS ruleset_id
    ),
    input AS (
      SELECT beatmap_id, ruleset_id
      FROM input_raw
      GROUP BY beatmap_id, ruleset_id
    ),
    ranked AS (
      SELECT
        s.id,
        ROW_NUMBER() OVER (
          PARTITION BY s.beatmap_id, s.ruleset_id
          ORDER BY s.total_score DESC, s.ended_at ASC, s.id ASC
        ) AS pos
      FROM ${DB_SCORES_TABLE} s
      JOIN input i
        ON s.beatmap_id = i.beatmap_id
       AND s.ruleset_id = i.ruleset_id
      WHERE s.position > 0
    )
    UPDATE ${DB_SCORES_TABLE} AS s
    SET position = ranked.pos
    FROM ranked
    WHERE s.id = ranked.id`,
		[beatmapIds, rulesetIds]
	);
}

export async function getBeatmapIdsWithPlayerScores(client: ClientBase, playerIds: number[], source: ActionSource = "unknown") {
	const beatmaps = await queryWithTiming<BeatmapRuleset>(
		client,
		"getBeatmapIdsWithPlayerScores",
		source,
		`
			SELECT beatmap_id, ruleset_id FROM ${DB_SCORES_TABLE}
			WHERE user_id = ANY($1::INTEGER[])`,
		[playerIds]
	);
	return beatmaps.rows;
}

export async function setAllPlayerScoresPosition(
	client: ClientBase,
	playerIds: number[],
	position = 0,
	source: ActionSource = "unknown"
) {
	if (!playerIds?.length) return [];

	const result = await queryWithTiming<BeatmapRuleset>(
		client,
		"setAllPlayerScoresPosition",
		source,
		`
		UPDATE ${DB_SCORES_TABLE} s
			SET position = $1
		WHERE s.user_id = ANY($2::INTEGER[])
		RETURNING s.beatmap_id, s.ruleset_id`,
		[position, playerIds]
	);
	return result.rows;
}

export async function findNoLongerMiaPlayerIds(client: ClientBase, source: ActionSource = "unknown") {
	const result = await queryWithTiming<{ id: number }>(
		client,
		"findNoLongerMiaPlayerIds",
		source,
		`
		SELECT p.id FROM ${DB_PLAYERS_TABLE} p
			JOIN ${DB_PLAYER_MIA_HISTORY_TABLE} h ON h.user_id = p.id AND h.end_date IS NULL
		WHERE p.is_mia = false`
	);

	return result.rows.map(row => row.id);
}

export async function insertNewMiaPlayers(client: ClientBase, miaPlayers: Map<number, Date>, source: ActionSource = "unknown") {
	if (!miaPlayers?.size) return;

	const paramGroups = [];
	const values = [];
	let i = 0;

	for (const [userId, startDate] of miaPlayers) {
		paramGroups.push(`($${++i}::INTEGER, $${++i}::TIMESTAMPTZ)`);
		values.push(userId, startDate);
	}

	await queryWithTiming(
		client,
		"insertNewMiaPlayers",
		source,
		`
		WITH input(user_id, start_date) AS (
      VALUES ${paramGroups.join(",")}
    )
    INSERT INTO ${DB_PLAYER_MIA_HISTORY_TABLE} (user_id, start_date)
    SELECT i.user_id, i.start_date
    FROM input i
    WHERE NOT EXISTS (
      SELECT 1
      FROM ${DB_PLAYER_MIA_HISTORY_TABLE} h
      WHERE h.user_id = i.user_id
        AND h.end_date IS NULL
    )`,
		values
	);
}

export async function insertNoLongerMiaPlayers(client: ClientBase, miaPlayerIds: number[], source: ActionSource = "unknown") {
	if (!miaPlayerIds?.length) return;

	await queryWithTiming(
		client,
		"insertNoLongerMiaPlayers",
		source,
		`
    UPDATE ${DB_PLAYER_MIA_HISTORY_TABLE} h
    	SET end_date = NOW()
    WHERE h.user_id = ANY($1::INTEGER[])
      AND h.end_date IS NULL`,
		[miaPlayerIds]
	);
}

export async function upsertBeatmapBatch(
	client: ClientBase,
	batch: Beatmap[],
	table: string,
	source: ActionSource = "unknown"
) {
	const arrays = unnestObjectsIntoArrays(batch as unknown as Array<Record<string, unknown>>) as {
		[K in keyof Beatmap]: Array<Beatmap[K]>;
	};

	await queryWithTiming(
		client,
		"upsertBeatmapBatch",
		source,
		`
		INSERT INTO ${table} (${BEATMAP_TABLE_COLUMNS_ALL.join(", ")})
		SELECT *
		FROM UNNEST(
			$1::INTEGER[],
			$2::INTEGER[],
			$3::SMALLINT[],
			$4::TEXT[],
			$5::TEXT[],
			$6::TEXT[],
			$7::TEXT[],
			$8::INTEGER[],
			$9::SMALLINT[],
			$10::TIMESTAMPTZ[],
			$11::REAL[],
			$12::SMALLINT[],
			$13::REAL[],
			$14::REAL[],
			$15::REAL[],
			$16::REAL[],
			$17::REAL[],
			$18::TEXT[],
			$19::TIMESTAMPTZ[]
		) ON CONFLICT (id) DO UPDATE SET ${buildUpdateAssignmentsString(BEATMAP_TABLE_COLUMNS)}`,
		[
			arrays.id,
			arrays.beatmapsetId,
			arrays.status,
			arrays.artist,
			arrays.title,
			arrays.version,
			arrays.creator,
			arrays.creatorId,
			arrays.rulesetId,
			arrays.approvedDate,
			arrays.starRating,
			arrays.totalLength,
			arrays.bpm,
			arrays.cs,
			arrays.od,
			arrays.ar,
			arrays.hp,
			arrays.packs,
			arrays.updatedAt
		]
	);
}
