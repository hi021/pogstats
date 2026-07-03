import fs from "fs";
import { Pool } from "pg";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from "./env.js";
import { getOAuthToken } from "./osu_auth.js";
import { buildHeadersWithAuth, buildUserLookupUrl, convertApiPlayerLookup } from "./shared.js";

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
	// dbPool
	return [39828, 23574301];
}

async function main() {
	try {
		const headers = buildHeadersWithAuth(await getOAuthToken());
		const playerIds = await getRankingPlayerIdBatches();
		const res = await fetch(buildUserLookupUrl(playerIds), { headers });
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

		const players = (await res.json()) as ApiUserLookup[];
		const convertedPlayers = new Array<Player>(players.length);
		for (let i = 0; i < players.length; ++i) convertedPlayers[i] = convertApiPlayerLookup(players[i]);

		fs.writeFileSync("../../data/users_lookup.json", JSON.stringify(convertedPlayers, null, 2));
	} catch (e) {
		console.error("Error scraping players:\n", e);
	} finally {
		await dbPool.end();
	}
}

main();
