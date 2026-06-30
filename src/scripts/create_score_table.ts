import { Client } from "pg";
import {
	DB_BEATMAPS_TABLE,
	DB_HOST,
	DB_NAME,
	DB_PASSWORD,
	DB_PLAYERS_TABLE,
	DB_PORT,
	DB_SCORES_TABLE,
	DB_USER
} from "./env.js";

const client = new Client({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME
});

async function createScoresTable() {
	console.log(`Attempting to create ${DB_SCORES_TABLE} table with indexes and comments`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_SCORES_TABLE} (
      position      						SMALLINT NOT NULL,
      is_scraped      					BOOLEAN NOT NULL,
      retrieved_at     					TIMESTAMPTZ NOT NULL,
      lazer      								BOOLEAN NOT NULL,
      id                  			BIGINT PRIMARY KEY DEFERRABLE INITIALLY DEFERRED,
      user_id             			INTEGER NOT NULL,
      ruleset_id          			SMALLINT NOT NULL,
      beatmap_id          			BIGINT NOT NULL,
      has_replay          			BOOLEAN NOT NULL DEFAULT FALSE,
      grade                			CHAR(2) NOT NULL DEFAULT '',
      accuracy            			REAL NOT NULL DEFAULT 0,
      max_combo           			INTEGER NOT NULL DEFAULT 0,
      total_score         			INTEGER NOT NULL DEFAULT 0,
      classic_total_score 			BIGINT,
      total_score_without_mods 	INTEGER,
      is_perfect_combo    			BOOLEAN,
      legacy_perfect      			BOOLEAN,
      pp                 				REAL,
      legacy_total_score  			BIGINT NOT NULL DEFAULT 0,
      ended_at            			TIMESTAMPTZ NOT NULL,
      data               			 	JSONB NOT NULL DEFAULT '{}'::jsonb,

      CONSTRAINT score_beatmap_fk FOREIGN KEY (beatmap_id)
      REFERENCES ${DB_BEATMAPS_TABLE}(id),
      CONSTRAINT score_user_fk FOREIGN KEY (user_id)
      REFERENCES ${DB_PLAYERS_TABLE}(id)
    )`);
	// could also add unique constraints to user_id + beatmap_id + ruleset_id and position + beatmap_id + ruleset_id

	// TODO: verify performance, maybe add JSONB GIN, score, pp, rank (after adding other rankings)
	// CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_beatmap_ruleset_position_idx ON ${DB_SCORES_TABLE}(beatmap_id, ruleset_id, position);
	await client.query(
		`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_beatmap_id_ruleset_id_idx ON ${DB_SCORES_TABLE}(beatmap_id, ruleset_id);
     CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_user_id_position_idx ON ${DB_SCORES_TABLE}(user_id, position);
     CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_beaten_scores_idx ON ${DB_SCORES_TABLE}(beatmap_id, ruleset_id, total_score DESC, position) WHERE position <= 100;`
	);

	await client.query(
		`COMMENT ON COLUMN ${DB_SCORES_TABLE}.position IS 'Meta (not from the API): 1-based position of the score on the beatmap';
     COMMENT ON COLUMN ${DB_SCORES_TABLE}.data IS 'mods, maximum_statistics, statistics columns from the API as JSONB';`
	);
	console.log(`Created ${DB_SCORES_TABLE} table if didn't exist`);
}

async function main() {
	try {
		await client.connect();
		await createScoresTable();
	} catch (e) {
		console.error("Error creating table:\n", e);
	} finally {
		await client.end();
	}
}

main();
