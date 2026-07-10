// IMPORTANT:
// '\\\s*$\n'
// use this regex to check for maps with newlines in their tags that break this import
// just replace all instances with blank

import { dbPool } from "../db.js";
import { DB_BEATMAPS_TABLE } from "../env.js";
import { BEATMAP_TABLE_COLUMNS } from "../shared.js";
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
	Record<keyof Beatmap, { column: keyof ApiBeatmapDbBeatmap; type: "number" | "string" | "date" }>
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
	mode: { column: "mode", type: "number" },
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

function convertRowToBeatmap(row: string) {
	const columns = row.split(SEPARATOR);
	const beatmap: Partial<Beatmap> = {};

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

function buildBeatmapArrays(batch: Beatmap[]) {
	return {
		ids: batch.map(b => b.id),
		beatmapsetIds: batch.map(b => b.beatmapsetId),
		statuses: batch.map(b => b.status),
		artists: batch.map(b => b.artist),
		titles: batch.map(b => b.title),
		versions: batch.map(b => b.version),
		creators: batch.map(b => b.creator),
		creatorIds: batch.map(b => b.creatorId),
		modes: batch.map(b => b.mode),
		approvedDates: batch.map(b => b.approvedDate),
		starRatings: batch.map(b => b.starRating),
		totalLengths: batch.map(b => b.totalLength),
		bpms: batch.map(b => b.bpm),
		css: batch.map(b => b.cs),
		ods: batch.map(b => b.od),
		ars: batch.map(b => b.ar),
		hps: batch.map(b => b.hp),
		packs: batch.map(b => b.packs)
	};
}

async function insertBeatmapBatch(batch: Beatmap[]) {
	const arrays = buildBeatmapArrays(batch);

	// TODO DO UPDATE instead of DO NOTHING based on cli flag
	await dbPool.query(`
    INSERT INTO ${DB_BEATMAPS_TABLE} (${BEATMAP_TABLE_COLUMNS.join(", ")})
    SELECT *
    FROM UNNEST(
      $1::INTEGER[],
      $2::INTEGER[],
      $3::SMALLINT[],
      $4::TEXT[],
      $5::TEXT[],
      $6::TEXT[],
      $7::TEXT[],
      $8::INTEGER[],
      $9::SMALLINT[],
      $10::TIMESTAMPTZ[],
      $11::REAL[],
      $12::SMALLINT[],
      $13::REAL[],
      $14::REAL[],
      $15::REAL[],
      $16::REAL[],
      $17::REAL[],
      $18::TEXT[]
    ) ON CONFLICT (id) DO NOTHING`,
		[
			arrays.ids,
			arrays.beatmapsetIds,
			arrays.statuses,
			arrays.artists,
			arrays.titles,
			arrays.versions,
			arrays.creators,
			arrays.creatorIds,
			arrays.modes,
			arrays.approvedDates,
			arrays.starRatings,
			arrays.totalLengths,
			arrays.bpms,
			arrays.css,
			arrays.ods,
			arrays.ars,
			arrays.hps,
			arrays.packs
		]
	);
}

async function main() {
	const beatmaps: Beatmap[] = [];

	// TODO custom path via flag, option to truncate, option to skip 1st header row
	console.log("Reading osu! beatmap database dump...");
	await readFileByLine("../../data/osu-beatmap-db-dump.csv", async (row, rowNo) => {
		beatmaps.push(convertRowToBeatmap(row));
	});
	console.log(`Read ${beatmaps.length} beatmaps from the dump.`);

	for (let i = 0; i < beatmaps.length; i += BATCH_SIZE) {
		const batch = beatmaps.slice(i, i + BATCH_SIZE);
		await insertBeatmapBatch(batch);
		console.log(`Inserted ${i + batch.length} / ${beatmaps.length} beatmaps`);
	}

	console.log("Beatmap import done :)");
}

main();
