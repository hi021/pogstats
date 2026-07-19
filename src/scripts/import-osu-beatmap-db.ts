// IMPORTANT:
// '\\\s*$\n'
// use this regex to check for maps with newlines in their tags that break this import
// just replace all instances with blank

import { withDbClientTransaction } from "../db-generic.js";
import { upsertBeatmapBatch } from "../db.js";
import { DB_BEATMAPS_TABLE } from "../env.js";
import { readFileByLine } from "./shared.js";

const INPUT_COLUMNS: Readonly<Array<keyof ApiBeatmapDbBeatmap>> = Object.freeze([
	"beatmap_id",
	"beatmapset_id",
	"approved",
	"total_length",
	"hit_length",
	"version",
	"artist",
	"title",
	"creator",
	"creator_id",
	"mode",
	"cs",
	"od",
	"ar",
	"hp",
	"approved_date",
	"submitted_date",
	"last_updated_date",
	"bpm",
	"bpm_min",
	"bpm_max",
	"source",
	"tags",
	"genre_id",
	"language_id",
	"max_combo",
	"star_rating",
	"star_rating_aim",
	"star_rating_speed",
	"hit_objects",
	"num_circles",
	"num_sliders",
	"num_spinners",
	"favorites",
	"plays",
	"passes",
	"recalculate",
	"max_score",
	"packs",
	"rating",
	"video",
	"storyboard",
	"download_unavailable",
	"audio_unavailable",
	"file_md5",
	"eyup_star_rating",
	"max_score_fullmod"
] as const);

const OUTPUT_COLUMNS: Readonly<
	Record<keyof Omit<Beatmap, "updatedAt">, { column: keyof ApiBeatmapDbBeatmap; type: "number" | "string" | "date" }>
> = Object.freeze({
	id: { column: "beatmap_id", type: "number" },
	beatmapsetId: { column: "beatmapset_id", type: "number" },
	status: { column: "approved", type: "number" },
	totalLength: { column: "total_length", type: "number" },
	version: { column: "version", type: "string" },
	artist: { column: "artist", type: "string" },
	title: { column: "title", type: "string" },
	creator: { column: "creator", type: "string" },
	creatorId: { column: "creator_id", type: "number" },
	rulesetId: { column: "mode", type: "number" },
	cs: { column: "cs", type: "number" },
	od: { column: "od", type: "number" },
	ar: { column: "ar", type: "number" },
	hp: { column: "hp", type: "number" },
	approvedDate: { column: "approved_date", type: "date" },
	bpm: { column: "bpm", type: "number" },
	starRating: { column: "star_rating", type: "number" },
	packs: { column: "packs", type: "string" }
});

const INPUT_COLUMN_INDEX_BY_NAME = Object.freeze(
	INPUT_COLUMNS.reduce(
		(acc, columnName, index) => {
			acc[columnName] = index;
			return acc;
		},
		{} as Record<keyof ApiBeatmapDbBeatmap, number>
	)
);

const SEPARATOR = "\t";
const NULL_CHAR = "\\N";
const BATCH_SIZE = 15500;

function convertRowToBeatmap(row: string, updatedAt: Date) {
	const columns = row.split(SEPARATOR);
	const beatmap: Partial<Beatmap> = { updatedAt };

	for (const [key, { column, type }] of Object.entries(OUTPUT_COLUMNS)) {
		const index = INPUT_COLUMN_INDEX_BY_NAME[column];
		const value = columns[index];

		if (value == NULL_CHAR) {
			beatmap[key as keyof Beatmap] = undefined;
			continue;
		}

		switch (type) {
			case "number":
				beatmap[key as keyof Beatmap] = Number(value) as any;
				break;
			default:
			case "string":
				beatmap[key as keyof Beatmap] = value as any;
				break;
			case "date":
				beatmap[key as keyof Beatmap] = new Date(value) as any;
				break;
		}
	}

	return beatmap as Beatmap;
}

async function main() {
	const beatmaps: Beatmap[] = [];

	// TODO: the import seems to have the approved dates set 2h too early... not a huge deal, should be fixed with re-scraping....

	// TODO: should also filter out qualified maps (approved = 3) like scrape_beatmaps !!! tho this was just a one-time thing..

	// TODO custom path via flag, option to truncate db, option to skip 1st header row
	console.log("Reading osu! beatmap database dump...");
	const now = new Date();
	await readFileByLine("../../data/osu-beatmap-db-dump.csv", async (row, _) => beatmaps.push(convertRowToBeatmap(row, now)));
	console.log(`Read ${beatmaps.length} beatmaps from the dump.`);

	await withDbClientTransaction(async client => {
		for (let i = 0; i < beatmaps.length; i += BATCH_SIZE) {
			const batch = beatmaps.slice(i, i + BATCH_SIZE);
			await upsertBeatmapBatch(client, batch, DB_BEATMAPS_TABLE, "import_beatmap");
			console.log(`Inserted ${i + batch.length} / ${beatmaps.length} beatmaps`);
		}
	});

	console.log("Beatmap import done :)");
}

main();
