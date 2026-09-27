#!/bin/zsh
# Re-apply the container-side relay (127.0.0.1:10100 -> Mac 11010) into the
# running grok-node-local-vm box. Container rebuilds restore the stock
# /tmp/ocx-relay.py (120s idle timeout), which kills chat requests that sit
# in the mac-forwarder queue for ~100s: every death shows up in forwarder.log
# as "client disconnected" at exactly +120s. This script copies the tracked
# container-relay.py (480s idle) in, restarts the relay, and probes the result
# with the real token. Run it after every container rebuild.
#
# The Mac's address is NOT stable — it comes from DHCP and has already moved
# once. On 2026-09-28 the relay was still dialing 192.168.3.52 while the Mac sat
# on 192.168.5.216; that address accepts TCP and swallows every byte, so each
# host turn stalled at "model provider did not start responding within 150s"
# and workers piled up until every bot looked frozen. Pass
# RELAY_UPSTREAM_HOST= whenever the Mac's address has changed:
#
#   RELAY_UPSTREAM_HOST="$(ipconfig getifaddr en0)" tools/ocx-relay/container-relay-push.sh
#
# Only when that is unset does the running relay's own value act as fallback.
set -e
DOCKER="${DOCKER:-/usr/local/bin/docker}"
CONTAINER="${CONTAINER:-grok-node-local-vm}"
SRC="$(cd "$(dirname "$0")" && pwd)/container-relay.py"
HOST_OVERRIDE="${RELAY_UPSTREAM_HOST:-}"

if ! "$DOCKER" inspect -f "{{.State.Running}}" "$CONTAINER" | grep -q true; then
  echo "container $CONTAINER is not running; nothing to push" >&2
  exit 1
fi

"$DOCKER" cp "$SRC" "$CONTAINER:/tmp/ocx-relay.py"

# Quoted heredoc on purpose: the pid/token/upstream lookups have to run inside
# the container. Unquoted, they expanded on the host and handed the relay an
# empty environment, which makes it exit on its own required-variable check.
"$DOCKER" exec -e "RELAY_UPSTREAM_HOST_OVERRIDE=$HOST_OVERRIDE" "$CONTAINER" sh -s <<'EOS'
set -e
pid=$(cat /tmp/ocx-relay.pid 2>/dev/null || true)
tok=""
uhost=""
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  tok=$(tr '\0' '\n' < "/proc/$pid/environ" | sed -n 's/^RELAY_TOKEN=//p')
  uhost=$(tr '\0' '\n' < "/proc/$pid/environ" | sed -n 's/^RELAY_UPSTREAM_HOST=//p')
fi
# `if` rather than `[ ... ] &&`: under `set -e` a failing test at the end of an
# && list aborts the whole script, so an unset override would exit silently
# instead of falling back to the running relay's value.
if [ -n "$RELAY_UPSTREAM_HOST_OVERRIDE" ]; then
  uhost="$RELAY_UPSTREAM_HOST_OVERRIDE"
  echo "using caller-supplied RELAY_UPSTREAM_HOST (overrides the running relay's $uhost)"
fi

if [ -z "$tok" ]; then
  echo "FATAL: no RELAY_TOKEN in the running relay env; refusing to start one without auth" >&2
  exit 1
fi
if [ -z "$uhost" ]; then
  echo "FATAL: no RELAY_UPSTREAM_HOST. Pass it in:" >&2
  echo "       RELAY_UPSTREAM_HOST=\"\$(ipconfig getifaddr en0)\" $0" >&2
  exit 1
fi
export RELAY_TOKEN="$tok"
export RELAY_UPSTREAM_HOST="$uhost"
echo "restarting relay -> upstream=$uhost (token reused from pid $pid)"

[ -n "$pid" ] && kill "$pid" 2>/dev/null || true
sleep 1
cd /tmp
setsid /usr/bin/python3 /tmp/ocx-relay.py >/tmp/ocx-relay.out 2>&1 < /dev/null &
sleep 2
echo "relay pid: $(cat /tmp/ocx-relay.pid 2>/dev/null || echo none)"
echo "listen-10100: $(grep -c 0100007F:2774 /proc/net/tcp || true)"
EOS

# The probe must carry x-relay-token. A bare curl gets 403 from the forwarder,
# which reads like "the relay answered" while actually proving nothing about
# the path — that blind spot is why a dead upstream stayed invisible.
echo "probe /v1/models through the relay (tokened):"
"$DOCKER" exec "$CONTAINER" sh -s <<'EOS'
pid=$(cat /tmp/ocx-relay.pid 2>/dev/null || true)
tok=""
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  tok=$(tr '\0' '\n' < "/proc/$pid/environ" | sed -n 's/^RELAY_TOKEN=//p')
fi
if [ -z "$tok" ]; then
  echo "  FATAL: cannot read the relay token; refusing to report a tokenless 403 as success" >&2
  exit 1
fi
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
  -H "x-relay-token: $tok" http://127.0.0.1:10100/v1/models)
echo "  HTTP $code in $(curl -s -o /dev/null -w '%{time_total}s' --max-time 15 -H "x-relay-token: $tok" http://127.0.0.1:10100/v1/models)"
if [ "$code" != "200" ]; then
  echo "  FAILED: expected 200 through 127.0.0.1:10100 (got $code)." >&2
  echo "  If this is 000, the relay's RELAY_UPSTREAM_HOST does not reach the Mac:" >&2
  echo "  from inside the container, TCP-connect to that host's port 11010." >&2
  exit 1
fi
echo "  OK: container -> 10100 -> Mac:11010 is live"
EOS
