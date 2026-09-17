import Router from "@koa/router";
import { Middleware } from "koa";
import { getFullRankingFromRollup, getRankingForPlayer } from "../db-api-ranking.js";
import {
	getBeatmapCount,
	getBeatmapsByFilters,
	getEasiestBeatmapsWithoutPermaScore,
	getGradeSpreadForPlayer,
	getModSpreadForPlayer,
	getPlayerIdByIdOrName,
	getPlayerInfo,
	getPositionSpreadForPlayer
} from "../db-api.js";
import { withDbClient } from "../db-generic.js";
import { getRulesetId, parseBeatmapStatusIds, parseInteger, PERMITTED_BEATMAP_STATUSES } from "../shared.js";
import koaBody from "koa-body";

export const API_BASE_URL = "/api/v2/";
const API_PLAYER_BASE_URL = "player/:idOrName";
const API_BEATMAP_BASE_URL = "map/:id";
const API_RANKING_BASE_URL = "ranking";
const API_BEATMAPS_BASE_URL = "maps";
const API_SEARCH_BASE_URL = "search";

export const router = new Router({ prefix: API_BASE_URL });

export const errorHandlerMiddleware: Middleware = async (ctx, next) => {
	try {
		await next();
	} catch (e: any) {
		ctx.status = e.status || e.statusCode || 500;
		ctx.message = ctx.status >= 500 ? "Internal Server Error" : e.message || ctx.message;
		ctx.app.emit("error", e, ctx);
	}
};

function badRequest(message: string) {
	const error = Object.assign(new Error(message), { status: 400 });
	throw error;
}

function validateAndParseBeatmapFilterQuery(body: unknown): Partial<BeatmapFilterQuery> {
	if (body == null || typeof body != "object" || Array.isArray(body)) badRequest("Request body must be a JSON object");

	const query = body as Record<string, unknown>;
	const allowedParameters = new Set<keyof BeatmapFilterQuery>([
		"status",
		"artist",
		"title",
		"version",
		"creator",
		"ruleset",
		"approved_date",
		"star_rating",
		"total_length",
		"bpm",
		"cs",
		"od",
		"ar",
		"hp"
	]);

	const parameters = Object.keys(query);
	for (const parameter of parameters) {
		if (!allowedParameters.has(parameter as keyof BeatmapFilterQuery))
			badRequest(`Unknown map filter parameter: '${parameter}'`);
	}

	const result: Partial<BeatmapFilterQuery> = {};
	const similarityParameters = ["artist", "title", "creator", "version"] as const;
	for (const parameter of similarityParameters) {
		if (!(parameter in query)) continue;

		const value = query[parameter];
		if (typeof value != "string") badRequest(`'${parameter}' must be a string`);
		const stringValue = (value as string).trim();
		if ((parameter == "version" && stringValue.length) || stringValue.length >= 3) result[parameter] = stringValue;
	}

	if ("status" in query) {
		const value = query.status;
		if (
			!Array.isArray(value) ||
			!value.every(status => Number.isInteger(status) && PERMITTED_BEATMAP_STATUSES.includes(status))
		)
			badRequest("Status can only be 'ranked', 'approved', or 'loved' (1, 2, 4)");
		result.status = value as BeatmapFilterQuery["status"];
	}

	if ("ruleset" in query) {
		const value = query.ruleset;
		if (typeof value != "number" || !Number.isInteger(value) || value < 0 || value > 3)
			badRequest("Ruleset must be an integer from 0 to 3");
		result.ruleset = value as RulesetId;
	}

	const rangeParameters = ["approvedDate", "starRating", "totalLength", "bpm", "cs", "od", "ar", "hp"] as const;
	for (const parameter of rangeParameters) {
		if (!(parameter in query)) continue;

		const value = query[parameter];
		if (!Array.isArray(value) || value.length != 2) badRequest(`'${parameter}' must be a two-item range array`);
		const bounds = value as unknown[];

		const normalized = bounds.map((bound, index) => {
			if (bound == null) return null;

			if (parameter == "approvedDate") {
				const date = new Date(bound as string | number | Date);
				if (isNaN(date.getTime())) badRequest(`'${parameter}' bound ${index + 1} must be a valid date`);
				return date;
			}
			if (typeof bound != "number" || !Number.isFinite(bound))
				badRequest(`'${parameter}' bound ${index + 1} must be a finite number`);

			return bound;
		});

		(result as Record<string, unknown>)[parameter] = normalized;
	}

	if (!Object.keys(result).length) badRequest("At least one filter is required");
	return result;
}

const playerIdByIdOrNameMiddleware: Middleware = async (ctx, next) => {
	const playerId = await withDbClient(async client => await getPlayerIdByIdOrName(client, ctx.params.idOrName));
	if (!playerId) ctx.throw(400, "User not found");

	ctx.state.playerId = playerId;
	await next();
};

