import http from "http";
import Koa from "koa";
import { WebSocket } from "ws";
import { SERVER_PORT } from "../scripts/env.js";
import { onConnect, onUpgrade, sendDebugMessageToSocket, wss } from "./pog-ws.js";
import { handleScoresMessage, saveLastScoreId } from "./scores-ws.js";

const API_BASE_URL = "/api/v1/"
const POG_WS_URL = API_BASE_URL + "socket/scores"
const SCORES_WS_URL = "wss://ushio.chiffa.lol/";

const app = new Koa();
const server = http.createServer(app.callback());

const scoresWs = new WebSocket(SCORES_WS_URL);

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

scoresWs.on("message", handleScoresMessage);

scoresWs.on("error", err => {
	console.error("scores-ws error:\n", err);
	saveLastScoreId();
});

scoresWs.on("close", () => {
	console.log("scores-ws connection closed");
	saveLastScoreId();
});

server.listen(SERVER_PORT, () => {
	console.log(`Server running on http://localhost:${SERVER_PORT}`);
	console.log(`WebSocket listening on ws://localhost:${SERVER_PORT}${POG_WS_URL}`);
});

// function reconnect(scoreId) {
//     setTimeout(_ => {
//         const socket = new WebSocket("ws://127.0.0.1:7727");

//         // ... we can use that score id. This way we only receive the scores that
//         // were fetched in the meanwhile that we don't already know about.
//         socket.on("open", _ => socket.send(scoreId));
//         socket.on("message", onMessage);
//     }, 10_000);
// }
