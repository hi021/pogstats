import type { DefaultContext, DefaultState, Next, ParameterizedContext } from "koa";
import WebSocket from "ws";

export const wsClients = new Set<WebSocket>();

export function onConnect(ws: WebSocket) {
	wsClients.add(ws);

	ws.on("message", msg => {
		console.log("Received:", msg.toString());
	});

	ws.on("close", () => {
		wsClients.delete(ws);
	});
}

export async function sendDebugMessageToSocket(ctx: ParameterizedContext<DefaultState, DefaultContext, any>, next: Next) {
	if (ctx.path === "/api/v1/socket/scores" && ctx.method === "POST") {
		const message = "Hello from server!";
		for (const client of wsClients) client.send(message);

		ctx.body = { sent: message };
		return;
	}

	await next();
}
