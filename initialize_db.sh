#! /bin/bash

cd target/scripts &&
node create_misc_db_stuff.js &&
node create_and_populate_config_table.js &&
node create_player_table.js &&
node create_and_populate_pog_badge_table.js &&
node create_beatmap_table.js &&
node create_score_tables.js &&
node create_and_populate_ranking_tables.js
