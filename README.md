## welcome to pog!stats
The [osu!Stats](http://osustats.ppy.sh) of the lazer era.

## the what
This is a WIP back-end for [poggers](https://github.com/hi021/poggers), that:
- scrapes data (scores, users) from the osu! API,
- listens to a websocket with all new osu! scores,
- hosts a websocket for relevant osu! scores that make it on the leaderboard,
- hosts a JSON API for the poggers front-end

## the why
For years I've been running [poggers](https://poggers.moe) collecting historical data for osu! leaderboard rankings relying on osu!Stats' slow, unreliable, and limited API.\
This only let me access data for the top 150 users in one of the select 59 countries, completely disregarding the new osu!lazer leaderboards.

osu!'s API introduced an endpoint that broadcasts all achieved scores in the game, making a successor possible without the need for direct database access.

## the how
The plan is to:
1. get a CSV dump of all currently ranked, loved, and approved beatmaps and beatmapsets for osu! standard
    - convert it into the right schema and upload it into postgres
2. scrape all top 100 scores for each map
3. continuously listen to new scores on ushio
    - for any beatmap not in the database try respektive's osu-beatmap-db to avoid spamming osu! API
    - for any user not in the database try respektive's osu-score-rank-api for the top 10k in ranked score ranking or osu! API otherwise
4. make a bajilion cool rankings from the data
5. save the rankings every day near midnight
6. periodically re-run the scrape for sanity checks and any removed scores (can use the bulk users endpoint from osu! API to check for restrictions)

## the supply-chain attack vector
postgres 18 + nodejs v26 with koa 3\
hoping for valkey and golang one day..\
relies on:
- [osu! API v2](https://osu.ppy.sh/docs),
- [osu-beatmap-database](https://github.com/respektive/osu-beatmap-database),
- [osu-score-rank-api](https://github.com/respektive/osu-score-rank-api),
- [ushio (Chiffa's Score Socket™️)](https://github.com/arewelazeryet/ushio)

repository mirror on [konacode](https://git.pek.li/hi/pogstats) 

---
Made with 💜 and LLMs for the boring parts...
