import { Redis } from "ioredis";
import { DEV_ENV, VALKEY_HOST, VALKEY_PASSWORD, VALKEY_PORT } from "./env.js";

export const cacheServer = new Redis({
	port: VALKEY_PORT,
	host: VALKEY_HOST,
	password: VALKEY_PASSWORD || undefined,
	showFriendlyErrorStack: DEV_ENV
});

export const PLAYER_ID_TO_USERNAME_HASH = "players:id-to-username";
export const PLAYER_USERNAME_TO_ID_HASH = "players:username-to-id";

export async function getCachedPlayerUsername(playerId: string | number) {
	return await cacheServer.hget(PLAYER_ID_TO_USERNAME_HASH, String(playerId));
}

export async function getCachedPlayerId(username: string) {
	const playerId = await cacheServer.hget(PLAYER_USERNAME_TO_ID_HASH, username);
	return playerId == null ? null : Number(playerId);
}

// TODO?: cache new players when scraping players - low prio since already done in getPlayerIdByName and getPlayerIdById
export async function cachePlayer(playerId: string | number, username: string) {
	const id = String(playerId);
	await cacheServer
		.pipeline()
		.hset(PLAYER_ID_TO_USERNAME_HASH, id, username)
		.hset(PLAYER_USERNAME_TO_ID_HASH, username, id)
		.exec();
}
