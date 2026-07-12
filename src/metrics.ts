import prom from "prom-client";
import Koa from "koa";

// 1. public API request duration metric
// measure how long a given inbound API request takes over time (for pog-ws.ts and pog-api.ts; possibly using koa-response-time)
// labels: route, status_code, origin (either based on the IP or user-agent)

// 2. database query duration metric
// measure how long a given db query takes over time
// labels: query (name, probably from the function calling it), source (either pog-api, pog-ws, or script name, e.g. 'scrape_players')

// 3. outbound API request duration metric
// measure how long a given outbound API request takes over time
// labels: route, status_code, source (either pog-api, pog-ws, or script name, e.g. 'scrape_players')

// 4. scores-ws.ts score count over time metric
// count how many total scores come in per batch and how many of them are proven to be in top 100 for the map (returned from getBeatenScoresByMap)
// labels: is_proven (boolean)

// 5. scores-ws.ts missing player and beatmap over time metric
// count how many missingIds are found in fetchNewBeatmaps and fetchNewPlayers

// 6. error log that lets the app show custom error messages on grafana

// use esnext (es2026) and typescript 6 syntax
// go easy on the comments
// try to limit the amount of external dependencies

// exported helper prometheus observer functions
// use reusable and maintainable Koa middleware and functions where possible

// register default nodejs resource usage metrics
// register custom metrics

// expose /metrics using koa (or koa-router)
// configurable port via .env and env.ts

// explain how a grafana dashboard could be created to visualize this prometheus data
// suggest any potential improvements based on the app architecture
