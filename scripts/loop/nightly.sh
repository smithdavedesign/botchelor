#!/bin/zsh
# launchd entry for Botchelor's self-improving loop (docs/self-improving-loop.md). Runs from the loop's own clone.
set -u
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
HOME_DIR="${LOOP_HOME:-$HOME/.botchelor-loop}"
mkdir -p "$HOME_DIR/logs"
cd "$HOME_DIR/repo" || exit 1
# Settings that outlive a reinstall (LOOP_VISITORS, LOOP_FIX, LOOP_MAX_FIXES, …); never keys, which come from the keychain.
[ -f "$HOME_DIR/env" ] && set -a && . "$HOME_DIR/env" && set +a
unset ANTHROPIC_API_KEY
# The newest loop code too, not only the app it builds (a change to nightly.mjs used to wait a run), unless another run
# holds the lock: it's running from this clone, so its files stay put (nightly.mjs then refuses the second run).
lock="$HOME_DIR/lock"
if [ ! -f "$lock" ] || ! kill -0 "$(cut -d' ' -f1 "$lock")" 2>/dev/null; then
  git fetch -q origin && git checkout -q --detach origin/main
fi
exec /usr/bin/caffeinate -i node scripts/loop/nightly.mjs >> "$HOME_DIR/logs/$(date +%F).log" 2>&1
