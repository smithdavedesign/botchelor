#!/bin/zsh
# Installs the house crowd (docs/house-crowd.md) on this Mac: its own clone in ~/.botchelor-crowd/repo (launchd can't
# read ~/Documents), the roster of bots, and three launchd jobs: the crowd every 15 minutes, the weekly report on Mondays
# at 08:00 and the daily clip at 17:00 (local time). Re-run to update or to load a new roster.
#   scripts/crowd/install.sh [roster.json]     roster: [{ id, owner, name }] (default: .data/crowd30/portraits.json, else bots30.json)
#   scripts/crowd/install.sh --uninstall       removes the jobs (keeps ~/.botchelor-crowd: state, ledger, reports)
# Pause without uninstalling: touch ~/.botchelor-crowd/PAUSE (rm it to resume), or HOUSE_CROWD_PAUSED=1 on Vercel.
set -eu
HOME_DIR="${CROWD_HOME:-$HOME/.botchelor-crowd}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LABELS=(com.user.botchelor-crowd com.user.botchelor-crowd-report com.user.botchelor-clip)

if [ "${1:-}" = "--uninstall" ]; then
  for L in $LABELS; do
    launchctl bootout "gui/$(id -u)/$L" 2>/dev/null || true
    rm -f "$AGENTS/$L.plist"
  done
  echo "Uninstalled the house crowd's jobs (kept $HOME_DIR)."
  exit 0
fi

mkdir -p "$HOME_DIR/logs" "$AGENTS"
ROSTER="${1:-}"
if [ -z "$ROSTER" ]; then
  for f in "$REPO/.data/crowd30/portraits.json" "$REPO/.data/crowd30/bots30.json"; do
    if [ -f "$f" ]; then ROSTER="$f"; break; fi
  done
fi
if [ -z "$ROSTER" ] || [ ! -f "$ROSTER" ]; then
  echo "No roster: pass the bots' JSON, [{ id, owner, name }]." >&2
  exit 1
fi
node -e '
  const r = require(process.argv[1]).map(({ id, owner, name }) => ({ id, owner, name }));
  if (!r.length || r.some((b) => !b.id || !b.owner || !b.name)) { console.error("roster entries need id, owner and name"); process.exit(1); }
  require("fs").writeFileSync(process.argv[2], JSON.stringify(r, null, 1));
  console.log(`Roster: ${r.length} bots`);
' "$ROSTER" "$HOME_DIR/roster.json"

if [ ! -d "$HOME_DIR/repo/.git" ]; then
  git clone -q https://github.com/smithdavedesign/botchelor.git "$HOME_DIR/repo"
fi
git -C "$HOME_DIR/repo" fetch -q origin && git -C "$HOME_DIR/repo" checkout -q --detach origin/main

job() {
  local label=$1 mode=$2 when=$3
  cat > "$AGENTS/$label.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$HOME_DIR/repo/scripts/crowd/run.sh</string><string>$mode</string></array>
  $when
  <key>StandardOutPath</key><string>$HOME_DIR/logs/launchd.out</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/logs/launchd.err</string>
</dict>
</plist>
PL
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
}
job com.user.botchelor-crowd crowd "<key>StartInterval</key><integer>900</integer>"
job com.user.botchelor-crowd-report report "<key>StartCalendarInterval</key><dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>"
job com.user.botchelor-clip clip "<key>StartCalendarInterval</key><dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>0</integer></dict>"
cat <<DONE
Installed the house crowd: a pass every 15 minutes, the report Mondays 08:00, a clip daily 17:00 (clips in ~/BotchelorClips).
  Logs:    $HOME_DIR/logs     Reports: $HOME_DIR/reports
  Run now: launchctl kickstart gui/$(id -u)/com.user.botchelor-crowd   (or -report, or com.user.botchelor-clip)
  Pause:   touch $HOME_DIR/PAUSE      Uninstall: $REPO/scripts/crowd/install.sh --uninstall
DONE
