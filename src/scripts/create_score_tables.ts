import { Client } from "pg";
import {
	DB_BEATMAP_RULESET_UPDATE_DATES_TABLE,
	DB_BEATMAPS_TABLE,
	DB_HOST,
	DB_NAME,
	DB_PASSWORD,
	DB_PLAYERS_TABLE,
	DB_PORT,
	DB_SCORES_TABLE,
	DB_USER
} from "../env.js";

const client = new Client({
	host: DB_HOST,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASSWORD,
	database: DB_NAME
});

async function createScoreTables() {
	console.log(`Attempting to create ${DB_SCORES_TABLE} and ${DB_BEATMAP_RULESET_UPDATE_DATES_TABLE} tables`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_SCORES_TABLE} (
      position      						SMALLINT NOT NULL,
      is_scraped      					BOOLEAN NOT NULL,
      retrieved_at     					TIMESTAMPTZ NOT NULL,
      lazer      								BOOLEAN NOT NULL,
      is_perma      						BOOLEAN NOT NULL DEFAULT FALSE,
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
	// TODO: PARTITION BY ruleset_id if implementing other modes!

	await client.query(`
		COMMENT ON COLUMN ${DB_SCORES_TABLE}.position IS 'Meta (not from the API): 1-based position of the score on the beatmap';
		COMMENT ON COLUMN ${DB_SCORES_TABLE}.data IS 'mods, maximum_statistics, statistics columns from the API as JSONB';`);

	await client.query(`
		CREATE TABLE IF NOT EXISTS ${DB_BEATMAP_RULESET_UPDATE_DATES_TABLE} (
			beatmap_id 						INTEGER NOT NULL,
			mode SMALLINT 				NOT NULL,
			last_scores_scrape 		TIMESTAMPTZ,
			last_scores_update 		TIMESTAMPTZ,

			PRIMARY KEY (beatmap_id, mode),
			CONSTRAINT beatmap_mode_update_dates_beatmap_fk FOREIGN KEY(beatmap_id)
			REFERENCES ${DB_BEATMAPS_TABLE}(id)
		)`);
	await client.query(`
			COMMENT ON COLUMN ${DB_BEATMAP_RULESET_UPDATE_DATES_TABLE}.last_scores_scrape IS 'Meta: time of the last score scraper run over this map';
			COMMENT ON COLUMN ${DB_BEATMAP_RULESET_UPDATE_DATES_TABLE}.last_scores_update IS 'Meta: time of the last update for the map from scores-ws';`);

	// TODO: verify performance, maybe add JSONB GIN, score, pp, grade after verifying ranking queries
	// ? CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_beatmap_ruleset_position_idx ON ${DB_SCORES_TABLE}(beatmap_id, ruleset_id, position);
	// ? MIA scores index? (position, user_id) WHERE position = 0?
	await client.query(
		`CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_beatmap_id_ruleset_id_idx 	ON ${DB_SCORES_TABLE} (beatmap_id, ruleset_id);
     CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_user_id_position_idx 			ON ${DB_SCORES_TABLE} (user_id, position);
     CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_beaten_scores_idx 					ON ${DB_SCORES_TABLE} (beatmap_id, ruleset_id, total_score DESC, position) WHERE position BETWEEN 1 AND 100;
		 CREATE INDEX IF NOT EXISTS ${DB_SCORES_TABLE}_position_brin_idx 					ON ${DB_SCORES_TABLE} USING BRIN (position);`
	);

	console.log(`Created ${DB_SCORES_TABLE} and ${DB_BEATMAP_RULESET_UPDATE_DATES_TABLE} tables if didn't exist`);
}

async function main() {
	try {
		await client.connect();
		await createScoreTables();
	} catch (e) {
		console.error("Error creating tables:\n", e);
	} finally {
		await client.end();
	}
}

main();
