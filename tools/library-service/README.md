# library-service — local operator admin for the Node Library

Local-only administration for the Node-owned Library catalog and its
authenticated HTTPS receiver. No public account creation exists: every
command here runs on the machine that owns the data root. HTTP clients
never provision identities and never switch owners.

Run with the workspace Node 26 build:

```sh
export PATH="/Users/Apple/Documents/grokbot/.tools/node-26/bin:$PATH"
node tools/library-service/cli.mjs --data-root <DIR> --origin <https://host[:port]> <command>
```

## Commands

- `provision [--account-id ID] [--out FILE]` — issues one service-owned
  credential (`createLocalPrincipal`). Prints
  `{accountId, principalId, credential}` once; with `--out` the same
  record is also written with mode 0600. Existing catalog identities are
  legitimate Node issuance; this is the only issuance path.
- `member add|remove --account A --principal P --team T` — team
  membership. Reads honor current membership on every request.
- `agent add|remove --account A --principal P --agent G` — agent
  membership used by transcript reads and production execution.
- `store register --account A --principal P --store S [--team T]` —
  registers a store. Store identity is immutable; re-registering with a
  different owner is denied, never switched.
- `store set-team --account A --principal P --store S [--team T]` —
  moves a store between team and private. `--account/--principal` must be
  the registered store owner; anyone else is denied.
- `status` — origin plus row counts from a read-only connection.
- `serve --host H --port N --key-file KF --cert-file CF` — starts the
  concrete local HTTPS receiver on loopback and prints its origin.
  Stops on SIGINT/SIGTERM.

## Receiver configuration (host lifecycle)

The host extension (R3 owned) starts the optional receiver with:

```ts
import {
  resolveLibraryHttpConfigFromEnv,
  startLibraryHttpServer,
} from "./http-server.js";

const config = resolveLibraryHttpConfigFromEnv(service.nodeOrigin);
const receiver = config === null ? null : await startLibraryHttpServer({ ...config, service });
// onStop: await receiver?.close() before service.dispose().
```

Environment:

- `SAND_LIBRARY_ORIGIN` — required for TLS. Must equal the service
  origin; the listener port is derived from it. The bind host may differ
  (container `0.0.0.0`) while the advertised origin stays the real
  `https://127.0.0.1:port` reachability through the publish.
- `SAND_LIBRARY_LISTEN_HOST` — default `127.0.0.1`. Loopback only;
  Binds the container or host listener; `0.0.0.0` is accepted only with
  `SAND_LIBRARY_INTERNAL_CONTAINER=1` and a loopback advertised origin
  (Docker publishes it back onto loopback). Any other non-loopback bind
  requires `SAND_LIBRARY_PUBLIC_OK=1`; nothing public starts by default.
- `SAND_LIBRARY_INTERNAL_CONTAINER=1` — forwarded by the opt-in Docker
  config together with `SAND_LIBRARY_ORIGIN`, the TLS key/cert file
  paths, and `SAND_LIBRARY_LISTEN_HOST=0.0.0.0`. The key/cert files
  enter the container as readonly bind mounts at fixed container paths;
  only file-path references cross in env, never secret bytes. The
  container must not claim public exposure (`SAND_LIBRARY_PUBLIC_OK`
  is never set by the Docker forwarding).
- `SAND_LIBRARY_TLS_KEY_FILE`, `SAND_LIBRARY_TLS_CERT_FILE` — both
  required to enable. Partial config throws instead of silently
  disabling. Unset everything means disabled (null).
- Default `https://groknode.local` is an unreachable placeholder string,
  never a bound listener.

## Receiver behavior

- `POST /session {credential}` exchanges a service-issued credential for
  a `__Host-library_session` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`).
- `GET /documents/<store>/<id>`, `/raw`, `/assets/<name>`,
  `/canvas/<store>/<id>`, `/payload` always authorize the
  requesting identity per request; the host main credential is never
  substituted. Copied page URLs carry no bearer.
- Unknown, traversal, or foreign paths answer 404 without catalog access.

## Local TLS check without machine trust changes

Generate a task-owned CA and server certificate under a temp dir, connect
to `127.0.0.1` directly (no DNS or `/etc/hosts` edits), and verify with
the CA (`ca` option). Never use `-k`/`rejectUnauthorized:false` and never
write machine trust or profiles. See `tests/library-http-server.test.mjs`.
