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
if [ ! -f "$HOME_DIR/lock" ]; then
  git fetch -q origin && git checkout -q --detach origin/main
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
    exec /usr/bin/caffeinate -i node scripts/clips/daily-clip.mjs >> "$HOME_DIR/logs/clip.log" 2>&1 ;;
  *) echo "usage: run.sh crowd|report|clip" >&2; exit 2 ;;
esac
