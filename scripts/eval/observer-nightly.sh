#!/bin/zsh
# The nightly After Dark observer (scripts/eval/observer-nightly.mjs) for launchd or the loop's nightly run. Run it from the
# loop's own clone (~/.botchelor-loop/repo: launchd can't read ~/Documents). DATABASE_URL comes from the Neon CLI and is
# never printed; the script opens every connection read-only. Extra arguments pass through (--hours 48, --no-post, …).
set -u
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "${0:A:h}/../.." || exit 1
if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(neon connection-string --profile davejobs-agent --project-id cool-boat-29098893 2>/dev/null)"
  if [ -z "$DATABASE_URL" ]; then
    echo "observer-nightly: no DATABASE_URL (neon connection-string --profile davejobs-agent failed)" >&2
    exit 1
  fi
  export DATABASE_URL
fi
exec node scripts/eval/observer-nightly.mjs "$@"
