import { ClientBase } from "pg";
import { withDbClient } from "../db-generic.js";
import { DB_PLAYERS_TABLE, DB_RANKING_TYPES_TABLE, DB_SCORES_TABLE } from "../env.js";
import { parsePositionThresholdAndRankingType } from "../shared.js";
import { assert } from "node:console";

const RANKING_PLAYER_LIMIT = 10000;

type QueryBuilder = (viewName: string, rulesetId: RulesetId, positionThreshold: RankingPositionThreshold) => string;

async function createRankingView(
	client: ClientBase,
	code: string,
	rulesetId: RulesetId,
	positionThreshold: RankingPositionThreshold,
	queryBuilder: QueryBuilder
) {
	const viewName = `${code}_${rulesetId}_${positionThreshold}`;
	console.log(`Creating or replacing ranking view '${viewName}'`);
	await client.query(queryBuilder(viewName, rulesetId, positionThreshold));
	console.log(`Created or replaced ranking view '${viewName}'`);
}

const countRankingBuilder: QueryBuilder = (
	viewName: string,
	rulesetId: RulesetId,
	positionThreshold: RankingPositionThreshold
) =>
	`CREATE OR REPLACE VIEW ${viewName} AS
  SELECT row_number() OVER (ORDER BY COUNT(s.id) DESC, p.id ASC) AS "position",
        p.id AS user_id,
        p.username,
        p.country_code,
        COUNT(s.id) FILTER (WHERE s.ruleset_id = ${rulesetId} AND s."position" >= 1 AND s."position" <= ${positionThreshold}) AS value,
        COUNT(s.id) FILTER (WHERE s.ruleset_id = ${rulesetId} AND s.is_perma = true AND s."position" >= 1 AND s."position" <= ${positionThreshold}) AS value_perma
  FROM ${DB_SCORES_TABLE} s
    JOIN ${DB_PLAYERS_TABLE} p ON p.id = s.user_id AND p.is_mia = false
  GROUP BY p.id, p.username, p.country_code
  LIMIT ${RANKING_PLAYER_LIMIT}`;

async function getRankingTypes(client: ClientBase) {
	const res = await client.query<RankingType>(`SELECT * FROM ${DB_RANKING_TYPES_TABLE}`);
	return res.rows;
}

async function createRankingViews() {
	await withDbClient(async client => {
		const rankingTypes = await getRankingTypes(client);
		if (!rankingTypes?.length) throw new Error("No ranking types to create views for found");

		for (const type of rankingTypes) {
			const parsedRanking = parsePositionThresholdAndRankingType(type.code);
			if (!parsedRanking) throw new Error(`Could not parse ranking type with the code '${type.code}'`);
			assert(type.position_threshold == parsedRanking.positionThreshold);

			switch (parsedRanking.rankingType) {
				case "":
					await createRankingView(client, type.code, type.ruleset_id, type.position_threshold, countRankingBuilder);
					break;
				case "-weighted":
					console.log("pp");
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
				default:
					console.warn(`Unknown ranking type with code '${type.code}'`);
			}
		}
	});
}

createRankingViews();
