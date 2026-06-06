import { Client } from "pg";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from "./env.js";

let client: Client;

async function createMiscellaneousDBFunctions() {
	console.log(`Attempting to create miscellaneous DB functions`);

	await client.query(`
		create or replace function calc_weighted_pp_sfunc(acc real, pp real, idx bigint)
		returns real
		LANGUAGE plpgsql
		AS $$
			begin
				return acc + coalesce(pp, 0) * power(0.95, idx - 1);
			end;
		$$;

		create or replace aggregate calc_weighted_pp(real, bigint) (
			sfunc = calc_weighted_pp_sfunc,
			stype = real,
			initcond = 0
		);`);

	console.log(`Created miscellaneous DB functions`);
}

async function main() {
	client = new Client({
		host: DB_HOST,
		port: DB_PORT,
		user: DB_USER,
		password: DB_PASSWORD,
		database: DB_NAME
	});

	try {
		await client.connect();
		await createMiscellaneousDBFunctions();
	} catch (error) {
		console.error("Error creating miscellaneous DB stuff:", error);
	} finally {
		await client.end();
	}
}

main();
