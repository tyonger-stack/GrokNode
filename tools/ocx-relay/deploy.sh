#!/bin/zsh
# Deploy the ocx-relay tools from the repo checkout to the live directory,
# backing up whatever is currently running there. Does NOT restart anything
# on its own except the forwarder (a ~1s inference blip); the watchdog is
# installed via launchd by the user (see README).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/.grokbot/ocx-relay"
TS=$(date +%Y%m%d-%H%M%S)

mkdir -p "$DST"
for f in mac-forwarder.mjs turn-watchdog.mjs container-relay.py; do
  if [ -f "$DST/$f" ]; then
    cp "$DST/$f" "$DST/$f.bak-$TS"
    echo "backed up: $DST/$f.bak-$TS"
  fi
  cp "$SRC/$f" "$DST/$f"
  echo "deployed:  $DST/$f"
done

# launchd plist with __HOME__ resolved for this machine
sed "s|__HOME__|$HOME|g" "$SRC/com.groknode.turn-watchdog.plist" > "$DST/com.groknode.turn-watchdog.plist"
echo "deployed:  $DST/com.groknode.turn-watchdog.plist"

cat <<'EOF'

Forwarder restart (kills in-flight requests, ~1s gap):
  pkill -f "ocx-relay/mac-forwarder.mjs"; sleep 1
  nohup "$HOME/.grokbot/ocx-relay/relay-run.sh" >> "$HOME/.grokbot/ocx-relay/forwarder.log" 2>> "$HOME/.grokbot/ocx-relay/forwarder.err.log" &

Watchdog one-shot self-test:
  RUN_ONCE=1 /usr/local/bin/node "$HOME/.grokbot/ocx-relay/turn-watchdog.mjs"

Watchdog install (user must run; AI sandboxes cannot bootstrap launchd):
  cp "$HOME/.grokbot/ocx-relay/com.groknode.turn-watchdog.plist" ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.groknode.turn-watchdog.plist

After a container rebuild (docker ps Up time reset), re-push the 480s relay:
  tools/ocx-relay/container-relay-push.sh

Rollback: copy the .bak-$TS file back over mac-forwarder.mjs and restart.
EOF
