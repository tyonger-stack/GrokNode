#!/bin/zsh
# Re-apply the container-side relay (127.0.0.1:10100 -> Mac 11010) into the
# running grok-node-local-vm box. Container rebuilds restore the stock
# /tmp/ocx-relay.py (120s idle timeout), which kills chat requests that sit
# in the mac-forwarder queue for ~100s: every death shows up in forwarder.log
# as "client disconnected" at exactly +120s. This script copies the tracked
# container-relay.py (480s idle) in, restarts the relay, and probes the result
# with the real token. Run it after every container rebuild.
#
# The Mac's address is NOT stable — it comes from DHCP and moves on every
# network switch. The stable dial target is OrbStack's built-in host name
# `host.internal`, which resolves inside the box to a WiFi-independent address
# (IPv4 0.250.250.254 / IPv6 ULA) and reaches the Mac-side forwarder directly
# (verified 2026-09-28: HTTP 200 in ~0.1s from the container). That killed the
# entire DHCP-drift incident class: no en0 reading, no 169.254 link-local
# poisoning window, nothing to re-derive on a network switch.
#
# RELAY_UPSTREAM_HOST remains as a manual escape hatch (e.g. pointing the relay
# at a different forwarder for experiments). The running relay's own value is
# deliberately NOT used as a fallback any more — inheriting it is how a stale
# DHCP address survived relay restart after relay restart on 2026-09-28.
set -e
DOCKER="${DOCKER:-/usr/local/bin/docker}"
CONTAINER="${CONTAINER:-grok-node-local-vm}"
SRC="$(cd "$(dirname "$0")" && pwd)/container-relay.py"
HOST_OVERRIDE="${RELAY_UPSTREAM_HOST:-}"
TOKEN_OVERRIDE="${RELAY_TOKEN_OVERRIDE:-}"
DEFAULT_UPSTREAM="host.internal"

if ! "$DOCKER" inspect -f "{{.State.Running}}" "$CONTAINER" | grep -q true; then
  echo "container $CONTAINER is not running; nothing to push" >&2
  exit 1
fi

"$DOCKER" cp "$SRC" "$CONTAINER:/tmp/ocx-relay.py"

# Quoted heredoc on purpose: the pid/token/upstream lookups have to run inside
# the container. Unquoted, they expanded on the host and handed the relay an
# empty environment, which makes it exit on its own required-variable check.
"$DOCKER" exec -i \
  -e "RELAY_UPSTREAM_HOST_OVERRIDE=$HOST_OVERRIDE" \
  -e "RELAY_DEFAULT_UPSTREAM=$DEFAULT_UPSTREAM" \
  -e "RELAY_TOKEN_OVERRIDE=$TOKEN_OVERRIDE" \
  "$CONTAINER" sh -s <<'EOS'
set -e
pid=$(cat /tmp/ocx-relay.pid 2>/dev/null || true)
tok=""
uhost=""
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  tok=$(tr '\0' '\n' < "/proc/$pid/environ" | sed -n 's/^RELAY_TOKEN=//p')
  uhost=$(tr '\0' '\n' < "/proc/$pid/environ" | sed -n 's/^RELAY_UPSTREAM_HOST=//p')
fi
# The Mac-side token file is the single authority (the forwarder compares
# against it live on every request); the old relay's environ token is only
# the fallback for bootstrapping before any file exists. Preferring the
# current file token here is what heals a 403 auth-mismatch instead of
# rebuilding onto the same stale credential.
if [ -n "$RELAY_TOKEN_OVERRIDE" ]; then
  echo "using caller-supplied RELAY_TOKEN (file-fresh, was ${tok:+set})"
  tok="$RELAY_TOKEN_OVERRIDE"
fi
# `if` rather than `[ ... ] &&`: under `set -e` a failing test at the end of an
# && list aborts the whole script, so an unset override would exit silently
# instead of falling back to the default upstream.
if [ -n "$RELAY_UPSTREAM_HOST_OVERRIDE" ]; then
  echo "using caller-supplied RELAY_UPSTREAM_HOST=$RELAY_UPSTREAM_HOST_OVERRIDE (was ${uhost:-unset})"
  uhost="$RELAY_UPSTREAM_HOST_OVERRIDE"
else
  # Passed in via `docker exec -e`: this heredoc is quoted, so Mac-side
  # variables never expand in here.
  echo "using default RELAY_UPSTREAM_HOST=$RELAY_DEFAULT_UPSTREAM (was ${uhost:-unset})"
  uhost="$RELAY_DEFAULT_UPSTREAM"
fi

if [ -z "$tok" ]; then
  echo "FATAL: no RELAY_TOKEN (neither caller-supplied nor in the running relay env); refusing to start one without auth" >&2
  exit 1
fi
if [ -z "$uhost" ]; then
  echo "FATAL: no RELAY_UPSTREAM_HOST and no working default; refusing to start a relay with nowhere to dial" >&2
  exit 1
fi
case "$uhost" in
  # POSIX `!` negation, not `^`: the container's dash build does not support
  # caret negation at all (verified live: `[^a]` matches `a` there), so `^`
  # would let everything through. Leading `-` is literal everywhere.
  *[!0-9a-zA-Z.:_/-]*|"")
    echo "FATAL: RELAY_UPSTREAM_HOST contains shell-unsafe characters: $uhost" >&2
    exit 1
    ;;
esac
export RELAY_TOKEN="$tok"
export RELAY_UPSTREAM_HOST="$uhost"
echo "restarting relay -> upstream=$uhost (token ${RELAY_TOKEN_OVERRIDE:+file-fresh}${RELAY_TOKEN_OVERRIDE:-reused from pid $pid})"
oldpid="$pid"

[ -n "$pid" ] && kill "$pid" 2>/dev/null || true
sleep 1
cd /tmp
setsid /usr/bin/python3 /tmp/ocx-relay.py >/tmp/ocx-relay.out 2>&1 < /dev/null &
sleep 2
newpid=$(cat /tmp/ocx-relay.pid 2>/dev/null || echo none)
echo "relay pid: $newpid (was ${oldpid:-none})"
if [ -n "$oldpid" ] && [ "$newpid" = "$oldpid" ]; then
  echo "FATAL: relay pid unchanged after restart - the old process is still bound and the new config never took effect" >&2
  exit 1
fi
newenv=$(tr '\0' '\n' < "/proc/$newpid/environ" 2>/dev/null || true)
newuhost=$(printf '%s' "$newenv" | sed -n 's/^RELAY_UPSTREAM_HOST=//p')
newtok=$(printf '%s' "$newenv" | sed -n 's/^RELAY_TOKEN=//p')
if [ "$newuhost" != "$uhost" ]; then
  echo "FATAL: new relay dials '$newuhost', expected '$uhost' - refusing to report success on a stale process" >&2
  exit 1
fi
if [ -z "$newtok" ]; then
  echo "FATAL: new relay has no token in its environment" >&2
  exit 1
fi
echo "listen-10100: $(grep -c 0100007F:2774 /proc/net/tcp || true)"
EOS

# The probe must carry x-relay-token. A bare curl gets 403 from the forwarder,
# which reads like "the relay answered" while actually proving nothing about
# the path — that blind spot is why a dead upstream stayed invisible.
echo "probe /v1/models through the relay (tokened):"
"$DOCKER" exec -i "$CONTAINER" sh -s <<'EOS'
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
