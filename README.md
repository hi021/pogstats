## welcome to pog!stats
The [osu!Stats](http://osustats.ppy.sh) of the lazer era.

## the what
Multitude of both live and historical osu!standard stats for leaderboard farmers.

This is a WIP back-end for [poggers](https://github.com/hi021/poggers) (also WIP), that:
- scrapes data (scores, users) from the osu! API,
- listens to the endpoint with all new osu! scores,
- processes them and persists relevant osu! scores that make it on the leaderboard updating all stats along the way,
- hosts a websocket with updates about all scores, snipes, and players,
- hosts an open JSON API for the poggers front-end with a bingibillion stats (docs will exist at some point...)

## the why
For years I've been running [poggers](https://poggers.moe) collecting historical data for osu! leaderboard rankings relying on osu!Stats' slow, unreliable, and limited API.\
This only let me access data for the top 150 users in one of the select 59 countries, completely disregarding the new osu!lazer leaderboards.

osu!'s API introduced an endpoint that broadcasts all achieved scores in the game, making a successor possible without the need for direct database access.

## the how
1. get a CSV dump of all currently ranked, loved, and approved beatmaps for osu!standard
    - convert into the right schema and upload it into postgres
2. TODO: beatmap-fetch: continuously listen to beatmap updates on the osu! beatmap events endpoint
3. scores-fetch: continuously listen to new scores on the osu! `/scores` endpoint
    - for any beatmap not in the database try respektive's osu-beatmap-db to avoid spamming osu! API (TODO: replace it with the osu! beatmap events endpoint from 2. for higher quality up-to-date data)
    - for any user not in the database fetch them from the osu! user lookup endpoint (TODO: may use respektive's score-rank-api for the top 10k players in ranked score)
    - TODO: surgically update ranking rollup and player ruleset stats tables with the new scores
    - TODO: figure out if restricted players' scores are broadcast on this endpoint
4. scrape all top 100 osu!standard scores for every map
5. pause scores-fetch and populate the ranking rollup and player ruleset stats tables
6. once a day check every player with a score in the top ~105 on any beatmap
    - update their data (usernames, flags, etc.)
    - check for (un)restrictions by marking the players not returned by the API as MIA
        - (un)hide their scores from the ranking (TODO: probably should re-scrape scores on all affected beatmaps to be safe)
7. make a bajilion cool rankings from the data and make them public via the API
8. save the rankings every day near midnight for cool historical charts
9. periodically re-run the scrape as a sanity check
10. finish poggers - the new front-end rewrite stuck in limbo since 2023

## the catch
- only works with osu!standard for now\
the code mostly supports other modes but I'm mostly limited on the infrastructure side - scraping all scores including converts would take over 9 days, not to mention the need to store 50 million+ more rows,
- there probably never will be an endpoint that lets you monitor user (un)restrictions in real time, so a full scrape that looks for such happens once a day. This means that the live stats may be ever so slightly off,
- this thing has to work with buttloads of data at once and, as mentioned, is limited by the puny 2 GB RAM/50 GB storage I have available for this entire project, so some stats (e.g. weighted pp) may be continuously updated in the background putting an asterisk next to the LIVE (also the server will explode if the API usage gets too high lol)

## the supply-chain attack vector
postgres 18 with timescaledb\
nodejs v26 (v22+ should work) with koa 3 and ws for the server\
hoping for valkey and a golang rewrite one day.. (EDIT: whoops this grew to be surprisingly complex I don't think I can do that)\

relies on:
- [osu! API v2](https://osu.ppy.sh/docs),
- ~~[osu-beatmap-database](https://github.com/respektive/osu-beatmap-database)~~ not for long...

repository mirror on [konacode](https://git.pek.li/hi/pogstats) 

---
Made with 💜 and LLMs for the boring parts
