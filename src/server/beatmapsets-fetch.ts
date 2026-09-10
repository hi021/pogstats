import { withDbClient } from "../db-generic.js";
import { getBeatmapsetsCursor, saveBeatmapsetsCursor } from "../db.js";
import { getOAuthToken } from "../scripts/osu_auth.js";
import { buildBeatmapsetsEventsUrl, buildHeadersWithAuth } from "../scripts/shared.js";

const STATUS_CHANGE_TYPES: readonly BeatmapsetsFetchStatusChangeEventType[] = Object.freeze([
	"love",
	"remove_from_loved",
	"approve",
	"rank"
] as const);

const METADATA_CHANGE_TYPES: readonly BeatmapsetsFetchMetadataChangeEventType[] = Object.freeze([
	"genre_edit",
	"language_edit",
	"tags_edit",
	"beatmap_owner_change"
] as const);

const KNOWN_EVENT_TYPES: readonly BeatmapsetsFetchEventType[] = Object.freeze([
	...STATUS_CHANGE_TYPES,
	...METADATA_CHANGE_TYPES,
	"nominate",
	"qualify",
	"disqualify",
	"kudosu_allow",
	"kudosu_deny",
	"kudosu_gain",
	"kudosu_lost",
	"kudosu_recalculate",
	"issue_resolve",
	"issue_reopen",
	"discussion_lock",
	"discussion_unlock",
	"discussion_delete",
	"discussion_restore",
	"discussion_post_delete",
	"discussion_post_restore",
	"nomination_reset",
	"nomination_reset_received",
	"nsfw_toggle",
	"offset_edit"
] as const);

const RANKED_STATUSES: readonly BeatmapStatus[] = Object.freeze(["ranked", "approved", "loved"] as const);

const BEATMAPSETS_ENDPOINT_FETCH_INTERVAL = 23000;
const BEATMAPSETS_ENDPOINT_INITIAL_FETCH_INTERVAL = 0;
const OSU_OAUTH_TOKEN_REFRESH_INTERVAL = 22 * 60 * 60 * 1000;
const OSU_OAUTH_TOKEN_PANIC_REFRESH_INTERVAL = 60000;
let sessionBatchCount = 0;
let beatmapsetsFetchTimeout: NodeJS.Timeout;
let osuOAuthToken = "";
let tokenRefreshTimeout: NodeJS.Timeout;

export function abortBeatmapsetsFetch() {
	clearTimeout(beatmapsetsFetchTimeout);
	clearTimeout(tokenRefreshTimeout);
}

export async function initializeBeatmapsetsFetch(cursorStringCli?: string) {
	sessionBatchCount = 0;
	clearTimeout(beatmapsetsFetchTimeout);
	clearTimeout(tokenRefreshTimeout);
	await refreshOAuthToken();

	const cursorString = cursorStringCli || (await getBeatmapsetsCursor("beatmapsets_fetch"));
	beatmapsetsFetchTimeout = setTimeout(() => {
		console.log(`connecting to beatmapsets endpoint with cursor: ${cursorString}`); // TODO: cursor does not seem to be doing anything
		fetchBeatmapsetsBatch(cursorString);
	}, BEATMAPSETS_ENDPOINT_INITIAL_FETCH_INTERVAL);
}

async function fetchBeatmapsetsBatch(cursorString?: string) {
	try {
		console.log(`sending to url ${buildBeatmapsetsEventsUrl(cursorString).toString()}`);
		const response = await fetch(buildBeatmapsetsEventsUrl(cursorString), {
			headers: buildHeadersWithAuth(osuOAuthToken)
		});
		if (!response.ok) throw new Error(`failed to fetch beatmapset events: ${response.status} ${response.statusText}`);

		const responseJson: ApiBeatmapsetsFetchResponse = await response.json();
		const events = filterEvents(responseJson.events);
		logInfo(`${responseJson.events?.length} beatmapset events | ${events.length} relevant`);

		console.log("__\n" + responseJson.events?.map((e: any) => e.id).join("\n")); // TODO: debug only
		const nextCursorString = responseJson.events?.[0]?.id?.toString() || cursorString;
		if (events.length) {
			console.log(JSON.stringify(events, undefined, 2)); // TODO: debug only
			processEvents(events);
		}

		if (nextCursorString && nextCursorString != cursorString)
			await withDbClient(client => saveBeatmapsetsCursor(client, nextCursorString, "beatmapsets_fetch"));
		beatmapsetsFetchTimeout = setTimeout(() => fetchBeatmapsetsBatch(nextCursorString), BEATMAPSETS_ENDPOINT_FETCH_INTERVAL);
		++sessionBatchCount;
	} catch (e) {
		logError("failed to fetch/parse beatmapset events:\n", e);
		beatmapsetsFetchTimeout = setTimeout(() => fetchBeatmapsetsBatch(cursorString), BEATMAPSETS_ENDPOINT_FETCH_INTERVAL);
	}
}

// TODO: check the "types" search param, maybe can filter out some events on the osu!api side instead of doing it here
function filterEvents(events: BeatmapsetsFetchEvent[]) {
	const relevantEvents = [];
	for (const event of events ?? []) {
		if (!KNOWN_EVENT_TYPES.includes(event.type as BeatmapsetsFetchEventType)) {
			logInfo(`skipping unknown event type '${event.type}': ${JSON.stringify(event, undefined, 2)}`);
			continue;
		}

		if (
			STATUS_CHANGE_TYPES.includes(event.type as BeatmapsetsFetchStatusChangeEventType) ||
			(METADATA_CHANGE_TYPES.includes(event.type as BeatmapsetsFetchMetadataChangeEventType) &&
				RANKED_STATUSES.includes(event.beatmapset.status as BeatmapStatus))
		)
			relevantEvents.push(event);

		if (event.type == "disqualify")
			logInfo(
				`disqualification event ${event.id} for beatmapset ${event.beatmapset.id} (ranked status: ${event.beatmapset.status})`
			);
	}

	return relevantEvents;
}

function processEvents(events: BeatmapsetsFetchEvent[]) {
	// TODO
}

async function refreshOAuthToken() {
	try {
		osuOAuthToken = await getOAuthToken();
		tokenRefreshTimeout = setTimeout(refreshOAuthToken, OSU_OAUTH_TOKEN_REFRESH_INTERVAL);
	} catch (e) {
		logError("failed to refresh OAuth token:\n", e);
		tokenRefreshTimeout = setTimeout(refreshOAuthToken, OSU_OAUTH_TOKEN_PANIC_REFRESH_INTERVAL);
	}
}

function logInfo(msg: string, ...data: any[]) {
	console.log(`${new Date().toISOString()} [Batch #${sessionBatchCount}] ${msg}`, ...data);
}

function logError(msg: string, ...data: any[]) {
	console.error(`${new Date().toISOString()} [Batch #${sessionBatchCount}] ${msg}`, ...data);
}
