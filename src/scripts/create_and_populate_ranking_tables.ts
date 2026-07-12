import { ClientBase } from "pg";
import { withDbClientTransaction } from "../db-generic.js";
import { DB_RANKING_TYPES_TABLE } from "../env.js";
import {
	buildPositionThresholdCode,
	buildPositionThresholdName,
	RANKING_POS_THRESHOLDS,
	RULESET_IDS,
	toCapitalFirstLetter
} from "../shared.js";

interface ProtoRankingType {
	nameTemplate: string;
	codeTemplate: string;
}

const PROTO_RANKING_TYPES: Readonly<ProtoRankingType[]> = Object.freeze([
	{ nameTemplate: "%t% count", codeTemplate: "%t%" },
	{ nameTemplate: "Weighted %t% count", codeTemplate: "%t%-weighted" },
	{ nameTemplate: "Total %t% pp", codeTemplate: "%t%-total-pp" },
	{ nameTemplate: "Weighted %t% pp", codeTemplate: "%t%-weighted-pp" },
	{ nameTemplate: "%t% ranked score", codeTemplate: "%t%-ranked-score" },
	{ nameTemplate: "%t% SS count", codeTemplate: "%t%-ss" }
]);

function buildRankingTypes(protos: Readonly<ProtoRankingType[]>) {
	const baseIdMultiplier = 100;
	const rankingTypes: RankingType[] = [];

	for (const i in protos) {
		const proto = protos[i];
		const protoIndex = Number(i) * baseIdMultiplier;

		for (const j in RANKING_POS_THRESHOLDS) {
			const positionThreshold = RANKING_POS_THRESHOLDS[j];
			const positionThresholdIndex = Number(j) * RULESET_IDS.length;

			for (const k in RULESET_IDS) {
				const rulesetId = RULESET_IDS[k];
				const rulesetIndex = Number(k);

				const id = protoIndex + positionThresholdIndex + rulesetIndex + 1;
				const type: RankingType = {
					id,
					rulesetId,
					positionThreshold,
					name: toCapitalFirstLetter(
						proto.nameTemplate.replaceAll("%t%", buildPositionThresholdName(positionThreshold))
					),
					code: proto.codeTemplate.replaceAll("%t%", buildPositionThresholdCode(positionThreshold))
				};
				rankingTypes.push(type);
			}
		}
	}

	return rankingTypes;
}

async function createRankingTypesTable(client: ClientBase) {
	console.log(`Attempting to create ${DB_RANKING_TYPES_TABLE} table`);

	await client.query(`
    CREATE TABLE IF NOT EXISTS ${DB_RANKING_TYPES_TABLE} (
      id SMALLINT PRIMARY KEY,
			ruleset_id SMALLINT NOT NULL,
			position_threshold SMALLINT NOT NULL,
			name TEXT NOT NULL,
			code TEXT NOT NULL
    )`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS ${DB_RANKING_TYPES_TABLE}_ruleset_id_position_threshold ON ${DB_RANKING_TYPES_TABLE}(ruleset_id, position_threshold);
		CREATE UNIQUE INDEX IF NOT EXISTS ${DB_RANKING_TYPES_TABLE}_ruleset_id_code_idx ON ${DB_RANKING_TYPES_TABLE}(ruleset_id, code);`);

	console.log(`Created ${DB_RANKING_TYPES_TABLE} table if didn't exist`);
}

async function populateRankingTypesTable(client: ClientBase) {
	console.log(`Populating ${DB_RANKING_TYPES_TABLE} table with values`);
	const rankingTypes = buildRankingTypes(PROTO_RANKING_TYPES);

	const promises = new Array<Promise<void>>(rankingTypes.length);
	for (const rankingType of rankingTypes) {
		promises.push(
			(async () => {
				await client.query(
					`INSERT INTO ${DB_RANKING_TYPES_TABLE} (id, ruleset_id, position_threshold, name, code) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
					[rankingType.id, rankingType.rulesetId, rankingType.positionThreshold, rankingType.name, rankingType.code]
				);
			})()
		);
	}

	await Promise.all(promises);
	console.log(`Populated ${DB_RANKING_TYPES_TABLE} table with values`);
}

async function main() {
	try {
		await withDbClientTransaction(async client => {
			await createRankingTypesTable(client);
			await populateRankingTypesTable(client);
		});
	} catch (error) {
		console.error("Error creating ranking tables:\n", error);
	}
}

main();
