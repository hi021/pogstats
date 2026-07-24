#!/bin/bash

minDate=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --minDate)
      minDate="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [[ ! -d "$HOME/pogstats" ]]; then
  echo "~/pogstats does not exist. Exiting."
  exit 2
fi

mkdir -p "$HOME/pogstats/data/logs"

echo "Running player scrape"
cd "$HOME/pogstats/target/scripts"

if [[ -n "$minDate" ]]; then
  echo "Using min date: $minDate"
  /home/hi/.local/share/fnm/aliases/default/bin/node scrape_players.js --minDate "$minDate" \
    1>"$HOME/pogstats/data/logs/scrape_players.log" \
    2>"$HOME/pogstats/data/logs/scrape_players_errors.log" &
else
  echo "No min date provided"
  /home/hi/.local/share/fnm/aliases/default/bin/node scrape_players.js \
    1>"$HOME/pogstats/data/logs/scrape_players.log" \
    2>"$HOME/pogstats/data/logs/scrape_players_errors.log" &
fi

disown
