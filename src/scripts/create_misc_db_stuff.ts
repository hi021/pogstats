import { ClientBase } from "pg";
import { withDbClient } from "../db-generic.js";

async function createMiscellaneousDBFunctions(client: ClientBase) {
	console.log("Attempting to create miscellaneous DB functions");

	// osu takes into top 1000 pp scores consideration, not just 250, but 0.1pp has never hurt anybody
	await client.query(`
		CREATE OR REPLACE FUNCTION calc_weighted_pp_sfunc(acc real, pp real, idx integer)
		RETURNS real
		LANGUAGE plpgsql
		AS $$
		DECLARE
				w real;
		BEGIN
				IF idx > 250 THEN
					RETURN acc;
				END IF;

				w := coalesce(pp, 0) * power(0.95, idx - 1);
				IF w < 1e-9 THEN
					RETURN acc;
				END IF;

				RETURN acc + w;
		END;
		$$;

		CREATE OR REPLACE AGGREGATE calc_weighted_pp(real, integer) (
			sfunc = calc_weighted_pp_sfunc,
			stype = real,
			initcond = 0
		);
		
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
