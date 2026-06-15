import prom from "prom-client";
import Koa from "koa";

// use esnext (es2026) and typescript 6 syntax
// go easy on the comments

// 1. public API request duration metric
// measure how long a given inbound API request takes over time (for pog-ws.ts and pog-api.ts)
// labels: route, status_code, origin

// 2. database query duration metric
// measure how long a given db query takes over time
// labels: query, source (either pog-api, pog-ws, or script name, e.g. 'scrape_players')

// 3. outbound API request duration metric
// measure how long a given outbound API request takes over time
// labels: route, status_code, source (either pog-api, pog-ws, or script name, e.g. 'scrape_players')

// 4. scores-ws.ts score count over time metric
// count how many total scores come in per batch and how many of them get filtered out
// labels: is_candidate

// exported helper prometheus observer functions
// use reusable Koa middleware where possible

// register default resource usage metrics
// register custom metrics

// expose /metrics using koa
// configurable port via .env and env.ts

// explain how a grafana dashboard could be created to visualize this prometheus data
// suggest any potential improvements based on the app architecture
