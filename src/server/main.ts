import http from "http";
import Koa from "koa";
import { DEV_ENV, SERVER_PORT } from "../env.js";
import { FlagDefinitions, parseArgs } from "../shared.js";
import { errorHandlerMiddleware, router } from "./pog-api.js";
import { BASE_POG_WS_URL, onConnect, onUpgrade, socketDebugMessageEndpoint, wss } from "./pog-ws.js";
import { scoresWs, scoresWsOnClose, scoresWsOnError, scoresWsOnMessage, scoresWsOnOpen } from "./scores-ws.js";

export const FLAG_DEFINITIONS = Object.freeze({
	disableScoresWs: {
		cli: "--disableScoresWs",
		description: "Does not connect to ushio, useful for hosting only the pog API",
		takesValue: false
	},
	cursorScoreId: {
		cli: "--cursorScoreId <number>",
		description: "Resume from a specific score ID cursor instead of the last saved one",
		takesValue: true
	}
} as const satisfies FlagDefinitions);

export const app = new Koa({ env: DEV_ENV ? "development" : "production" });
export const server = http.createServer(app.callback());

const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, import.meta.main, FLAG_DEFINITIONS);

app.use(errorHandlerMiddleware);
app.use(socketDebugMessageEndpoint);
app.use(router.routes()).use(router.allowedMethods());
app.on("error", (e, ctx) => {
	console.error("Server error:\n", ctx.url, e);
});

server.on("upgrade", onUpgrade);
wss.on("connection", onConnect);

if (parsedFlags?.disableScoresWs) {
	console.log("scores-ws disabled by CLI parameter");
} else {
	scoresWs.on("open", () => scoresWsOnOpen(parsedFlags));
	scoresWs.on("error", scoresWsOnError);
	scoresWs.on("close", scoresWsOnClose);
	scoresWs.on("message", scoresWsOnMessage);
}

server.listen(SERVER_PORT, () => {
	console.log(`Server running on http://localhost:${SERVER_PORT}`);
	console.log(`WebSocket listening on ws://localhost:${SERVER_PORT}${BASE_POG_WS_URL}`);
});
