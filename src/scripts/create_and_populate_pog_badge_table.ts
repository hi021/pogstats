import { Client, QueryResult } from "pg";
import {
  DB_HOST,
  DB_NAME,
  DB_PASSWORD,
  DB_PLAYER_POG_BADGES_TABLE,
  DB_PLAYERS_TABLE,
  DB_POG_BADGES_TABLE,
  DB_PORT,
  DB_USER
} from "./env.js";

const client = new Client({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME
});

type ProtoPogBadge = PogBadge & { playerIds: number[] };

// TODO
const POG_BADGES: Readonly<ProtoPogBadge[]> = Object.freeze([
  { id: 1, name: "Pog", imgUrl: "", playerIds: [] },
  { id: 2, name: "", imgUrl: "", playerIds: [] }
]);

async function createTables() {
  console.log(
    `Attempting to create ${DB_POG_BADGES_TABLE} and ${DB_PLAYER_POG_BADGES_TABLE} tables`
  );

await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_POG_BADGES_TABLE} (
      id							SMALLINT PRIMARY KEY,
      name						TEXT NOT NULL,
      img_url					TEXT
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

  console.log(
    `Created ${DB_POG_BADGES_TABLE} and ${DB_PLAYER_POG_BADGES_TABLE} tables if didn't exist`
  );
}

async function populateTables() {
  console.log(`Populating ${DB_POG_BADGES_TABLE} and ${DB_PLAYER_POG_BADGES_TABLE} tables with initial values`);

  const pogBadgePromises = new Array<Promise<QueryResult<any>>>();
  for (const badge of POG_BADGES) {
    pogBadgePromises.push(
      client.query(
        `INSERT INTO ${DB_POG_BADGES_TABLE} (id, name, img_url) VALUES ($1, $2, $3) ON CONFLICT (id) UPDATE SET name = EXCLUDED.name, img_url = EXCLUDED.img_url`,
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
    await client.connect();
    await createTables();
    await populateTables();
  } catch (e) {
    console.error("Error creating tables:\n", e);
  } finally {
    await client.end();
  }
}

main()
