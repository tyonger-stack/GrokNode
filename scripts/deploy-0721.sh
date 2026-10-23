#!/bin/zsh
# 部署 0.72.1 移植候选包到 /Applications。
# 前置：backups/Grok Node-before-0721-port-20261021-173933.app 已是旧版备份。
# 风险：host bundle 变化会触发容器重建，正在进行的 Bot 回合将被打断。
set -euo pipefail
APP="/Applications/Grok Node.app"
CANDIDATE="/Users/Apple/Documents/grokbot/grok-node-port-0721/dist/Grok Node.app"
if [[ ! -d "$CANDIDATE" ]]; then echo "missing candidate: $CANDIDATE" >&2; exit 1; fi
osascript -e 'tell application "Grok Node" to quit' 2>/dev/null || true
sleep 3
pkill -f "/Applications/Grok Node.app" 2>/dev/null || true
sleep 1
rm -rf "$APP"
/usr/bin/ditto "$CANDIDATE" "$APP"
xattr -cr "$APP"
codesign --verify --deep --strict "$APP"
echo "deployed: $APP"
open "$APP" --args --remote-debugging-port=9333
