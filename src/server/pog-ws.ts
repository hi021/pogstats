import http from "http";
import type { DefaultContext, DefaultState, Next, ParameterizedContext } from "koa";
import stream, { Stream } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { API_BASE_URL } from "./pog-api.js";

export const BASE_POG_WS_URL = API_BASE_URL + "socket/";
const POG_WS_RANKINGS_URL = BASE_POG_WS_URL + "rankings"; // for ranking updates
const POG_WS_PLAYERS_URL = BASE_POG_WS_URL + "players"; // after player scrape
const POG_WS_SCORES_URL = BASE_POG_WS_URL + "scores";

export const pogWss = new WebSocketServer({ noServer: true });
export const rankingClients = new Set<WebSocket>();
export const playerClients = new Set<WebSocket>();
export const scoreClients = new Set<WebSocket>();

export function onUpgrade(req: http.IncomingMessage, socket: stream.Duplex, head: Buffer) {
	if (req.url?.startsWith(BASE_POG_WS_URL)) pogWss.handleUpgrade(req, socket, head, ws => pogWss.emit("connection", ws, req));
	else socket.destroy();
}

export function onConnect(ws: WebSocket, req: http.IncomingMessage) {
	if (!req?.url) return ws.close(1008, "Invalid URL");

	const url = new URL(req.url, "http://localhost");
	switch (url.pathname) {
		case POG_WS_RANKINGS_URL:
			rankingClients.add(ws);
			break;
		case POG_WS_PLAYERS_URL:
			playerClients.add(ws);
			break;
		case POG_WS_SCORES_URL:
			scoreClients.add(ws);
			break;
		default:
			return ws.close(1008, "Invalid URL");
	}

	ws.on("message", msg => {
		console.log("Received:", msg.toString());
	});

	ws.on("close", () => {
		rankingClients.delete(ws);
		playerClients.delete(ws);
		scoreClients.delete(ws);
	});
}

export function onClientError(e: Error, socket: Stream.Duplex, req: http.IncomingMessage) {
	console.error("WebSocket client error:\n", e);
}

export function onError(e: Error) {
	console.error("WebSocket server error:\n", e);
}

// TODO Placeholder
export async function socketDebugMessageEndpoint(ctx: ParameterizedContext<DefaultState, DefaultContext, any>, next: Next) {
	if (ctx.path == BASE_POG_WS_URL && ctx.method == "GET") {
		const message = "Hello from pog server!";
		for (const client of rankingClients) client.send(message);

		ctx.body = { sent: message };
		return;
	}
}
