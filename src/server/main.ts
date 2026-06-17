import http from "http";
import Koa from "koa";
import { SERVER_PORT } from "../scripts/env.js";
import { onConnect, onUpgrade, POG_WS_URL, sendDebugMessageToSocket, wss } from "./pog-ws.js";
import { scoresWsOnMessage, scoresWs, scoresWsOnClose, scoresWsOnError } from "./scores-ws.js";

export const API_BASE_URL = "/api/v1/";

export const app = new Koa();
export const server = http.createServer(app.callback());

app.use(async ctx => {
	if (ctx.path === "/status") {
		ctx.body = { ok: true };
	}
});

server.on("upgrade", onUpgrade);

wss.on("connection", onConnect);

app.use(sendDebugMessageToSocket);

scoresWs.on("open", () => {
	console.log("Connected to scores-ws");
	// TODO send scoreId as cursor depending on flag
	scoresWs.send("connect");
});

scoresWs.on("message", scoresWsOnMessage);
scoresWs.on("error", scoresWsOnError);
scoresWs.on("close", scoresWsOnClose);

server.listen(SERVER_PORT, () => {
	console.log(`Server running on http://localhost:${SERVER_PORT}`);
	console.log(`WebSocket listening on ws://localhost:${SERVER_PORT}${POG_WS_URL}`);
});

// TODO
// function reconnect(scoreId) {
//     setTimeout(_ => {
//         const socket = new WebSocket("ws://127.0.0.1:7727");

//         // ... we can use that score id. This way we only receive the scores that
//         // were fetched in the meanwhile that we don't already know about.
//         socket.on("open", _ => socket.send(scoreId));
//         socket.on("message", onMessage);
//     }, 10_000);
// }
