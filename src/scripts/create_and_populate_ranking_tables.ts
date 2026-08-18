import { ClientBase } from "pg";
import { withDbClientTransaction } from "../db-generic.js";
import {
	DB_SCORES_TABLE,
	DB_CONFIG_TABLE,
	DB_POSITION_WEIGHTS_TABLE,
	DB_RANKING_ROLLUP_TABLE,
	DB_RECALC_QUEUE_TABLE,
	DB_PLAYER_RULESET_STATS_TABLE,
	DB_BEATMAPS_TABLE,
	DB_PLAYERS_TABLE
} from "../env.js";

// TODO: !! log the number of users waiting per operation_type in scores-fetch or somewhere
async function createRankingTables(client: ClientBase) {
	console.log(`Attempting to create ${DB_POSITION_WEIGHTS_TABLE}, ${DB_RANKING_ROLLUP_TABLE}, ${DB_RECALC_QUEUE_TABLE} tables`);

	await client.query(`
		CREATE TABLE IF NOT EXISTS ${DB_POSITION_WEIGHTS_TABLE} (
			position 	SMALLINT PRIMARY KEY,
			weight 		REAL NOT NULL
		);

		CREATE TABLE IF NOT EXISTS ${DB_RANKING_ROLLUP_TABLE} (
			user_id 							INTEGER NOT NULL,
			ruleset_id						SMALLINT NOT NULL,
			position							SMALLINT NOT NULL,

			count									INTEGER NOT NULL DEFAULT 0,
			count_perma						INTEGER NOT NULL DEFAULT 0,
			count_ss							INTEGER NOT NULL DEFAULT 0,
			count_lazer						INTEGER NOT NULL DEFAULT 0,
			ranked_score					BIGINT NOT NULL DEFAULT 0,
			total_pp							INTEGER NOT NULL DEFAULT 0,
			avg_acc								REAL NOT NULL DEFAULT 0,
			avg_map_len						REAL NOT NULL DEFAULT 0,
			
			PRIMARY KEY (user_id, ruleset_id, position),
			CONSTRAINT ranking_rollup_user_fk FOREIGN KEY(user_id) REFERENCES ${DB_PLAYERS_TABLE} (id)
		);

		CREATE TABLE IF NOT EXISTS ${DB_RECALC_QUEUE_TABLE} (
			user_id 							INTEGER PRIMARY KEY,
			queued_at 						TIMESTAMPTZ DEFAULT NOW(),
			operation_type				TEXT NOT NULL
		);`);

	console.log(`Created ${DB_POSITION_WEIGHTS_TABLE}, ${DB_RANKING_ROLLUP_TABLE}, ${DB_RECALC_QUEUE_TABLE} if didn't exist`);
}

async function scheduleDbQueue(client: ClientBase) {
	await client.query(`
		CREATE OR REPLACE FUNCTION process_weighted_pp_recalc_queue()
		RETURNS void
		LANGUAGE plpgsql
		AS $$
		DECLARE
			v_lock_id CONSTANT BIGINT := 74809284739; 
			v_processed_count INTEGER;
		BEGIN
			IF pg_try_advisory_lock(v_lock_id) THEN
					BEGIN
						WITH batch AS (
							SELECT user_id
							FROM ${DB_RECALC_QUEUE_TABLE}
							WHERE operation_type = 'weighted_pp'
							ORDER BY queued_at ASC
							LIMIT 3000
							FOR UPDATE SKIP LOCKED
						),
						deleted_batch AS (
							DELETE FROM ${DB_RECALC_QUEUE_TABLE}
							WHERE user_id IN (SELECT user_id FROM batch)
							RETURNING user_id
						),
						recalculated AS (
							SELECT
								d.user_id,
								COALESCE(calc_weighted_pp_ordered(s.pp ORDER BY s.pp DESC NULLS LAST), 0) AS new_weighted_pp
							FROM deleted_batch d
							LEFT JOIN ${DB_SCORES_TABLE} s ON s.user_id = d.user_id 
																						 AND s.ruleset_id = 0 
																						 AND s.position BETWEEN 1 AND 100
							GROUP BY d.user_id
						)
						UPDATE ${DB_PLAYER_RULESET_STATS_TABLE} p
						SET weighted_pp = r.new_weighted_pp
						FROM recalculated r
						WHERE p.id = r.user_id AND p.ruleset_id = 0;

						GET DIAGNOSTICS v_processed_count = ROW_COUNT;
						IF v_processed_count > 0 THEN
							UPDATE ${DB_CONFIG_TABLE} 
							SET last_weighted_pp_recalc = NOW();
						END IF;
	
					EXCEPTION WHEN OTHERS THEN
						PERFORM pg_advisory_unlock(v_lock_id);
						RAISE;
					END;
	
					PERFORM pg_advisory_unlock(v_lock_id);
			ELSE
					RAISE NOTICE 'Weighted PP recalc queue processing already in progress. Skipping this cycle.';
			END IF;
		END;
		$$;

		SELECT cron.schedule(
			'process_weighted_pp_queue_job',
			'*/5 * *high * *',
			'SELECT process_weighted_pp_recalc_queue();'
		);
	`);
}

