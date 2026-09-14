import { cacheServer, PLAYER_ID_TO_USERNAME_HASH, PLAYER_USERNAME_TO_ID_HASH } from "../cache.js";
import { withDbClient } from "../db-generic.js";
import { DB_PLAYERS_TABLE } from "../env.js";
import { parseArgs } from "../shared.js";

const FLAG_DEFINITIONS = Object.freeze({
	reset: {
		cli: "--reset",
		description: "Truncates the player hashes before repopulating them",
		takesValue: false
	}
} as const);

interface PlayerCacheRow {
	id: number;
	username: string;
}

// TODO?: don't need to fetch all players to save memory, maybe figure out a way to fetch top players
// TODO!: add (long) TTL so they can be evicted if low on memory (volatile-lru)
async function populateValkey(reset = false) {
	const players = await withDbClient(
		async client => (await client.query<PlayerCacheRow>(`SELECT id, LOWER(username) AS username FROM ${DB_PLAYERS_TABLE}`)).rows
	);

	if (reset) await cacheServer.del(PLAYER_ID_TO_USERNAME_HASH, PLAYER_USERNAME_TO_ID_HASH);

	const pipeline = cacheServer.pipeline();
	for (const player of players) {
		const playerId = String(player.id);
		pipeline.hset(PLAYER_ID_TO_USERNAME_HASH, playerId, player.username);
		pipeline.hset(PLAYER_USERNAME_TO_ID_HASH, player.username, playerId);
	}

	const results = await pipeline.exec();
	const error = results?.find(([pipelineError]) => pipelineError)?.[0];
	if (error) throw error;

	console.log(`Populated Valkey with ${players.length} player(s)`);
}

const parsedFlags = parseArgs<typeof FLAG_DEFINITIONS>(process.argv, import.meta.main, FLAG_DEFINITIONS);

try {
	await populateValkey(parsedFlags.reset);
} catch (e) {
	console.error("Error populating Valkey:\n", e);
	process.exitCode = 1;
} finally {
	await cacheServer.quit();
}
