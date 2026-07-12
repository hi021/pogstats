import http from "http";
import type { DefaultContext, DefaultState, Next, ParameterizedContext } from "koa";
import stream from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { API_BASE_URL } from "./pog-api.js";

export const BASE_POG_WS_URL = API_BASE_URL + "socket/";
const POG_WS_SCORES_URL = BASE_POG_WS_URL + "scores";
const POG_WS_RESTRICTIONS_URL = BASE_POG_WS_URL + "restrictions";

export const wss = new WebSocketServer({ noServer: true });
export const wsClients = new Set<WebSocket>();

export function onUpgrade(req: http.IncomingMessage, socket: stream.Duplex, head: Buffer) {
	if (req.url?.startsWith(BASE_POG_WS_URL)) wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
	else socket.destroy();
}

// Placeholder
export function onConnect(ws: WebSocket) {
	wsClients.add(ws);

	ws.on("message", msg => {
		console.log("Received:", msg.toString());
	});

	ws.on("close", () => {
		wsClients.delete(ws);
	});
}

export async function socketDebugMessageEndpoint(
	ctx: ParameterizedContext<DefaultState, DefaultContext, any>,
	next: Next
) {
	if (ctx.path == BASE_POG_WS_URL && ctx.method == "POST") {
		const message = "Hello from pog server!";
		for (const client of wsClients) client.send(message);

		ctx.body = { sent: message };
		return;
	}

	await next();
}
