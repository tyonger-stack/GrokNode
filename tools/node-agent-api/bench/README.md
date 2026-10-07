# node-agent-api bench

Synthetic, same-machine measurement for the node-agent-api speed plan. No model calls, no live state, no Docker.

## Fixtures

- `fake-codex.mjs`: stdio JSON-RPC stand-in for the Codex `app-server` child. Answers `thread/start`, `thread/resume`, `thread/read`, `turn/start` locally; `BENCH_HARNESS_DELAY_MS` delays only the synthetic provider reply; `BENCH_STALL_METHOD` never answers one method (timeout path).
- `fixture.mjs` `createFixture({ sourceRoot, ... })`: loads `server.mjs`, `codex.mjs`, `runtime/harness.mjs` from any source root (archived baseline or candidate checkout) by absolute path, then runs the real HTTP service, real Codex adapter, real Harness transport against a synthetic runtime (identity/ensure/status seam) and synthetic upstream. Counts `ensure`/`status`/`validateExecutor`/`turn/start`/`thread/resume`/atomic `sessions.json` renames; asserts zero real Docker calls by construction (the synthetic runtime has no Docker client).
- `rfb.mjs` `createRfbFixture()`: protocol-compatible synthetic RFB upstream serving one known 64x48 solid-colour framebuffer (`37,149,211,255`). Counts connections, frames, key/pointer events.

## Auth isolation

The fixture writes a dummy private `auth.json` (`{}`) inside its own temporary directory and passes it as explicit `authFile` to `createHarness`. Archived sources whose harness predates the `authFile` option ignore the extra property and instead resolve auth through `homedir()`; benchmark workers therefore run in a forked child whose `HOME` is a fresh synthetic directory containing dummy auth JSON. The parent process environment is never mutated; `tests/node-agent-performance.test.mjs` asserts `process.env.HOME` is unchanged.

## Commands (from the repository root R, Node 26.5.x on PATH)

```sh
export PATH="/Users/Apple/Documents/grokbot/.tools/node-26/bin:$PATH"
node tools/node-agent-api/bench/performance.mjs --fixture --source-root /private/tmp/node-agent-speed-baseline-01a113f1 --cold-samples 30 --warm-samples 100 --output Q/task-1/baseline.json
node tools/node-agent-api/bench/performance.mjs --fixture --source-root R --cold-samples 30 --warm-samples 100 --output Q/task-9/candidate.json
node tools/node-agent-api/bench/browser.mjs --source-root /private/tmp/node-agent-speed-baseline-01a113f1 --novnc-root /private/tmp/node-agent-speed-novnc-01a113f1 --loader <omowright-loader> --cold-samples 30 --warm-samples 100 --output Q/task-1/browser.json
node tools/node-agent-api/bench/performance.mjs --read-only-live --cold-samples 0 --warm-samples 2 --origin http://127.0.0.1:18770 --key-file <key-file> --output Q/task-1/live.json
```

`--source-root` selects the measured source: the immutable archive for baseline, the working checkout for candidate. The report records sha256 of the eleven benchmark-relevant sources plus `git rev-parse HEAD` (null for archives) and re-hashes after the run (`sourceStable` false aborts that series).

## Metrics

`viewer-phase-one.mjs` validates the bundled embedded viewer using the real API, fake Codex, known framebuffer and isolated Chromium. Build the viewer first as described in the API README, then run:

```sh
node tools/node-agent-api/bench/viewer-phase-one.mjs --loader /absolute/path/to/omowright.mjs --output /absolute/path/to/private/evidence.json --samples 5
```

It records unprewarmed first open, prewarmed display and repeated display separately, checks decoded pixels, verifies reuse without new authorizations or upstream connections, and exercises selection cleanup, stale iframe messages, preserved control leases and explicit Control/Handback. Browser failures remain in the evidence; optional browser tests require `NODE_AGENT_VIEWER_BROWSER_LOADER` and do not download dependencies.

- `localDispatchMs`: test client immediately before HTTP POST to the real Harness child-stdin `turn/start` write, same parent monotonic clock. Includes loopback transit; excludes the synthetic provider reply delay.
- `httpAcceptedMs`: POST start to 202 accepted (excludes Harness reply).
- `notificationToSseClientMs`: real Harness notification callback to SSE bytes observed by a loopback client, after asserting the event is already durable in `sessions.json`.
- `firstFrameMs` (browser): capturing click handler on the real product View button to the first rAF observing matching noVNC-decoded visible canvas pixels (64x48, `37,149,211,255`). All browser interactions (key fill, connect, bot select, session and View presses) are dispatched as in-page DOM operations because the automation client's actionability/readiness waits intermittently time out on this live-updating page; timing still starts at the real capturing View-button handler, so the measured ticket/iframe/RFB/canvas path is unchanged. None of the setup steps are timed. Iframe `load` and WebSocket `open` are never counted as first paint.
- `storeWrites`: successful atomic `sessions.json` renames per turn. `cpuMs` covers the parent process only.

## Limits

- Synthetic runtime identity/ensure/status seam: no real Docker or gateway timing. `--gateway-delay-ms N` adds a fixed, labelled delay per identity call, identically for baseline and candidate; it must never be presented as measured Docker time.
- One active session, one delta per turn: not the 1/2/4-session 5000-delta stress matrix.
- Live mode observes an already-running service with at most ten low-frequency reads; it cannot prove the deployed revision and claims no p95.