// watch out! this takes a while, even for standard only
async function populateRankingTables(client: ClientBase) {
	console.log(`Populating ${DB_POSITION_WEIGHTS_TABLE}, ${DB_RANKING_ROLLUP_TABLE} tables`);

	await client.query(`
		INSERT INTO ${DB_POSITION_WEIGHTS_TABLE} (position, weight) VALUES
			(1,1),
			(2,0.99159),
			(3,0.98250416),
			(4,0.97270314),
			(5,0.96214865),
			(6,0.95080362),
			(7,0.93863287),
			(8,0.92560391),
			(9,0.9116878),
			(10,0.89686005),
			(11,0.88110161),
			(12,0.86439989),
			(13,0.84674974),
			(14,0.82815445),
			(15,0.80862663),
			(16,0.78818899),
			(17,0.76687497),
			(18,0.74472917),
			(19,0.72180751),
			(20,0.69817709),
			(21,0.67391582),
			(22,0.64911162),
			(23,0.62386136),
			(24,0.59826954),
			(25,0.57244658),
			(26,0.546507),
			(27,0.52056742),
			(28,0.49474446),
			(29,0.46915264),
			(30,0.44390238),
			(31,0.41909818),
			(32,0.39483691),
			(33,0.37120649),
			(34,0.34828483),
			(35,0.32613903),
			(36,0.30482501),
			(37,0.28438737),
			(38,0.26485955),
			(39,0.24626426),
			(40,0.22861411),
			(41,0.21191239),
			(42,0.19615395),
			(43,0.1813262),
			(44,0.16741009),
			(45,0.15438113),
			(46,0.14221038),
			(47,0.13086535),
			(48,0.12031086),
			(49,0.11050984),
			(50,0.101424),
			(51,0.09301445),
			(52,0.08524223),
			(53,0.07806876),
			(54,0.07145615),
			(55,0.06536758),
			(56,0.05976745),
			(57,0.05462158),
			(58,0.04989737),
			(59,0.04556382),
			(60,0.04159164),
			(61,0.03795319),
			(62,0.03462256),
			(63,0.03157546),
			(64,0.02878925),
			(65,0.0262428),
			(66,0.02391654),
			(67,0.02179226),
			(68,0.01985317),
			(69,0.0180837),
			(70,0.01646952),
			(71,0.01499742),
			(72,0.01365523),
			(73,0.01243177),
			(74,0.01131678),
			(75,0.01030084),
			(76,0.00937531),
			(77,0.00853229),
			(78,0.00776452),
			(79,0.0070654),
			(80,0.00642885),
			(81,0.00584934),
			(82,0.00532181),
			(83,0.00484165),
			(84,0.00440463),
			(85,0.00400692),
			(86,0.00364499),
			(87,0.00331566),
			(88,0.003016),
			(89,0.00274335),
			(90,0.0024953),
			(91,0.00226963),
			(92,0.00206433),
			(93,0.00187756),
			(94,0.00170767),
			(95,0.00155313),
			(96,0.00141256),
			(97,0.00128469),
			(98,0.00116839),
			(99,0.0010626),
			(100,0.00096639)
		ON CONFLICT (position) DO UPDATE SET weight = EXCLUDED.weight;
		`);

	await client.query(`
		INSERT INTO ${DB_RANKING_ROLLUP_TABLE} (
		    user_id, ruleset_id, position, count, count_perma, count_ss, 
		    count_lazer, ranked_score, total_pp, avg_acc, avg_map_len
		)
		SELECT
		    s.user_id,
		    s.ruleset_id,
		    s.position,
		    COUNT(*)::INTEGER AS count,
		    COUNT(*) FILTER (WHERE s.is_perma)::INTEGER AS count_perma,
		    COUNT(*) FILTER (WHERE s.grade IN ('XH', 'X'))::INTEGER AS count_ss,
		    COUNT(*) FILTER (WHERE s.is_lazer)::INTEGER AS count_lazer,
		    SUM(COALESCE(s.classic_total_score, 0))::BIGINT AS ranked_score,
		    SUM(COALESCE(s.pp, 0))::INTEGER AS total_pp,
		    AVG(s.accuracy)::FLOAT AS avg_acc,
		    AVG(b.total_length)::FLOAT AS avg_map_len
		FROM ${DB_SCORES_TABLE} s
			JOIN ${DB_BEATMAPS_TABLE} b ON s.beatmap_id = b.id
		WHERE s.position BETWEEN 1 AND 100
		GROUP BY s.user_id, s.ruleset_id, s.position
		ON CONFLICT (user_id, ruleset_id, position) DO UPDATE SET
		    count = EXCLUDED.count,
		    count_perma = EXCLUDED.count_perma,
		    count_ss = EXCLUDED.count_ss,
		    count_lazer = EXCLUDED.count_lazer,
		    ranked_score = EXCLUDED.ranked_score,
		    total_pp = EXCLUDED.total_pp,
		    avg_acc = EXCLUDED.avg_acc,
		    avg_map_len = EXCLUDED.avg_map_len;
	`);

	console.log(`Populated ${DB_POSITION_WEIGHTS_TABLE}, ${DB_RANKING_ROLLUP_TABLE} tables`);
}

async function main() {
	await withDbClientTransaction(async client => {
		await createRankingTables(client);
		await populateRankingTables(client);
		await scheduleDbQueue(client);
	});
}

main();
