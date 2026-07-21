import Router from "@koa/router";
import { Middleware } from "koa";
import {
	getEasiestBeatmapsWithoutPermaScore,
	getGradeSpreadForPlayer,
	getPlayerIdByIdOrName,
	getPositionSpreadForPlayer,
	getRankingForPlayer
} from "../db-api.js";
import { withDbClient } from "../db-generic.js";
import { getRulesetId, parseInteger } from "../shared.js";

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

//// PLAYER ROUTES
router.use(API_PLAYER_BASE_URL, playerIdByIdOrNameMiddleware);
router.use(API_PLAYER_BASE_URL + "/:ruleset", rulesetIdByNameMiddleware);

// player info

router.get(API_PLAYER_BASE_URL + "/:ruleset/position-spread", async (ctx, next) => {
	const spread = await withDbClient(
		async client => await getPositionSpreadForPlayer(client, ctx.state.playerId, ctx.state.rulesetId)
	);

	ctx.headers["content-type"] = "application/json";
	ctx.body = spread;
});

router.get(API_PLAYER_BASE_URL + "/:ruleset/grade-spread", async (ctx, next) => {
	const spread = await withDbClient(
		async client => await getGradeSpreadForPlayer(client, ctx.state.playerId, ctx.state.rulesetId)
	);

	ctx.headers["content-type"] = "application/json";
	ctx.body = spread;
});

router.get(API_PLAYER_BASE_URL + "/:ruleset/:ranking{/:date}", async (ctx, next) => {
	const ranking = await withDbClient(
		async client =>
			await getRankingForPlayer(client, ctx.params.ranking, ctx.state.rulesetId, ctx.state.playerId, ctx.params.date)
	);
	if (!ranking) ctx.throw(400, "Invalid ranking");

	ctx.headers["content-type"] = "application/json";
	ctx.body = ranking;
});

// player snipes
// player sniped by

//// BEATMAP ROUTES

// beatmap/set metadata
// beatmap scores (with or without metadata)

//// BEATMAPS ROUTES
router.use(API_BEATMAPS_BASE_URL + "/:ruleset", rulesetIdByNameMiddleware);

router.get(API_BEATMAPS_BASE_URL + "/:ruleset/no-perma{/:position}", async (ctx, next) => {
	const posThreshold = parseInteger(ctx.params.position, 1) || 1;
	const beatmaps = await withDbClient(
		async client => await getEasiestBeatmapsWithoutPermaScore(client, ctx.state.rulesetId, posThreshold > 100 ? 100 : posThreshold)
	);

	ctx.headers["content-type"] = "application/json";
	ctx.body = beatmaps;
});

// beatmap count

//// AUTOCOMPLETE ROUTES

// beatmap title SIMILARITY() lookup
// player username SIMILARITY() lookup
