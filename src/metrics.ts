import type { Middleware } from "koa";
import type { ClientBase, QueryResult } from "pg";
import prom from "prom-client";

const metricsRegistry = new prom.Registry();
prom.collectDefaultMetrics({ register: metricsRegistry, prefix: "pogstats_", eventLoopMonitoringPrecision: 25 });

const httpRequestDuration = new prom.Histogram({
	name: "pogstats_http_request_duration_ms",
	help: "Duration of inbound HTTP requests in ms",
	labelNames: ["route", "status_code", "origin"] as const,
	buckets: [2, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 12500],
	registers: [metricsRegistry]
});

const dbQueryDuration = new prom.Histogram({
	name: "pogstats_db_query_duration_ms",
	help: "Duration of database queries in ms",
	labelNames: ["query", "source"] as const,
	buckets: [1, 3, 10, 25, 50, 100, 250, 500, 1250, 3750, 10000],
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

const scoreBatchCount = new prom.Histogram({
	name: "pogstats_score_batch_count",
	help: "Counts of score batches and proven score counts from scores-ws",
	labelNames: ["type"] as const,
	buckets: [1, 5, 15, 250, 1000, 1500, 2000, 37500, 100000],
	registers: [metricsRegistry]
});

const errorLogCounter = new prom.Counter({
	name: "pogstats_error_log_total",
	help: "Count of error messages logged for Grafana",
	labelNames: ["source", "message"] as const,
	registers: [metricsRegistry]
});

export function recordErrorLog(source: string, message: string) {
	errorLogCounter.labels({ source: normalizeLabel(source), message: safeErrorLabel(message) }).inc();
}

export function recordMissingEntity(type: "player" | "beatmap", count = 1) {
	missingEntityCounter.labels({ type }).inc(count);
}

export function recordScoreBatchCounts(totalScores: number, provenScores: number) {
	scoreBatchCount.labels({ type: "total" }).observe(totalScores);
	scoreBatchCount.labels({ type: "proven" }).observe(provenScores);
}

export function timeDbQuery<T>(queryName: string, source: string, callback: () => Promise<T>): Promise<T> {
	const timer = dbQueryDuration.startTimer({
		query: normalizeLabel(queryName),
		source: normalizeLabel(source)
	});

	return callback().finally(() => timer());
}

export async function queryWithTiming<T extends Record<string, unknown> = Record<string, unknown>>(
	client: ClientBase,
	query: string,
	values: unknown[],
	queryName: string,
	source: string
): Promise<QueryResult<T>> {
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
	source: string,
	route = "unknown"
) {
	const start = process.hrtime.bigint();
	let statusCode = "error";

	try {
		const res = await fetch(request, init);
		statusCode = String(res.status);
		return res;
	} finally {
		const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
		outboundRequestDuration
			.labels({
				route: normalizeLabel(route),
				status_code: statusCode,
				source: normalizeLabel(source)
			})
			.observe(durationMs);
	}
}

export const requestMetricsMiddleware: Middleware = async (ctx, next) => {
	const start = process.hrtime.bigint();
	await next();
	const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
	const statusCode = String(ctx.status || 404);
	const origin = classifyOrigin(ctx.request.headers["user-agent"]);

	httpRequestDuration
		.labels({
			route: normalizeLabel(ctx.path, ctx.path),
			status_code: statusCode,
			origin
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

function safeErrorLabel(message: string) {
	return normalizeLabel(message.replace(/\s+/g, " "), "unknown_error");
}

export { metricsRegistry };
