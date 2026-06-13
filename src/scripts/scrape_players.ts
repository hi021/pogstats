import fs from "fs";
import { Pool } from "pg";
import { getOAuthToken } from "./osu_auth.js";
import { buildHeadersWithAuth, buildUsersUrl } from "./shared.js";

async function main() {
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
