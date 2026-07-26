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

		CREATE OR REPLACE FUNCTION calculate_weighted_count(
			p_user_id     INTEGER,
			p_ruleset_id  SMALLINT
		)
		RETURNS numeric
		LANGUAGE plpgsql
		AS $$
		DECLARE
			spread integer[];
			weights numeric[] := ARRAY[1,0.99159000,0.98250416,0.97270314,0.96214865,0.95080362,0.93863287,0.92560391,0.91168780,0.89686005,0.88110161,0.86439989,0.84674974,0.82815445,0.80862663,0.78818899,0.76687497,0.74472917,0.72180751,0.69817709,0.67391582,0.64911162,0.62386136,0.59826954,0.57244658,0.54650700,0.52056742,0.49474446,0.46915264,0.44390238,0.41909818,0.39483691,0.37120649,0.34828483,0.32613903,0.30482501,0.28438737,0.26485955,0.24626426,0.22861411,0.21191239,0.19615395,0.18132620,0.16741009,0.15438113,0.14221038,0.13086535,0.12031086,0.11050984,0.10142400,0.09301445,0.08524223,0.07806876,0.07145615,0.06536758,0.05976745,0.05462158,0.04989737,0.04556382,0.04159164,0.03795319,0.03462256,0.03157546,0.02878925,0.02624280,0.02391654,0.02179226,0.01985317,0.01808370,0.01646952,0.01499742,0.01365523,0.01243177,0.01131678,0.01030084,0.00937531,0.00853229,0.00776452,0.00706540,0.00642885,0.00584934,0.00532181,0.00484165,0.00440463,0.00400692,0.00364499,0.00331566,0.00301600,0.00274335,0.00249530,0.00226963,0.00206433,0.00187756,0.00170767,0.00155313,0.00141256,0.00128469,0.00116839,0.00106260,0.00096639];
			result numeric := 0;
		BEGIN
			SELECT array_agg((elem)::integer ORDER BY ord)
			INTO spread
			FROM jsonb_array_elements(get_position_spread(p_user_id, p_ruleset_id)) WITH ORDINALITY AS t(elem, ord);

			FOR i IN 1..100 LOOP
				result := result + spread[i] * weights[i];
			END LOOP;

			RETURN result;
		END;
		$$;
		
		CREATE EXTENSION if not exists pg_trgm;
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
