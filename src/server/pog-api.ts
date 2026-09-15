import Router from "@koa/router";
import { Middleware } from "koa";
import { getFullRankingFromRollup, getRankingForPlayer } from "../db-api-ranking.js";
import {
	getBeatmapCount,
	getEasiestBeatmapsWithoutPermaScore,
	getGradeSpreadForPlayer,
	getModSpreadForPlayer,
	getPlayerIdByIdOrName,
	getPlayerInfo,
	getPositionSpreadForPlayer
} from "../db-api.js";
import { withDbClient } from "../db-generic.js";
import { getRulesetId, parseBeatmapStatusIds, parseInteger } from "../shared.js";

export const API_BASE_URL = "/api/v2/";
const API_PLAYER_BASE_URL = "player/:idOrName";
const API_BEATMAP_BASE_URL = "map/:id";
const API_BEATMAPS_BASE_URL = "maps";

export const router = new Router({ prefix: API_BASE_URL });

export const errorHandlerMiddleware: Middleware = async (ctx, next) => {
	try {
		await next();
	} catch (e: any) {
		ctx.status = e.status || e.statusCode || 500;
		ctx.message = e.message || ctx.message;
		ctx.app.emit("error", e, ctx);
	}
};

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
// ...

// TODO: call getFullRankingFromRollup

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
			await getEasiestBeatmapsWithoutPermaScore(client, ctx.state.rulesetId, posThreshold > 100 ? 100 : posThreshold)
	);

	ctx.type = "application/json";
	ctx.body = beatmaps;
});

router.get(API_BEATMAPS_BASE_URL + "/:ruleset/count{/:statuses}", async ctx => {
	const statusIds = parseBeatmapStatusIds(ctx.params.statuses);
	const count = await withDbClient(
		async client => await getBeatmapCount(client, ctx.state.rulesetId, statusIds.length ? statusIds : [1, 2, 4])
	);

	ctx.headers["Content-Type"] = "text/plain";
	ctx.body = count;
});

//// AUTOCOMPLETE ROUTES
// beatmap title SIMILARITY() lookup
// player username SIMILARITY() lookup
