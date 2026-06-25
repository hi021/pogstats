import http from "http";
import Koa from "koa";
import { SERVER_PORT } from "../scripts/env.js";
import { onConnect, onUpgrade, POG_WS_URL, socketDebugMessageEndpoint, wss } from "./pog-ws.js";
import { scoresWs, scoresWsOnClose, scoresWsOnError, scoresWsOnMessage, scoresWsOnOpen } from "./scores-ws.js";
import { FlagDefinitions, parseArgs } from "../shared.js";

export const FLAG_DEFINITIONS = Object.freeze({
	cursorScoreId: {
		cli: "--cursorScoreId <number>",
		description: "Resume from a specific score ID cursor instead of the last saved one",
		takesValue: true
	}
} as const satisfies FlagDefinitions);

export const app = new Koa();
export const server = http.createServer(app.callback());

const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, FLAG_DEFINITIONS);

app.use(socketDebugMessageEndpoint);

server.on("upgrade", onUpgrade);
wss.on("connection", onConnect);

scoresWs.on("open", () => scoresWsOnOpen(parsedFlags));
scoresWs.on("error", scoresWsOnError);
scoresWs.on("close", scoresWsOnClose);
scoresWs.on("message", scoresWsOnMessage);

server.listen(SERVER_PORT, () => {
	console.log(`Server running on http://localhost:${SERVER_PORT}`);
	console.log(`WebSocket listening on ws://localhost:${SERVER_PORT}${POG_WS_URL}`);
});