const rulesetIdByNameMiddleware: Middleware = async (ctx, next) => {
	const rulesetId = getRulesetId(ctx.params.ruleset as Ruleset);
	if (rulesetId == null) return ctx.throw(400, "Invalid ruleset, remember osu!catch is called fruits :)");

	ctx.state.rulesetId = rulesetId;
	await next();
};

//// RANKING ROUTES
// full getFullRankingFromRollup per ruleset
// live per ruleset and ranking type
// historical

//// PLAYER ROUTES
router.use(API_PLAYER_BASE_URL, playerIdByIdOrNameMiddleware);
router.use(API_PLAYER_BASE_URL + "/:ruleset", rulesetIdByNameMiddleware);

router.get(API_PLAYER_BASE_URL, async ctx => {
	// TODO?: boolean parse helper function?
	const data = await withDbClient(async client => await getPlayerInfo(client, ctx.state.playerId, ctx.query.full == "true"));

	ctx.type = "application/json";
	ctx.body = data;
});

router.get(API_PLAYER_BASE_URL + "/:ruleset/position-spread", async ctx => {
	const spread = await withDbClient(
		async client => await getPositionSpreadForPlayer(client, ctx.state.playerId, ctx.state.rulesetId)
	);

	ctx.type = "application/json";
	ctx.body = spread;
});

router.get(API_PLAYER_BASE_URL + "/:ruleset/grade-spread{/:position}", async ctx => {
	const posThreshold = parseInteger(ctx.params.position, 1) || 100;
	const spread = await withDbClient(
		async client =>
			await getGradeSpreadForPlayer(client, ctx.state.playerId, ctx.state.rulesetId, posThreshold > 100 ? 100 : posThreshold)
	);

	ctx.type = "application/json";
	ctx.body = spread;
});

router.get(API_PLAYER_BASE_URL + "/:ruleset/mod-spread{/:position}", async ctx => {
	const posThreshold = parseInteger(ctx.params.position, 1) || 100;
	const spread = await withDbClient(
		async client =>
			await getModSpreadForPlayer(client, ctx.state.playerId, ctx.state.rulesetId, posThreshold > 100 ? 100 : posThreshold)
	);

	ctx.type = "application/json";
	ctx.body = spread;
});

router.get(API_PLAYER_BASE_URL + "/:ruleset/:rankings{/:date}", async ctx => {
	// TODO: error handlin
	const ranking = await withDbClient(
		async client =>
			await getRankingForPlayer(
				client,
				ctx.params.rankings.split(","),
				ctx.state.rulesetId,
				ctx.state.playerId,
				ctx.params.date
			)
	);
	if (!ranking) ctx.throw(400, "Invalid ranking");

	ctx.type = "application/json";
	ctx.body = ranking;
});

// player snipes
// player sniped by

//// BEATMAP ROUTES

// beatmap/set metadata
// beatmap scores (with or without metadata)

//// BEATMAPS ROUTES
router.use(API_BEATMAPS_BASE_URL + "/:ruleset", rulesetIdByNameMiddleware);

router.get(API_BEATMAPS_BASE_URL + "/:ruleset/no-perma{/:position}", async ctx => {
	const posThreshold = parseInteger(ctx.params.position, 1) || 1;
	const beatmaps = await withDbClient(
		async client =>
			await getEasiestBeatmapsWithoutPermaScore(
				client,
				ctx.state.rulesetId,
				posThreshold > 100 ? 100 : posThreshold,
				parseInteger(ctx.query.page, 1) || 1
			)
	);

	ctx.type = "application/json";
	ctx.body = beatmaps;
});

router.get(API_BEATMAPS_BASE_URL + "/:ruleset/count{/:statuses}", async ctx => {
	const statusIds = parseBeatmapStatusIds(ctx.params.statuses);
	const count = await withDbClient(
		async client =>
			await getBeatmapCount(client, ctx.state.rulesetId, statusIds.length ? statusIds : PERMITTED_BEATMAP_STATUSES)
	);

	ctx.type = "text/plain";
	ctx.body = count;
});

//// LOOKUP ROUTES
router.post<BeatmapFilterQuery>(API_SEARCH_BASE_URL + "/maps", koaBody(), async ctx => {
	const request = ctx.request as typeof ctx.request & { body?: unknown };
	const filters = validateAndParseBeatmapFilterQuery(request.body);

	console.log("filters", filters); // TODO: debug only

	ctx.type = "application/json";
	ctx.body = await withDbClient(
		async client => await getBeatmapsByFilters(client, filters, parseInteger(ctx.query.page, 1) || 1)
	);
});

// TODO player username SIMILARITY() lookup
router.get(API_SEARCH_BASE_URL + "/players/:username", async ctx => {
	if (ctx.params.username.length < 3) ctx.throw(400, "Username query must be at least 3 characters long");
});
