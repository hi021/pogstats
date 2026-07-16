import { ClientBase } from "pg";
import { withDbClientTransaction } from "../db-generic.js";
import { DB_PLAYER_POG_BADGES_TABLE, DB_PLAYERS_TABLE, DB_POG_BADGES_TABLE } from "../env.js";

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

async function createTables(client: ClientBase) {
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
      CONSTRAINT pog_badges_user_fk FOREIGN KEY(user_id) REFERENCES ${DB_PLAYERS_TABLE}(id),
      CONSTRAINT pog_badges_badge_fk FOREIGN KEY(pog_badge_id) REFERENCES ${DB_POG_BADGES_TABLE}(id)
    )`);

	console.log(`Created ${DB_POG_BADGES_TABLE} and ${DB_PLAYER_POG_BADGES_TABLE} tables if didn't exist`);
}

async function populateTables(client: ClientBase) {
	console.log(`Populating ${DB_POG_BADGES_TABLE} and ${DB_PLAYER_POG_BADGES_TABLE} tables with initial values`);
	console.log(
		"\nWarning! This WILL FAIL when first initializing the database, as there are no players yet (pog_badges_user_fk), don't worry :)\n"
	);

	for (const badge of POG_BADGES)
		await client.query(
			`INSERT INTO ${DB_POG_BADGES_TABLE} (id, name, img_url) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, img_url = EXCLUDED.img_url`,
			[badge.id, badge.name, badge.imgUrl]
		);

	for (const badge of POG_BADGES) {
		for (const playerId of badge.playerIds) {
			await client.query(
				`INSERT INTO ${DB_PLAYER_POG_BADGES_TABLE} (user_id, pog_badge_id) VALUES ($1, $2) ON CONFLICT (user_id, pog_badge_id) DO NOTHING`,
				[playerId, badge.id]
			);
		}
	}

	console.log(`Populated ${DB_POG_BADGES_TABLE} and ${DB_PLAYER_POG_BADGES_TABLE} tables with initial values`);
}

async function main() {
	try {
		await withDbClientTransaction(async client => {
			await createTables(client);
			await populateTables(client);
		});
	} catch (e) {
		console.error("Error creating tables:\n", e);
	}
}

main();
