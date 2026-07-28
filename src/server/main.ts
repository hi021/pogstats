import http from "http";
import Koa from "koa";
import { DEV_ENV, METRICS_PORT, SERVER_PORT } from "../env.js";
import { metricsMiddleware, requestTimingMiddleware } from "../metrics.js";
import { FlagDefinitions, parseArgs } from "../shared.js";
import { errorHandlerMiddleware, router } from "./pog-api.js";
import { BASE_POG_WS_URL, onConnect, onUpgrade, socketDebugMessageEndpoint, pogWss } from "./pog-ws.js";
import { initializeScoresFetch } from "./scores-ws.js";

export const FLAG_DEFINITIONS = Object.freeze({
	noScoresWs: {
		cli: "--noScoresWs",
		description: "Does not connect to ushio, useful for hosting only the pog API",
		takesValue: false
	},
	cursorScoreId: {
		cli: "--cursorScoreId <number>",
		description: "Resume from a specific score ID cursor instead of the last saved one",
		takesValue: true
	}
} as const satisfies FlagDefinitions);

export const pogApiApp = new Koa({ env: DEV_ENV ? "development" : "production" });
export const pogApiServer = http.createServer(pogApiApp.callback());

const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, import.meta.main, FLAG_DEFINITIONS);

pogApiApp.use(errorHandlerMiddleware);
pogApiApp.use(metricsMiddleware);
pogApiApp.use(requestTimingMiddleware);
pogApiApp.use(socketDebugMessageEndpoint); // TODO debug only
pogApiApp.use(router.routes()).use(router.allowedMethods());
pogApiApp.on("error", (e, ctx) => console.error("pog API error:\n", ctx.url, e));

pogApiServer.on("upgrade", onUpgrade);
pogWss.on("connection", onConnect);

if (parsedFlags?.noScoresWs) console.log("scores fetch disabled by CLI parameter");
else initializeScoresFetch(parsedFlags);

pogApiServer.listen(SERVER_PORT, () => {
	console.log(`pog-api running on http://localhost:${SERVER_PORT}`);
	console.log(`pog-ws running on ws://localhost:${SERVER_PORT}${BASE_POG_WS_URL}`);
});

if (METRICS_PORT && METRICS_PORT != SERVER_PORT) {
	const metricsApp = new Koa();
	metricsApp.use(metricsMiddleware);
	const metricsServer = http.createServer(metricsApp.callback());
	metricsServer.listen(METRICS_PORT, () => console.log(`pog metrics running on http://localhost:${METRICS_PORT}/metrics`));
}
