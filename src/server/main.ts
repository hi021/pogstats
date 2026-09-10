import http from "http";
import Koa from "koa";
import { closePool } from "../db-generic.js";
import { DEV_ENV, METRICS_PORT, SERVER_PORT } from "../env.js";
import { metricsMiddleware, requestTimingMiddleware } from "../metrics.js";
import { FlagDefinitions, parseArgs } from "../shared.js";
import { abortBeatmapsetsFetch, initializeBeatmapsetsFetch } from "./beatmapsets-fetch.js";
import { errorHandlerMiddleware, router } from "./pog-api.js";
import { BASE_POG_WS_URL, onClientError, onConnect, onError, onUpgrade, pogWss, socketDebugMessageEndpoint } from "./pog-ws.js";
import { abortScoresFetch, initializeScoresFetch } from "./scores-fetch.js";

export const FLAG_DEFINITIONS = Object.freeze({
	noScoresFetch: {
		cli: "--noScoresFetch",
		description: "Does not connect to the scores endpoint, useful for hosting only the pog API",
		takesValue: false
	},
	scoreCursor: {
		cli: "--scoreCursor <string>",
		description: "Resume from a specific score cursor instead of the last saved one",
		takesValue: true
	},
	noBeatmapsetsFetch: {
		cli: "--noBeatmapsetsFetch",
		description: "Does not connect to the osu! beatmapsets events endpoint",
		takesValue: false
	},
	beatmapsetsCursor: {
		cli: "--beatmapsetsCursor <string>",
		description: "Resume from a specific beatmapsets cursor instead of the last saved one",
		takesValue: true
	}
} as const satisfies FlagDefinitions);

export const pogApiApp = new Koa({ env: DEV_ENV ? "development" : "production" });
export const pogApiServer = http.createServer(pogApiApp.callback());
let metricsServer: http.Server | null = null;
let shuttingDown = false;

const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, import.meta.main, FLAG_DEFINITIONS);

pogApiApp.use(errorHandlerMiddleware);
pogApiApp.use(metricsMiddleware);
pogApiApp.use(requestTimingMiddleware);
pogApiApp.use(router.routes()).use(router.allowedMethods());
pogApiApp.use(socketDebugMessageEndpoint); // TODO debug only
pogApiApp.on("error", (e, ctx) => console.error("pog API error:\n", ctx.url, e));

pogApiServer.on("upgrade", onUpgrade);
pogWss.on("connection", onConnect);
pogWss.on("wsClientError", onClientError);
pogWss.on("error", onError);

if (parsedFlags?.noScoresFetch) console.log("scores fetch disabled by CLI parameter");
else initializeScoresFetch(parsedFlags);
if (parsedFlags?.noBeatmapsetsFetch) console.log("beatmapsets fetch disabled by CLI parameter");
else initializeBeatmapsetsFetch(parsedFlags?.beatmapsetsCursor);

pogApiServer.listen(SERVER_PORT, () => {
	console.log(`pog-api running on http://localhost:${SERVER_PORT}`);
	console.log(`pog-ws running on ws://localhost:${SERVER_PORT}${BASE_POG_WS_URL}`);
});

if (METRICS_PORT && METRICS_PORT != SERVER_PORT) {
	const metricsApp = new Koa();
	metricsApp.use(metricsMiddleware);
	metricsServer = http.createServer(metricsApp.callback());
	metricsServer.listen(METRICS_PORT, () => console.log(`pog metrics running on http://localhost:${METRICS_PORT}/metrics`));
}

async function gracefulShutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`\n${signal} received, shutting down...`);

	abortScoresFetch();
	abortBeatmapsetsFetch();
	pogApiServer.close();
	metricsServer?.close();
	pogWss.close();

	await new Promise(resolve => setTimeout(resolve, 1000));
	await closePool();

	console.log("Shutdown complete.");
	process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
