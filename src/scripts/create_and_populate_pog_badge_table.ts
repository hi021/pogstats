import { PoolClient, QueryResult } from "pg";
import { dbPool } from "../db.js";
import {
	DB_PLAYER_POG_BADGES_TABLE,
	DB_PLAYERS_TABLE,
	DB_POG_BADGES_TABLE
} from "../env.js";

type ProtoPogBadge = PogBadge & { playerIds: number[] };

// TODO actually upload the badge images
const POG_BADGES: Readonly<ProtoPogBadge[]> = Object.freeze([
	{ id: 1, name: "poggers", imgUrl: "/badges/pogu.png", playerIds: [5795337] },
	{ id: 2, name: "idiot", imgUrl: "/badges/unhappi.png", playerIds: [1023489] },
	{ id: 3, name: undefined, imgUrl: "/badges/wither.svg", playerIds: [9991650] },
	{ id: 4, name: undefined, imgUrl: "/badges/star.svg", playerIds: [11482346] },
	{ id: 5, name: undefined, imgUrl: "/badges/doggo.png", playerIds: [11495715] },
	{ id: 6, name: "poge", imgUrl: "/badges/pognerchamp.png", playerIds: [14697237] }
]);

let client: PoolClient;

async function createTables() {
	console.log(`Attempting to create ${DB_POG_BADGES_TABLE} and ${DB_PLAYER_POG_BADGES_TABLE} tables`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_POG_BADGES_TABLE} (
      id							SMALLINT PRIMARY KEY,
      name						TEXT,
      img_url					TEXT NOT NULL
    )`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_PLAYER_POG_BADGES_TABLE} (
      user_id					INTEGER NOT NULL,
      pog_badge_id		SMALLINT NOT NULL,

      PRIMARY KEY (user_id, pog_badge_id),
      CONSTRAINT pog_badges_user_fk FOREIGN KEY(user_id)
      REFERENCES ${DB_PLAYERS_TABLE}(id),
      CONSTRAINT pog_badges_badge_fk FOREIGN KEY(pog_badge_id)
      REFERENCES ${DB_POG_BADGES_TABLE}(id)
    )`);

	console.log(`Created ${DB_POG_BADGES_TABLE} and ${DB_PLAYER_POG_BADGES_TABLE} tables if didn't exist`);
}

// TODO YES HELLO THIS WILL FAIL!!!!!
// can always just comment out the pog_badges_user_fk or only run it after scrape_players
async function populateTables() {
	console.log(`Populating ${DB_POG_BADGES_TABLE} and ${DB_PLAYER_POG_BADGES_TABLE} tables with initial values`);

	const pogBadgePromises = new Array<Promise<QueryResult<any>>>();
	for (const badge of POG_BADGES) {
		pogBadgePromises.push(
			client.query(
				`INSERT INTO ${DB_POG_BADGES_TABLE} (id, name, img_url) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, img_url = EXCLUDED.img_url`,
				[badge.id, badge.name, badge.imgUrl]
			)
		);
	}
	await Promise.all(pogBadgePromises);

	const playerPogBadgePromises = new Array<Promise<QueryResult<any>>>();
	for (const badge of POG_BADGES) {
		for (const playerId of badge.playerIds) {
			playerPogBadgePromises.push(
				client.query(
					`INSERT INTO ${DB_PLAYER_POG_BADGES_TABLE} (user_id, pog_badge_id) VALUES ($1, $2) ON CONFLICT (user_id, pog_badge_id) DO NOTHING`,
					[playerId, badge.id]
				)
			);
		}
	}
	await Promise.all(playerPogBadgePromises);

	console.log(`Populated ${DB_POG_BADGES_TABLE} and ${DB_PLAYER_POG_BADGES_TABLE} tables with initial values`);
}

async function main() {
	try {
		client = await dbPool.connect();
		await createTables();
		await populateTables();
	} catch (e) {
		console.error("Error creating tables:\n", e);
	} finally {
		client.release();
	}
}

main();
