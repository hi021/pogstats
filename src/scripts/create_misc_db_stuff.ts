import { ClientBase } from "pg";
import { withDbClient } from "../db-generic.js";
import { DB_SCORES_TABLE } from "../env.js";

async function createMiscellaneousDBFunctions(client: ClientBase) {
	console.log("Attempting to create miscellaneous DB functions");

	// osu takes into top 1000 pp scores consideration, not just 250, but 0.1pp has never hurt anybody....
	await client.query(`
		CREATE OR REPLACE FUNCTION calc_weighted_pp_ordered_sfunc(state real[], pp real)
			RETURNS real[]
			LANGUAGE sql
			IMMUTABLE PARALLEL SAFE
			AS $$
				SELECT CASE 
					WHEN state[2] > 250 THEN state
					WHEN pp IS NOT NULL AND pp > 0 THEN ARRAY[state[1] + (pp * power(0.95, state[2] - 1)), state[2] + 1]
					ELSE state
				END;
		$$;
		CREATE OR REPLACE FUNCTION calc_weighted_pp_ordered_final(state real[])
			RETURNS real
			LANGUAGE sql
			IMMUTABLE PARALLEL SAFE
			AS $$
				SELECT state[1];
		$$;

		DROP AGGREGATE IF EXISTS calc_weighted_pp_ordered(real);

		CREATE AGGREGATE calc_weighted_pp_ordered(real) (
			SFUNC = calc_weighted_pp_ordered_sfunc,
			STYPE = real[],
			FINALFUNC = calc_weighted_pp_ordered_final,
			INITCOND = '{0,1}',
			PARALLEL = SAFE
		);

		CREATE OR REPLACE FUNCTION get_position_spread(
			p_user_id			INTEGER,
			p_ruleset_id 	SMALLINT
		)
		RETURNS jsonb
		LANGUAGE sql
		AS $$
			SELECT jsonb_agg(COALESCE(c.cnt, 0) ORDER BY g.i)
			FROM generate_series(1, 100) AS g(i)
			LEFT JOIN (
				SELECT position, COUNT(*) AS cnt
				FROM ${DB_SCORES_TABLE}
				WHERE user_id = p_user_id
					AND ruleset_id = p_ruleset_id
					AND position BETWEEN 1 AND 100
				GROUP BY position
			) AS c ON c.position = g.i;
		$$;
		
		CREATE EXTENSION if not exists pg_trgm;
		CREATE EXTENSION if not exists pg_cron;
		CREATE EXTENSION if not exists timescaledb;
		`);

	console.log("Created miscellaneous DB functions");
}

async function main() {
	try {
		await withDbClient(async client => await createMiscellaneousDBFunctions(client));
	} catch (error) {
		console.error("Error creating miscellaneous DB stuff:\n", error);
	}
}

main();
