import { withDbClient } from "../db-generic.js";
import { getBeatmapsetsCursor, saveBeatmapsetsCursor } from "../db.js";
import { getOAuthToken } from "../scripts/osu_auth.js";
import { buildBeatmapsetsEventsUrl, buildHeadersWithAuth } from "../scripts/shared.js";

type BeatmapsetsFetchEventType =
| BeatmapsetsFetchListenerEventType
| "nominate"
| "qualify"
| "disqualify"
| "kudosu_allow"
| "kudosu_deny"
| "kudosu_gain"
| "kudosu_lost"
| "kudosu_recalculate"
| "issue_resolve"
| "issue_reopen"
| "discussion_lock"
| "discussion_unlock"
| "discussion_delete"
| "discussion_restore"
| "discussion_post_delete"
| "discussion_post_restore"
| "nomination_reset"
| "nomination_reset_received"
| "nsfw_toggle"
| "offset_edit";

type BeatmapsetsFetchListenerEventType =
"love" | "remove_from_loved" | "approve" | "rank" | "genre_edit" | "language_edit" | "tags_edit" | "beatmap_owner_change";

const LISTENER_EVENT_TYPES: BeatmapsetsFetchListenerEventType[] = [
  "love",
	"remove_from_loved",
	"approve",
	"rank",
	"genre_edit",
	"language_edit",
	"tags_edit",
	"beatmap_owner_change"
];

const BEATMAPSETS_ENDPOINT_FETCH_INTERVAL = 23000;
const BEATMAPSETS_ENDPOINT_INITIAL_FETCH_INTERVAL = 0;
let beatmapsetsFetchTimeout: NodeJS.Timeout;
let osuOAuthToken = "";

export async function initializeBeatmapsetsFetch(cursorStringCli?: string) {
	clearTimeout(beatmapsetsFetchTimeout);
	osuOAuthToken = await getOAuthToken();

	const cursorString = cursorStringCli || (await getBeatmapsetsCursor("beatmapsets_fetch"));
	beatmapsetsFetchTimeout = setTimeout(() => fetchBeatmapsetsBatch(cursorString), BEATMAPSETS_ENDPOINT_INITIAL_FETCH_INTERVAL);
}

async function fetchBeatmapsetsBatch(cursorString?: string) {
	try {
		const response = await fetch(buildBeatmapsetsEventsUrl(cursorString), {
			headers: buildHeadersWithAuth(osuOAuthToken)
		});
		if (!response.ok) throw new Error(`failed to fetch beatmapset events: ${response.status} ${response.statusText}`);

		const responseJson = await response.json();
    // TODO: type in types.d.ts based on /data/responses/osu_api_beatmapsets_event.txt
		const nextCursorString = responseJson.id; // TODO: get first (latest, highest) event's id 
		listenToBeatmapsetsEvents(responseJson.events);
    
		await withDbClient(client => saveBeatmapsetsCursor(client, nextCursorString, "beatmapsets_fetch"));
		beatmapsetsFetchTimeout = setTimeout(() => fetchBeatmapsetsBatch(nextCursorString), BEATMAPSETS_ENDPOINT_FETCH_INTERVAL);
	} catch (e) {
    console.error("failed to fetch/parse beatmapset events:\n", e);
		beatmapsetsFetchTimeout = setTimeout(() => fetchBeatmapsetsBatch(cursorString), BEATMAPSETS_ENDPOINT_FETCH_INTERVAL);
	}
}

function listenToBeatmapsetsEvents(events: any[]) {
  const relevantEvents= events?.filter(event => LISTENER_EVENT_TYPES.includes(event.type as BeatmapsetsFetchListenerEventType)) ?? [];
  console.log(JSON.stringify(relevantEvents, undefined, 2)); // TODO: debug only
}
