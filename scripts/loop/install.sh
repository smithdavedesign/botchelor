#!/bin/zsh
# Installs Botchelor's self-improving loop (docs/self-improving-loop.md): its own clone in ~/.botchelor-loop/repo
# (launchd can't read ~/Documents) and a launchd job at 06:10 local, after RepoHQ's last factory cycle (06:00) and
# its 06:45 email starting, and done by 08:50, before RepoHQ's 09:00 research. Re-run to update; uninstall with
#   launchctl bootout gui/$(id -u)/com.user.botchelor-loop && rm ~/Library/LaunchAgents/com.user.botchelor-loop.plist
set -eu
HOME_DIR="${LOOP_HOME:-$HOME/.botchelor-loop}"
HOUR="${LOOP_HOUR:-6}"
MINUTE="${LOOP_MINUTE:-10}"
LABEL=com.user.botchelor-loop
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME_DIR/logs" "$HOME_DIR/runs"
if [ ! -d "$HOME_DIR/repo/.git" ]; then
  git clone -q https://github.com/smithdavedesign/botchelor.git "$HOME_DIR/repo"
fi
git -C "$HOME_DIR/repo" fetch -q origin && git -C "$HOME_DIR/repo" checkout -q --detach origin/main
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$HOME_DIR/repo/scripts/loop/nightly.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MINUTE</integer></dict>
  <key>StandardOutPath</key><string>$HOME_DIR/logs/launchd.out</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/logs/launchd.err</string>
</dict>
</plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: daily at $(printf %02d:%02d "$HOUR" "$MINUTE"), clone at $HOME_DIR/repo. Run now: launchctl kickstart gui/$(id -u)/$LABEL"
