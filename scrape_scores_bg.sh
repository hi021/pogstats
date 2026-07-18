#! /bin/bash

minDate='2026-07-16'
echo "Running score scrape with min date: $minDate"
cd ~/pogstats/target/scripts
node scrape_scores.js --skipDump --minDate ${minDate} 1>/dev/null 2>/dev/null & disown
