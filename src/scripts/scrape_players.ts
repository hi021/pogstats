import fs from "fs";
import { Pool } from "pg";
import { getOAuthToken } from "./osu_auth.js";
import { buildHeadersWithAuth, buildUserLookupUrl, buildUsersUrl } from "./shared.js";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER, DEV_ENV } from "./env.js";

export const dbPool = new Pool({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME,
	min: 1,
	connectionTimeoutMillis: 20000,
	allowExitOnIdle: true
});

async function getRankingPlayerIdBatches() {
	// dbPool;
	return [39828, 23574301];
}

async function main() {
	try {
		const headers = buildHeadersWithAuth(await getOAuthToken());
		const playerIds = await getRankingPlayerIdBatches();
		const res = await fetch(buildUserLookupUrl(playerIds), { headers });
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

		const data = (await res.json()) as ApiUser[];
		fs.writeFileSync("../../data/users.json", JSON.stringify(data, null, 2));
	} catch (error) {
		console.error("Error scraping players:\n", error);
	} finally {
		// await clients.end();
	}
}

main();
