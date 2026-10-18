#!/bin/zsh
# A visitor run on demand (npm run sim:visitors): the loop's run, now, from the loop's own clone, so it never touches
# this working copy. Visitors and triage only unless you pass LOOP_FIX=1. Any LOOP_* setting can be passed in.
#   npm run sim:visitors                      # 2 visitors, triage, no fixer
#   LOOP_VISITORS=3 LOOP_FIX=1 npm run sim:visitors
set -eu
HOME_DIR="${LOOP_HOME:-$HOME/.botchelor-loop}"
[ -d "$HOME_DIR/repo/.git" ] || { echo "No loop clone yet: run scripts/loop/install.sh first." >&2; exit 1; }
git -C "$HOME_DIR/repo" fetch -q origin && git -C "$HOME_DIR/repo" checkout -q --detach origin/main
export LOOP_FIX="${LOOP_FIX:-0}" LOOP_DEADLINE_MIN="${LOOP_DEADLINE_MIN:-120}"
echo "Visitor run from $HOME_DIR/repo ($(git -C "$HOME_DIR/repo" log --oneline -1)); fixer: $LOOP_FIX. Log: $HOME_DIR/logs/$(date +%F).log"
zsh "$HOME_DIR/repo/scripts/loop/nightly.sh"
latest=$(ls -td "$HOME_DIR"/runs/*/ | head -1)
echo "Done: $latest"; cat "$latest/summary.json"
