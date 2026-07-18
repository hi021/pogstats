import type { Middleware } from "koa";
import type { ClientBase, QueryResult, QueryResultRow } from "pg";
import prom from "prom-client";

// TODO: seems like this only registers metrics for the webserver but not score scrape script
export const metricsRegistry = new prom.Registry();
prom.collectDefaultMetrics({ register: metricsRegistry, prefix: "pogstats_", eventLoopMonitoringPrecision: 25 });

const httpRequestDuration = new prom.Histogram({
	name: "pogstats_http_request_duration_ms",
	help: "Duration of inbound HTTP requests in ms",
	labelNames: ["route", "status_code", "origin"] as const,
	buckets: [2, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 12500],
	registers: [metricsRegistry]
});

const dbQueryDuration = new prom.Histogram({
	name: "pogstats_db_query_duration_s",
	help: "Duration of database queries in seconds",
	labelNames: ["query", "source"] as const,
	buckets: [0.001, 0.003, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.25, 3.75, 10],
	registers: [metricsRegistry]
});

const outboundRequestDuration = new prom.Histogram({
	name: "pogstats_outbound_request_duration_ms",
	help: "Duration of outbound HTTP requests in ms",
	labelNames: ["route", "status_code", "source"] as const,
	buckets: [2, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 12500],
	registers: [metricsRegistry]
});

const missingEntityCounter = new prom.Counter({
	name: "pogstats_missing_entity_total",
	help: "Count of missing player and beatmap ids discovered during processing",
	labelNames: ["type"] as const,
	registers: [metricsRegistry]
});

export const scoreBatchDuration = new prom.Histogram({
	name: "pogstats_score_batch_duration_s",
	help: "How long it takes to process a score batch in seconds",
	buckets: [0.25, 1, 2, 5, 10, 25, 60],
	labelNames: ["success", "batchNo"],
	registers: [metricsRegistry]
});

const scoreBatchCount = new prom.Histogram({
	name: "pogstats_score_batch_count",
	help: "Counts of score batches and proven score counts from scores-ws",
	labelNames: ["type"] as const,
	buckets: [1, 5, 15, 250, 1000, 1500, 2000, 37500, 100000],
	registers: [metricsRegistry]
});

export function recordMissingEntity(type: "player" | "beatmap", count = 1) {
	missingEntityCounter.labels({ type }).inc(count);
}

export function recordScoreBatchCounts(totalScores: number, provenScores: number) {
	scoreBatchCount.labels({ type: "total" }).observe(totalScores);
	scoreBatchCount.labels({ type: "proven" }).observe(provenScores);
}

export function timeDbQuery<T extends Record<string, unknown>>(
	queryName: string,
	source: ActionSource,
	callback: () => Promise<QueryResult<T>>
) {
	const timer = dbQueryDuration.startTimer({
		query: normalizeLabel(queryName),
		source: normalizeLabel(source)
	});

	return callback().finally(() => timer());
}

export async function queryWithTiming<T extends QueryResultRow>(
	client: ClientBase,
	queryName: string,
	source: ActionSource,
	query: string,
	values: unknown[] = []
) {
	const timer = dbQueryDuration.startTimer({
		query: normalizeLabel(queryName),
		source: normalizeLabel(source)
	});

	try {
		return await client.query<T>(query, values);
	} finally {
		timer();
	}
}

export async function timedFetch(
	request: string | URL,
	init: RequestInit | undefined,
	source: ActionSource,
	route = "unknown"
) {
	const start = process.hrtime.bigint();
	let statusCode = "error";

	try {
		const res = await fetch(request, init);
		statusCode = String(res.status);
		return res;
	} finally {
		const durationMs = Number(process.hrtime.bigint() - start) / 1e9;
		outboundRequestDuration
			.labels({
				route: normalizeLabel(route),
				status_code: statusCode,
				source: normalizeLabel(source)
			})
			.observe(durationMs);
	}
}

export const requestTimingMiddleware: Middleware = async (ctx, next) => {
	const start = process.hrtime.bigint();
	await next();
	const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

	httpRequestDuration
		.labels({
			route: normalizeLabel(ctx.path),
			status_code: String(ctx.status || 404),
			origin: classifyOrigin(ctx.request.headers["user-agent"])
		})
		.observe(durationMs);
};

export const metricsMiddleware: Middleware = async (ctx, next) => {
	if (ctx.method != "GET" || ctx.path != "/metrics") return await next();

	ctx.set("Content-Type", metricsRegistry.contentType);
	ctx.body = await metricsRegistry.metrics();
};

function normalizeLabel(value: string | undefined, fallback = "unknown") {
	const label = value?.trim();
	if (!label) return fallback;
	return label.length <= 128 ? label : `${label.slice(0, 125)}...`;
}

function classifyOrigin(userAgent?: string | string[]) {
	const ua = Array.isArray(userAgent) ? userAgent[0] : userAgent;
	if (!ua) return "unknown";
	if (ua.startsWith("Mozilla/5.0")) return "browser";

	const hostMatch = ua.match(/https?:\/\/([^/ )]+)/i);
	if (hostMatch?.[1]) return normalizeLabel(hostMatch[1]);

	const plusMatch = ua.match(/\+\s*([^ )]+)/);
	if (plusMatch?.[1]) return normalizeLabel(plusMatch[1]);

	const token = ua.split(" ")[0];
	return normalizeLabel(token);
}
