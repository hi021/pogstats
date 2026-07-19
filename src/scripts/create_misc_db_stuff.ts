import { Client } from "pg";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from "../env.js";

const client = new Client({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME
});

async function createMiscellaneousDBFunctions() {
	console.log("Attempting to create miscellaneous DB functions");

	await client.query(`
		CREATE OR REPLACE FUNCTION calc_weighted_pp_sfunc(acc real, pp real, idx integer)
		RETURNS real
		LANGUAGE plpgsql
		AS $$
		DECLARE
				w real;
		BEGIN
				IF idx > 300 THEN
					RETURN acc;
				END IF;

				w := coalesce(pp, 0) * power(0.95, idx - 1);
				IF w < 1e-9 THEN
					RETURN acc;
				END IF;

				RETURN acc + w;
		END;
		$$;

		CREATE OR REPLACE AGGREGATE calc_weighted_pp(real, bigint) (
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
		await client.connect();
		await createMiscellaneousDBFunctions();
	} catch (error) {
		console.error("Error creating miscellaneous DB stuff:\n", error);
	} finally {
		await client.end();
	}
}

main();
