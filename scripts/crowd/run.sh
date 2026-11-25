#!/bin/zsh
# launchd entry for the house crowd (docs/house-crowd.md): run.sh crowd | report | clip. Runs from the crowd's own clone
# in ~/.botchelor-crowd/repo (launchd can't read ~/Documents), on the newest main.
set -u
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
HOME_DIR="${CROWD_HOME:-$HOME/.botchelor-crowd}"
MODE="${1:-crowd}"
mkdir -p "$HOME_DIR/logs"
cd "$HOME_DIR/repo" || exit 1
# Settings that outlive a reinstall (CROWD_BASE, CROWD_NIGHTLY_DATES, LOOP_CROWD_MODEL, …); never keys (the keychain has them).
[ -f "$HOME_DIR/env" ] && set -a && . "$HOME_DIR/env" && set +a
unset ANTHROPIC_API_KEY
# The newest code, unless a crowd pass is running from this clone right now (its lock): then the next tick updates.
# The clone is the jobs' own copy, so a change made in it (an `npm install` once rewrote package.json and the checkout
# refused every tick from 2026-11-13 to 11-19, so every job ran old code without a word) is kept in logs/ and set aside,
# and the system log hears of it; a failed update is logged too.
EMIT="$HOME/ai-stack/bin/emit-event"
note() { [ -x "$EMIT" ] && "$EMIT" botchelor crowd clone-update "$1" "$2" >/dev/null 2>&1; }
if [ ! -f "$HOME_DIR/lock" ]; then
  if ! git fetch -q origin; then
    note fail "git fetch failed in the crowd clone: the $MODE job runs the code it has"
  elif ! git checkout -q --detach origin/main 2>/dev/null; then
    kept="$HOME_DIR/logs/$(date +%Y-%m-%dT%H%M)-local-changes.diff"
    git diff > "$kept" 2>/dev/null
    if git checkout -q -f --detach origin/main; then
      note info "local changes in the crowd clone set aside to update (kept in $kept)"
    else
      note fail "the crowd clone can't move to origin/main: the $MODE job runs old code"
    fi
  fi
fi
case "$MODE" in
  crowd) exec node scripts/crowd/prod-crowd.mjs >> "$HOME_DIR/logs/launchd-crowd.log" 2>&1 ;;
  report) exec node scripts/crowd/weekly-report.mjs >> "$HOME_DIR/logs/report.log" 2>&1 ;;
  clip)
    # The clip needs playwright-core: the clone's dependencies, refreshed when the lockfile changes.
    sum=$(shasum package-lock.json | cut -d' ' -f1)
    if [ "$(cat "$HOME_DIR/.deps" 2>/dev/null)" != "$sum" ]; then
      npm ci --ignore-scripts --no-audit --no-fund >> "$HOME_DIR/logs/clip.log" 2>&1 && echo "$sum" > "$HOME_DIR/.deps"
    fi
    /usr/bin/caffeinate -i node scripts/clips/daily-clip.mjs >> "$HOME_DIR/logs/clip.log" 2>&1
    clip=$?
    # Sundays, after the day's clip: the week in review (scripts/clips/weekly-recap.mjs, docs/clips/weekly-recap.md),
    # sent to the show's /week and staged for the social loop. Its own log; whatever it does, the job's answer is the clip's.
    if [ "$(date +%u)" = 7 ]; then
      /usr/bin/caffeinate -i node scripts/clips/weekly-recap.mjs --upload --release >> "$HOME_DIR/logs/recap.log" 2>&1 || true
    fi
    exit $clip ;;
  *) echo "usage: run.sh crowd|report|clip" >&2; exit 2 ;;
esac
