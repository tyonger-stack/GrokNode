#!/bin/zsh
# Re-apply the container-side relay (127.0.0.1:10100 -> Mac 11010) into the
# running grok-node-local-vm box. Container rebuilds restore the stock
# /tmp/ocx-relay.py (120s idle timeout), which kills chat requests that sit
# in the mac-forwarder queue for ~100s: every death shows up in forwarder.log
# as "client disconnected" at exactly +120s. This script copies the tracked
# container-relay.py (480s idle) in, restarts the relay with its original
# env, and probes the result. Run it after every container rebuild.
set -e
DOCKER="${DOCKER:-/usr/local/bin/docker}"
CONTAINER="${CONTAINER:-grok-node-local-vm}"
SRC="$(cd "$(dirname "$0")" && pwd)/container-relay.py"

if ! "$DOCKER" inspect -f "{{.State.Running}}" "$CONTAINER" | grep -q true; then
  echo "container $CONTAINER is not running; nothing to push" >&2
  exit 1
fi

"$DOCKER" cp "$SRC" "$CONTAINER:/tmp/ocx-relay.py"

"$DOCKER" exec "$CONTAINER" sh -s <<"EOS"
set -e
pid=$(cat /tmp/ocx-relay.pid 2>/dev/null || true)
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  tok=$(tr "\0" "\n" < "/proc/$pid/environ" | sed -n "s/^RELAY_TOKEN=//p")
  uhost=$(tr "\0" "\n" < "/proc/$pid/environ" | sed -n "s/^RELAY_UPSTREAM_HOST=//p")
  [ -n "$tok" ] && export RELAY_TOKEN="$tok"
  [ -n "$uhost" ] && export RELAY_UPSTREAM_HOST="$uhost"
fi
[ -n "$pid" ] && kill "$pid" 2>/dev/null || true
sleep 1
cd /tmp
setsid /usr/bin/python3 /tmp/ocx-relay.py >/tmp/ocx-relay.out 2>&1 < /dev/null &
sleep 2
echo "relay pid: $(cat /tmp/ocx-relay.pid)"
echo "listen-10100: $(grep -c 0100007F:2774 /proc/net/tcp || true)"
EOS

echo "probe /v1/models through the relay:"
"$DOCKER" exec "$CONTAINER" sh -c 'curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" http://127.0.0.1:10100/v1/models'
