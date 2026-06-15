import http from "http";
import Koa from "koa";
import { WebSocket, WebSocketServer } from "ws";
import { SERVER_PORT } from "../scripts/env.js";
import { handleScoresMessage } from "./scores-ws.js";
import { onConnect, sendDebugMessageToSocket } from "./pog-ws.js";

const SCORES_WS_URL = "wss://ushio.chiffa.lol/";

const app = new Koa();
const server = http.createServer(app.callback());
const wss = new WebSocketServer({ noServer: true });

const scoresWs = new WebSocket(SCORES_WS_URL);

app.use(async ctx => {
	if (ctx.path === "/status") {
		ctx.body = { ok: true };
	}
});

server.on("upgrade", (req, socket, head) => {
	if (req.url === "/api/v1/socket/scores") {
		wss.handleUpgrade(req, socket, head, ws => {
			wss.emit("connection", ws, req);
		});
	} else {
		socket.destroy();
	}
});

wss.on("connection", onConnect);

app.use(sendDebugMessageToSocket);

scoresWs.on("open", () => {
	console.log("Connected to scores-ws");
	// TODO send scoreId depending on flag
	scoresWs.send("connect");
});

scoresWs.on("message", handleScoresMessage);

scoresWs.on("error", err => {
	console.error("scores-ws error:\n", err);
});

scoresWs.on("close", () => {
	console.log("scores-ws connection closed");
});

server.listen(SERVER_PORT, () => {
	console.log(`Server running on http://localhost:${SERVER_PORT}`);
	console.log(`WebSocket listening on ws://localhost:${SERVER_PORT}/api/v1/socket/scores`);
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
