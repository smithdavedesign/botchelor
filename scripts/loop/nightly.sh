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
exec /usr/bin/caffeinate -i node scripts/loop/nightly.mjs >> "$HOME_DIR/logs/$(date +%F).log" 2>&1
