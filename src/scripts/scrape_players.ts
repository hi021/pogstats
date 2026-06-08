import { Pool } from "pg";
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from "./env.js";
import { getOAuthToken } from "./osu_auth.js";
import fs from "fs";
import { buildHeadersWithAuth, buildUsersUrl } from "./shared.js";

let clients: Pool;

async function main() {
	// clients = new Pool({
	//   host: DB_HOST,
	//   port: DB_PORT,
	//   user: DB_USER,
	//   password: DB_PASSWORD,
	//   database: DB_NAME
	// });

	try {
		const headers = buildHeadersWithAuth(await getOAuthToken());
		const playerIds = [39828, 23574301];
		// example result for 39828, 23574301 found in users_endpoint_result.json
		const res = await fetch(buildUsersUrl(playerIds), { headers });
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

		const data = (await res.json()) as ApiUser[];
		fs.writeFileSync("../../data/users.json", JSON.stringify(data, null, 2));
	} catch (error) {
		console.error("Error scraping players:", error);
	} finally {
		// await clients.end();
	}
}

main();
