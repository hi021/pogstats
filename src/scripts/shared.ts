import fs from "fs";
import path from "path";
import { Client } from "pg";
import readline from "readline";
import { OSU_API_VERSION, VERBOSE } from "./env.js";

export const API_BASE_URL = "https://osu.ppy.sh/api/v2";

export const DEFAULT_HEADERS = {
	Accept: "application/json",
	"Content-Type": "application/json",
	"X-API-Version": OSU_API_VERSION
};

export const buildHeadersWithAuth = (token: string) => {
	return {
		...DEFAULT_HEADERS,
		Authorization: `Bearer ${token}`
	};
};

export type FlagDefinition = Readonly<{ cli: string; description: string; takesValue: boolean }>;
export type FlagDefinitions = Readonly<Record<string, FlagDefinition>>;
export type ParsedFlags<Defs extends FlagDefinitions> = {
	[K in keyof Defs]?: Defs[K] extends { takesValue: true } ? string : boolean;
};

export function printHelp<Defs extends FlagDefinitions>(
	flagDefinitions: Defs,
	usageName = process.argv[1]?.split("/").at(-1) ?? ""
) {
	console.log(`Usage: node ${usageName} [flags]\n`);
	console.log("Optional flags:");
	for (const def of Object.values(flagDefinitions) as FlagDefinition[])
		console.log(`  ${def.cli.padEnd(24)} ${def.description}`);
	console.log("  --help                   Show this help message");
}

export function parseArgs<Defs extends FlagDefinitions>(
	argv: string[],
	flagDefinitions: Defs,
	options?: { onHelp?: () => void; usageName?: string }
): ParsedFlags<Defs> {
	const parsed = {} as ParsedFlags<Defs>;
	argv = argv.slice(2);

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help") {
			if (options?.onHelp) {
				options.onHelp();
				return parsed;
			}

			printHelp(flagDefinitions, options?.usageName);
			process.exit(0);
		}

		if (!arg.startsWith("--")) throw new Error(`Unexpected argument: '${arg}'`);

		const [flagName, maybeValue] = arg.slice(2).split("=", 2) as [string, string | undefined];
		if (!Object.prototype.hasOwnProperty.call(flagDefinitions, flagName))
			throw new Error(`Unknown flag: --${flagName}`);

		const key = flagName as keyof Defs;
		const def = flagDefinitions[key];
		if (def.takesValue) {
			const value = maybeValue ?? argv[++i];
			if (!value || value.startsWith("--")) throw new Error(`Missing value for flag: --${flagName}`);
			parsed[key] = value as ParsedFlags<Defs>[keyof Defs];
		} else {
			if (maybeValue) throw new Error(`Unexpected value for flag: --${flagName}`);
			parsed[key] = true as ParsedFlags<Defs>[keyof Defs];
		}
	}

	return parsed;
}

export function getMinDate(value: string | undefined) {
	if (!value) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error(`Invalid date for --minDate: ${value}`);

	return date;
}

export type TimestampAccessor = {
	get: () => number;
	set: (value: number) => void;
};

export async function rateLimit(accessor: TimestampAccessor, delayMs: number) {
	const now = Date.now();
	const lastFetchTimestamp = accessor.get();
	const elapsed = now - lastFetchTimestamp;
	if (lastFetchTimestamp > 0 && elapsed < delayMs) await new Promise(resolve => setTimeout(resolve, delayMs - elapsed));

	accessor.set(Date.now());
}

export const buildBeatmapScoresUrl = (
	beatmapId: number | string,
	params: BeatmapScoreParams = { mode: "osu", limit: 100 }
) => {
	const url = new URL(`${API_BASE_URL}/beatmaps/${beatmapId}/scores`);

	for (const [key, value] of Object.entries(params)) {
		if (value != null) url.searchParams.append(key, String(value));
	}

	return url;
};

export const buildUsersUrl = (userIds: Array<number | string>) => {
	const url = new URL(`${API_BASE_URL}/users`);
	url.searchParams.append("ids[]", userIds.join(","));
	return url;
};

export async function readFileByLine(filePath: string, lineCallback: (line: string, rowNo: number) => Promise<void>) {
	const fileStream = fs.createReadStream(filePath);
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity
	});

	let rowNo = 0;
	for await (const line of rl) await lineCallback(line, ++rowNo);
}

export function createLogStream(filePath: string) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	return fs.createWriteStream(filePath, { flags: "a", encoding: "utf-8" });
}

export function logInfo(stream: fs.WriteStream, message: string, timestamp = new Date().toISOString()) {
	const logMessage = `${timestamp} ${message}`;
	if (VERBOSE) console.log(logMessage);
	stream.write(`${logMessage}\n`);
}

export function logError(
	stream: fs.WriteStream,
	message: string,
	error?: unknown,
	timestamp = new Date().toISOString()
) {
	const logMessage = `${timestamp} ${message}\n$${Error.isError(error) ? (error.stack ?? error.message) : String(error)}`;
	if (VERBOSE) console.error(logMessage);
	stream.write(`${logMessage}\n`);
}

function csvEscape(value: unknown): string {
	if (value === null || value === undefined) return "";
	return typeof value === "object" ? `"${JSON.stringify(value).replace(/"/g, '""')}"` : String(value);
}

export async function dumpTableToCsv(
	tableName: string,
	columns: readonly string[],
	client: Client,
	infoLogStream?: fs.WriteStream,
	customQuery?: string,
	resultPath = "../../data"
) {
	const result = await client.query(customQuery || `SELECT * FROM ${tableName}`);
	const dumpFilePath = path.resolve(
		process.cwd(),
		resultPath,
		`${tableName}_table_dump_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`
	);
	fs.mkdirSync(path.dirname(dumpFilePath), { recursive: true });

	const stream = fs.createWriteStream(dumpFilePath, { encoding: "utf8" });
	stream.write(`${columns.join(",")}\n`);
	for (const row of result.rows) {
		const line = columns.map(column => csvEscape(row[column])).join(",");
		stream.write(`${line}\n`);
	}

	await new Promise<void>((resolve, reject) => {
		stream.on("finish", resolve);
		stream.on("error", reject);
		stream.end();
	});

	infoLogStream && logInfo(infoLogStream, `Dumped ${result.rows.length} rows from ${tableName} to ${dumpFilePath}`);
}
