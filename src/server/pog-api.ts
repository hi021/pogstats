import Router from "@koa/router";
import { DefaultContext, DefaultState, Middleware } from "koa";
import { getGradeSpreadForPlayer, getPlayerIdByIdOrName, getPositionSpreadForPlayer, getRankingForPlayer } from "../db-api.js";
import { withDbClient } from "../db-generic.js";
import { getRulesetId } from "../shared.js";

export const API_BASE_URL = "/api/v2/";
const API_PLAYER_BASE_URL = "player/:idOrName";

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

const playerIdByIdOrNameMiddleware: Middleware<DefaultState, DefaultContext, any> = async (ctx, next) => {
	const playerId = await withDbClient(async client => await getPlayerIdByIdOrName(client, ctx.params.idOrName));
	if (!playerId) ctx.throw(400, "User not found");

	ctx.state.playerId = playerId;

	await next();
};

//// PLAYER ROUTES
router.use(API_PLAYER_BASE_URL, playerIdByIdOrNameMiddleware);

router.get(API_PLAYER_BASE_URL + "/:ruleset/position-spread", async (ctx, next) => {
	const rulesetId = getRulesetId(ctx.params.ruleset as Ruleset);
	if (rulesetId == null) return ctx.throw(400, "Invalid ruleset, remember osu!catch is called fruits :)");

	const spread = await withDbClient(async client => await getPositionSpreadForPlayer(client, ctx.state.playerId, rulesetId));

	ctx.headers["content-type"] = "application/json";
	ctx.body = spread;
});

router.get(API_PLAYER_BASE_URL + "/:ruleset/grade-spread", async (ctx, next) => {
	const rulesetId = getRulesetId(ctx.params.ruleset as Ruleset);
	if (rulesetId == null) return ctx.throw(400, "Invalid ruleset, remember osu!catch is called fruits :)");

	const spread = await withDbClient(async client => await getGradeSpreadForPlayer(client, ctx.state.playerId, rulesetId));

	ctx.headers["content-type"] = "application/json";
	ctx.body = spread;
});

router.get(API_PLAYER_BASE_URL + "/:ruleset/:ranking{/:date}", async (ctx, next) => {
	const rulesetId = getRulesetId(ctx.params.ruleset as Ruleset);
	if (rulesetId == null) return ctx.throw(400, "Invalid ruleset, remember osu!catch is called fruits :)");

	const ranking = await withDbClient(
		async client => await getRankingForPlayer(client, ctx.params.ranking, ctx.state.playerId, ctx.params.date)
	);
	if (!ranking) ctx.throw(400, "Invalid ranking");

	ctx.headers["content-type"] = "application/json";
	ctx.body = ranking;
});
