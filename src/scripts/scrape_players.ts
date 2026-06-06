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
		const res = await fetch(buildUsersUrl(playerIds), { headers });
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

		const data = (await res.json()) as ApiUser[];
		fs.writeFileSync("../../data/users.json", JSON.stringify(data, null, 2));
		// RETURNS: {
		// {
		//   "users": [
		//     {
		//       "avatar_url": "https://a.ppy.sh/39828?1774829808.jpeg",
		//       "country_code": "PL",
		//       "default_group": "default",
		//       "id": 39828,
		//       "is_active": true,
		//       "is_bot": false,
		//       "is_deleted": false,
		//       "is_online": true,
		//       "is_supporter": true,
		//       "last_visit": "2026-06-06T20:37:51+00:00",
		//       "pm_friends_only": false,
		//       "profile_colour": null,
		//       "username": "WubWoofWolf",
		//       "country": {
		//         "code": "PL",
		//         "name": "Poland"
		//       },
		//       "cover": {
		//         "custom_url": "https://assets.ppy.sh/user-profile-covers/39828/9345cf14b2fb463278a18e234637eee12803f593dd7c7c5a18530ef557fadb28.jpeg",
		//         "url": "https://assets.ppy.sh/user-profile-covers/39828/9345cf14b2fb463278a18e234637eee12803f593dd7c7c5a18530ef557fadb28.jpeg",
		//         "id": null
		//       },
		//       "groups": [],
		//       "statistics_rulesets": {
		//         "osu": {
		//           "count_100": 4834599,
		//           "count_300": 91412583,
		//           "count_50": 862246,
		//           "count_miss": 1463590,
		//           "level": {
		//             "current": 113,
		//             "progress": 18
		//           },
		//           "global_rank": 1748,
		//           "global_rank_percent": 0.0005063047688232122,
		//           "global_rank_exp": null,
		//           "pp": 13067.5,
		//           "pp_exp": 0,
		//           "ranked_score": 512949059111,
		//           "hit_accuracy": 99.1086,
		//           "accuracy": 0.9910859999999999,
		//           "play_count": 395212,
		//           "play_time": 30829771,
		//           "total_score": 1345108213880,
		//           "total_hits": 97109428,
		//           "maximum_combo": 9289,
		//           "replays_watched_by_others": 8448246,
		//           "is_ranked": true,
		//           "grade_counts": {
		//             "ss": 153,
		//             "ssh": 63003,
		//             "s": 609,
		//             "sh": 11580,
		//             "a": 8288
		//           }
		//         },
		//         "taiko": {
		//           "count_100": 320252,
		//           "count_300": 4040052,
		//           "count_50": 0,
		//           "count_miss": 208633,
		//           "level": {
		//             "current": 83,
		//             "progress": 4
		//           },
		//           "global_rank": null,
		//           "global_rank_percent": null,
		//           "global_rank_exp": null,
		//           "pp": 0,
		//           "pp_exp": 0,
		//           "ranked_score": 2810364963,
		//           "hit_accuracy": 98.4018,
		//           "accuracy": 0.984018,
		//           "play_count": 10883,
		//           "play_time": 980629,
		//           "total_score": 3785110119,
		//           "total_hits": 4360304,
		//           "maximum_combo": 2556,
		//           "replays_watched_by_others": 6017,
		//           "is_ranked": false,
		//           "grade_counts": {
		//             "ss": 710,
		//             "ssh": 458,
		//             "s": 1438,
		//             "sh": 723,
		//             "a": 2834
		//           }
		//         },
		//         "fruits": {
		//           "count_100": 193101,
		//           "count_300": 2322903,
		//           "count_50": 1593258,
		//           "count_miss": 142823,
		//           "level": {
		//             "current": 97,
		//             "progress": 18
		//           },
		//           "global_rank": 3528,
		//           "global_rank_percent": 0.010026857654431513,
		//           "global_rank_exp": null,
		//           "pp": 4162.59,
		//           "pp_exp": 0,
		//           "ranked_score": 7901662849,
		//           "hit_accuracy": 99.6841,
		//           "accuracy": 0.996841,
		//           "play_count": 6842,
		//           "play_time": 515948,
		//           "total_score": 10068124115,
		//           "total_hits": 4109262,
		//           "maximum_combo": 1417,
		//           "replays_watched_by_others": 1276,
		//           "is_ranked": true,
		//           "grade_counts": {
		//             "ss": 39,
		//             "ssh": 415,
		//             "s": 230,
		//             "sh": 2015,
		//             "a": 903
		//           }
		//         },
		//         "mania": {
		//           "count_100": 178937,
		//           "count_300": 1964806,
		//           "count_50": 13669,
		//           "count_miss": 73693,
		//           "level": {
		//             "current": 81,
		//             "progress": 54
		//           },
		//           "global_rank": 160570,
		//           "global_rank_percent": 0.13608445931916244,
		//           "global_rank_exp": null,
		//           "pp": 1811.75,
		//           "pp_exp": 0,
		//           "ranked_score": 2990682138,
		//           "hit_accuracy": 97.4082,
		//           "accuracy": 0.9740819999999999,
		//           "play_count": 4910,
		//           "play_time": 401676,
		//           "total_score": 3582850541,
		//           "total_hits": 2157412,
		//           "maximum_combo": 2175,
		//           "replays_watched_by_others": 357,
		//           "is_ranked": true,
		//           "grade_counts": {
		//             "ss": 616,
		//             "ssh": 0,
		//             "s": 1704,
		//             "sh": 0,
		//             "a": 647
		//           }
		//         }
		//       },
		//       "team": {
		//         "flag_url": null,
		//         "id": 4488,
		//         "name": "Well Played",
		//         "short_name": "WP"
		//       }
		//     }
		//   ]
		// }
		// and no data for the restricted user
	} catch (error) {
		console.error("Error scraping players:", error);
	} finally {
		// await clients.end();
	}
}

main();
