import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  stdin: {
    contents: [
      'export { HostBox } from "./source/host/extensions/forever-box/host-box.ts";',
      'export { SharedDesktopSandBox } from "./source/host/box/shared-desktop-sand-box.ts";',
      'export { LoopbackSandBox, EXEC_DAEMON_PORT } from "./source/host/box/loopback-sand-box.ts";',
      'export { createContext } from "./source/packages/context/core.ts";',
    ].join("\n"),
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  logLevel: "error",
});
const runtime = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), runtime, runtime.exports);
const { HostBox, SharedDesktopSandBox, LoopbackSandBox, EXEC_DAEMON_PORT, createContext } = runtime.exports;

function deferred() {
  return Promise.withResolvers();
}
function observe(promise) {
  return promise.then(value => ({ value }), error => ({ error }));
}
function assertCanceled(result, reason) {
  assert.equal(result.error, reason);
  assert.equal("value" in result, false, "an aborted caller must never report success");
}
const primary = { remoteAccessor: {}, vncUrl: "primary", terminalsFolder: "/terminals" };
function fixture(overrides = {}, options = {}) {
  const starts = [], stops = [], writes = [], statuses = [];
  const inner = {
    maxWindows: () => 8,
    ensureReady: async () => primary,
    ensureWindow: async (ctx, agentId, windowIndex, opts) => {
      starts.push({ ctx, agentId, windowIndex, opts });
      return { windowIndex, computerUse: {}, vncUrl: `window-${windowIndex}` };
    },
    releaseWindow: async (ctx, agentId, windowIndex) => {
      ctx.signal.throwIfAborted();
      stops.push({ ctx, agentId, windowIndex });
    },
    downloadFile: async () => new TextEncoder().encode('{"assignments":{}}'),
    uploadFile: async (ctx, _agentId, _path, bytes) => {
      ctx.signal.throwIfAborted();
      writes.push(JSON.parse(new TextDecoder().decode(bytes)));
    },
    runState: async () => "running",
    listBoxes: async () => [],
    ...overrides,
  };
  const shared = new SharedDesktopSandBox(inner, options);
  const host = new HostBox(shared);
  host.subscribe(status => statuses.push(status));
  return { inner, shared, host, starts, stops, writes, statuses };
}

for (const canceledCaller of ["prewarm", "foreground"]) {
  test(`foreground and prewarm share one startup when ${canceledCaller} cancels`, async () => {
    const started = deferred(), ready = deferred();
    const f = fixture();
    const ensureWindow = f.inner.ensureWindow;
    f.inner.ensureWindow = async (...args) => {
      const window = await ensureWindow(...args);
      started.resolve();
      await ready.promise;
      return window;
    };
    const [prewarmCtx, cancelPrewarm] = createContext().withCancel();
    const [foregroundCtx, cancelForeground] = createContext().withCancel();
    const prewarm = observe(f.host.ensureReady(prewarmCtx, "a"));
    await started.promise;
    const foreground = observe(f.host.ensureReady(foregroundCtx, "a"));
    await nextTurn();
    const reason = new Error(`${canceledCaller} canceled`);
    (canceledCaller === "prewarm" ? cancelPrewarm : cancelForeground)(reason);
    ready.resolve();
    const results = await Promise.all([prewarm, foreground]);
    assertCanceled(results[canceledCaller === "prewarm" ? 0 : 1], reason);
    assert.equal(results[canceledCaller === "prewarm" ? 1 : 0].value.vncUrl, "window-2");
    assert.equal(f.starts.length, 1, "one bringup for overlapping callers");
    assert.equal(f.stops.length, 0, "canceling one waiter must preserve the healthy caller's window");
    assert.equal(f.shared.getAgentWindowIndex("a"), 2);
    assert.equal(f.host.vncUrls.get("a"), "window-2");
    assert.equal(f.statuses.filter(status => status.state === "running").length, 1);
  });
}

test("sole prewarm cancellation after primary readiness rolls back its new assignment", async () => {
  const entered = deferred(), ready = deferred();
  const f = fixture({ ensureReady: async ctx => { entered.resolve(ctx); await ready.promise; return primary; } });
  const [ctx, cancel] = createContext().withCancel();
  const pending = observe(f.host.ensureReady(ctx, "a"));
  const operationCtx = await entered.promise;
  const reason = new Error("prewarm canceled");
  cancel(reason);
  ready.resolve();
  assertCanceled(await pending, reason);
  assert.equal(operationCtx.signal.aborted, true);
  assert.equal(f.starts.length, 0);
  assert.equal(f.shared.getAgentWindowIndex("a"), undefined);
  assert.equal(f.host.vncUrls.has("a"), false);
  assert.equal(f.statuses.length, 0);
});

test("abort during fork startup releases with a detached context and persists rollback", async () => {
  const started = deferred(), ready = deferred();
  const f = fixture({}, { persistAssignments: true });
  const start = f.inner.ensureWindow;
  f.inner.ensureWindow = async (...args) => { const window = await start(...args); started.resolve(); await ready.promise; return window; };
  const [ctx, cancel] = createContext().withCancel();
  const pending = observe(f.host.ensureReady(ctx, "a"));
  await started.promise;
  const reason = new Error("aborted fork");
  cancel(reason);
  ready.resolve();
  assertCanceled(await pending, reason);
  await f.shared.flushPersistence();
  assert.equal(f.stops.length, 1);
  assert.equal(f.stops[0].ctx.signal.aborted, false);
  assert.equal(f.shared.getAgentWindowIndex("a"), undefined);
  assert.deepEqual(f.writes.at(-1), { assignments: {}, tokens: {} });
  assert.equal(f.host.vncUrls.has("a"), false);
  assert.equal(f.statuses.length, 0);
});

test("deletion cancels an in-flight startup and cleans its late result before any new ensure", async () => {
  const started = deferred(), ready = deferred(), stopping = deferred(), stopped = deferred();
  const f = fixture({}, { persistAssignments: true });
  const start = f.inner.ensureWindow;
  let startupCtx;
  f.inner.ensureWindow = async (...args) => {
    const window = await start(...args);
    if (f.starts.length === 1) { startupCtx = args[0]; started.resolve(); await ready.promise; }
    return window;
  };
  const stop = f.inner.releaseWindow;
  f.inner.releaseWindow = async (...args) => { await stop(...args); stopping.resolve(); await stopped.promise; };
  const old = observe(f.host.ensureReady(createContext(), "a"));
  await started.promise;
  const released = f.host.releaseWindow(createContext(), "a");
  const next = observe(f.host.ensureReady(createContext(), "a"));
  await nextTurn();
  const abortedAtDeletion = startupCtx.signal.aborted;
  ready.resolve();
  await stopping.promise;
  assert.equal(f.starts.length, 1, "replacement must wait for teardown");
  stopped.resolve();
  await released;
  const oldResult = await old;
  assert.equal(abortedAtDeletion, true);
  assert.ok(oldResult.error, "the deleted startup must not return a connection");
  // A released agent id stays tombstoned: a fresh ensure is refused instead of
  // resurrecting the seat (shared-desktop checks releasedAssignments first).
  const nextResult = await next;
  assert.ok(nextResult.error, "a late ensure for a released agent must be refused");
  assert.match(String(nextResult.error.message), /released during startup/);
  await f.shared.flushPersistence();
  assert.equal(f.starts.length, 1, "no replacement startup may run for a released agent");
  assert.equal(f.host.vncUrls.has("a"), false);
  assert.deepEqual(f.statuses.map(status => status.state), ["absent"]);
});

test("different agents start independently and canceling one preserves the other's seat", async () => {
  const first = deferred(), unblock = deferred();
  const f = fixture();
  const start = f.inner.ensureWindow;
  f.inner.ensureWindow = async (...args) => {
    const window = await start(...args);
    if (window.windowIndex === 2) { first.resolve(); await unblock.promise; }
    return window;
  };
  const [ctx, cancel] = createContext().withCancel();
  const canceled = observe(f.host.ensureReady(ctx, "a"));
  await first.promise;
  const healthy = await f.host.ensureReady(createContext(), "b");
  const reason = new Error("a canceled");
  cancel(reason);
  unblock.resolve();
  assertCanceled(await canceled, reason);
  assert.equal(healthy.vncUrl, "window-3");
  assert.equal(f.shared.getAgentWindowIndex("b"), 3);
  assert.equal(f.shared.getAgentWindowIndex("a"), undefined);
  assert.deepEqual(f.stops.map(stop => stop.windowIndex), [2]);
  assert.equal(f.host.vncUrls.get("b"), "window-3");
});

test("cancellation during assignment loading cannot allocate a seat or start primary readiness", async () => {
  const loading = deferred(), loaded = deferred();
  let primaries = 0;
  const f = fixture({
    downloadFile: async () => { loading.resolve(); await loaded.promise; return new TextEncoder().encode('{"assignments":{}}'); },
    ensureReady: async () => { primaries += 1; return primary; },
  }, { persistAssignments: true });
  const [ctx, cancel] = createContext().withCancel();
  const pending = observe(f.shared.ensureReady(ctx, "a"));
  await loading.promise;
  const reason = new Error("cancel during load");
  cancel(reason);
  loaded.resolve();
  assertCanceled(await pending, reason);
  assert.equal(primaries, 0);
  assert.equal(f.starts.length, 0);
  assert.equal(f.shared.getAgentWindowIndex("a"), undefined);
});

test("a fresh foreground waits for canceled raw work and rollback before starting", async () => {
  const entered = deferred(), ready = deferred(), stopping = deferred(), stopped = deferred();
  const f = fixture();
  const start = f.inner.ensureWindow, stop = f.inner.releaseWindow;
  f.inner.ensureWindow = async (...args) => {
    const window = await start(...args);
    if (f.starts.length === 1) { entered.resolve(); await ready.promise; }
    return window;
  };
  f.inner.releaseWindow = async (...args) => { await stop(...args); stopping.resolve(); await stopped.promise; };
  const [ctx, cancel] = createContext().withCancel();
  const pending = observe(f.host.ensureReady(ctx, "a"));
  await entered.promise;
  const reason = new Error("stale prewarm");
  cancel(reason);
  const foreground = observe(f.host.ensureReady(createContext(), "a"));
  let settled = false;
  void pending.then(() => { settled = true; });
  await nextTurn();
  assert.equal(settled, false, "raw ensure remains pending so scheduler capacity is retained");
  assert.equal(f.starts.length, 1);
  ready.resolve();
  await stopping.promise;
  assert.equal(f.starts.length, 1);
  stopped.resolve();
  assertCanceled(await pending, reason);
  assert.equal((await foreground).value.vncUrl, "window-2");
  assert.equal(f.starts.length, 2);
  assert.equal(f.stops.length, 1);
  assert.equal(f.host.vncUrls.get("a"), "window-2");
});

test("canceling a later readiness check preserves an already established seat", async () => {
  const f = fixture();
  await f.host.ensureReady(createContext(), "a");
  const entered = deferred(), ready = deferred();
  f.inner.ensureWindow = async (_ctx, _agentId, windowIndex) => { entered.resolve(); await ready.promise; return { windowIndex, computerUse: {}, vncUrl: `window-${windowIndex}` }; };
  const [ctx, cancel] = createContext().withCancel();
  const pending = observe(f.host.ensureReady(ctx, "a"));
  await entered.promise;
  const reason = new Error("later check canceled");
  cancel(reason);
  ready.resolve();
  assertCanceled(await pending, reason);
  assert.equal(f.stops.length, 0);
  assert.equal(f.shared.getAgentWindowIndex("a"), 2);
  assert.equal(f.host.vncUrls.get("a"), "window-2");
});

test("primary failure frees the provisional assignment and retry can reuse its index", async () => {
  const reason = new Error("primary failed");
  const f = fixture({ ensureReady: async () => { throw reason; } });
  assert.equal((await observe(f.host.ensureReady(createContext(), "a"))).error, reason);
  assert.equal(f.shared.getAgentWindowIndex("a"), undefined);
  assert.equal(f.starts.length, 0);
  f.inner.ensureReady = async () => primary;
  assert.equal((await f.host.ensureReady(createContext(), "b")).vncUrl, "window-2");
});

test("shared assignment loading isolates different agents' cancellation", async () => {
  const loading = deferred(), loaded = deferred();
  let loads = 0;
  const f = fixture({ downloadFile: async () => { loads += 1; loading.resolve(); await loaded.promise; return new TextEncoder().encode('{"assignments":{}}'); } }, { persistAssignments: true });
  const [ctx, cancel] = createContext().withCancel();
  const first = observe(f.host.ensureReady(ctx, "a"));
  await loading.promise;
  const second = observe(f.host.ensureReady(createContext(), "b"));
  await nextTurn();
  const reason = new Error("cancel one loader");
  cancel(reason);
  loaded.resolve();
  assertCanceled(await first, reason);
  assert.equal((await second).value.vncUrl, "window-2");
  assert.equal(loads, 1);
  assert.equal(f.shared.getAgentWindowIndex("a"), undefined);
  assert.equal(f.shared.getAgentWindowIndex("b"), 2);
});

test("deletion while another agent loads assignments cannot restore the deleted seat", async () => {
  const loading = deferred(), loaded = deferred();
  const f = fixture({ downloadFile: async () => { loading.resolve(); await loaded.promise; return new TextEncoder().encode('{"assignments":{"deleted":2},"tokens":{"deleted":"old-token"}}'); } }, { persistAssignments: true });
  const pending = f.host.ensureReady(createContext(), "other");
  await loading.promise;
  await f.host.releaseWindow(createContext(), "deleted");
  loaded.resolve();
  await pending;
  await f.shared.flushPersistence();
  assert.equal(f.shared.getAgentWindowIndex("deleted"), undefined);
  assert.equal(f.host.vncUrls.has("deleted"), false);
  assert.deepEqual(f.writes.at(-1).assignments, { other: 2 });
});

test("deletion with no successor cannot write or report a late connection", async () => {
  const entered = deferred(), ready = deferred();
  const f = fixture({}, { persistAssignments: true });
  const start = f.inner.ensureWindow;
  f.inner.ensureWindow = async (...args) => { const window = await start(...args); entered.resolve(); await ready.promise; return window; };
  const pending = observe(f.host.ensureReady(createContext(), "a"));
  await entered.promise;
  const released = f.host.releaseWindow(createContext(), "a");
  ready.resolve();
  await released;
  assert.ok((await pending).error);
  await f.shared.flushPersistence();
  assert.equal(f.shared.getAgentWindowIndex("a"), undefined);
  assert.equal(f.host.vncUrls.has("a"), false);
  assert.deepEqual(f.statuses.map(status => status.state), ["absent"]);
  assert.deepEqual(f.writes.at(-1), { assignments: {}, tokens: {} });
});

test("an explicit window startup is coalesced and deletion fences its late cache entry", async () => {
  const entered = deferred(), ready = deferred();
  let calls = 0, released = 0;
  const host = new HostBox({
    ensureReady: async () => ({ vncUrl: "primary" }),
    ensureWindow: async (_ctx, _agentId, windowIndex) => { calls += 1; entered.resolve(); await ready.promise; return { windowIndex, vncUrl: "fork" }; },
    releaseWindow: async () => { released += 1; },
  });
  const first = observe(host.ensureWindow(createContext(), "a", 3));
  await entered.promise;
  const second = observe(host.ensureWindow(createContext(), "a", 3));
  const cleanup = host.releaseWindow(createContext(), "a");
  ready.resolve();
  await cleanup;
  assert.ok((await first).error);
  assert.ok((await second).error);
  assert.equal(calls, 1);
  assert.equal(released, 1);
  assert.equal(host.vncUrls.has("a"), false);
  assert.equal(host.forkVncUrls.has("a"), false);
});

test("an established seat is reclaimed when its executor stops answering", async () => {
  const probes = [];
  const cleanups = [];
  const f = fixture({
    probeWindow: async (_ctx, _agentId, windowIndex) => { probes.push(windowIndex); return "unreachable"; },
  }, { onStaleSeatCleanup: detail => cleanups.push(detail) });
  await f.host.ensureReady(createContext(), "a");
  assert.equal(f.shared.getAgentWindowIndex("a"), 2);
  assert.equal(f.stops.length, 0);
  // The seat is now a zombie: the next turn's bring-up fails, and the rollback
  // must stop treating the agent as a healthy caller of a live seat.
  f.inner.ensureWindow = async () => { throw new Error("start-window exited -1, signal SIGTERM"); };
  await assert.rejects(() => f.host.ensureReady(createContext(), "a"), /SIGTERM/);
  assert.deepEqual(probes, [2], "rollback probes the seat's executor");
  assert.deepEqual(cleanups, [{ agentId: "a", windowIndex: 2, probe: "unreachable", released: true }]);
  assert.equal(f.stops.length, 1, "the zombie seat is actually released");
});

test("an established seat is left alone while its executor answers", async () => {
  const cleanups = [];
  const f = fixture({ probeWindow: async () => "reachable" }, { onStaleSeatCleanup: detail => cleanups.push(detail) });
  await f.host.ensureReady(createContext(), "a");
  f.inner.ensureWindow = async () => { throw new Error("transient failure"); };
  await assert.rejects(() => f.host.ensureReady(createContext(), "a"), /transient failure/);
  assert.equal(f.stops.length, 0, "a live seat still belongs to its healthy caller");
  assert.equal(cleanups.length, 0);
  assert.equal(f.shared.getAgentWindowIndex("a"), 2);
});

test("a backend that cannot probe keeps the established-seat behavior", async () => {
  const f = fixture();
  await f.host.ensureReady(createContext(), "a");
  f.inner.ensureWindow = async () => { throw new Error("transient failure"); };
  await assert.rejects(() => f.host.ensureReady(createContext(), "a"), /transient failure/);
  assert.equal(f.stops.length, 0, "no probe capability means no reclaim");
  assert.equal(f.shared.getAgentWindowIndex("a"), 2);
});

test("a throwing probe is treated as unknown, never as a dead seat", async () => {
  const f = fixture({ probeWindow: async () => { throw new Error("probe exploded"); } });
  await f.host.ensureReady(createContext(), "a");
  f.inner.ensureWindow = async () => { throw new Error("transient failure"); };
  await assert.rejects(() => f.host.ensureReady(createContext(), "a"), /transient failure/);
  assert.equal(f.stops.length, 0);
  assert.equal(f.shared.getAgentWindowIndex("a"), 2);
});

function loopback(operations = {}, options = {}) {
  const commands = [];
  const accessor = { get: () => ({ execute: async (_ctx, args) => { commands.push(args.command); return { result: { case: "success", value: { exitCode: 0, stderr: "" } } }; } }) };
  const box = new LoopbackSandBox({
    watchdogIntervalMs: 0,
    ...options,
    operations: { ping: async () => ({ outcome: "ok" }), createRemoteAccessor: () => accessor, protectRemoteAccessor: accessor => accessor, ...operations },
  });
  return { box, commands };
}

test("a release skipped on an unreachable primary is reported, not silent", async () => {
  const reports = [];
  const { box, commands } = loopback({
    ping: async (_ctx, endpoint) => ({ outcome: endpoint.port === EXEC_DAEMON_PORT ? "refused" : "ok" }),
  });
  box.setTelemetry({ reportDaemonPing: report => reports.push(report) });
  await box.releaseWindow(createContext(), "a", 4);
  assert.equal(commands.length, 0, "no stop-window can run without the primary daemon");
  const skipped = reports.find(report => report.readinessState === "window_primary-unreachable");
  assert.ok(skipped, "the skipped release must be retrievable from telemetry");
  assert.match(skipped.causeSummary, /primary_ping=refused/);
  assert.match(skipped.target, /window-4/);
});

test("a release whose probe throws is reported and still stops the seat", async () => {
  const reports = [];
  let probes = 0;
  const { box, commands } = loopback({
    ping: async (_ctx, endpoint) => {
      if (endpoint.port !== EXEC_DAEMON_PORT) return { outcome: "ok" };
      probes += 1;
      if (probes === 1) throw new Error("probe socket blew up");
      return { outcome: "ok" };
    },
  });
  box.setTelemetry({ reportDaemonPing: report => reports.push(report) });
  await box.releaseWindow(createContext(), "a", 5);
  assert.equal(commands.length, 0);
  const skipped = reports.find(report => report.readinessState === "window_probe-threw");
  assert.ok(skipped, "a throwing probe must not fail silently");
  assert.match(skipped.causeSummary, /probe socket blew up/);
});

test("releaseWindow probes the fork endpoint for seat liveness", async () => {
  const targets = [];
  const { box } = loopback({
    ping: async (_ctx, endpoint) => { targets.push(`${endpoint.port}:${endpoint.headers?.["x-sand-display"] ?? "-"}`); return { outcome: "ok" }; },
  });
  assert.equal(await box.probeWindow(createContext(), "a", 6), "reachable");
  assert.deepEqual(targets, ["1339:6"], "probes the fork router with the window's display token");
});

test("an unreachable fork endpoint reports the seat as unreachable", async () => {
  const { box } = loopback({ ping: async () => ({ outcome: "timeout" }) });
  assert.equal(await box.probeWindow(createContext(), "a", 7), "unreachable");
  assert.equal(await box.probeWindow(createContext(), "a", 0), "unknown", "the primary seat is never probed as a fork");
});

test("a fork router that refuses the probe counts as unreachable", async () => {
  const { box } = loopback({ ping: async () => { throw new Error("router gone"); } });
  assert.equal(await box.probeWindow(createContext(), "a", 8), "unreachable");
});

test("a probe that fails only because the caller aborted stays unknown, not dead", async () => {
  // An abort is the caller's decision, not evidence about the seat. Reporting
  // "unreachable" here would let a canceled turn reclaim a healthy window -
  // the exact cross-agent symptom the seat reclaiming exists to prevent.
  const { box } = loopback({ ping: async () => { throw new Error("probe canceled"); } });
  const [ctx, cancel] = createContext().withCancel();
  cancel(new Error("caller stopped waiting"));
  assert.equal(await box.probeWindow(ctx, "a", 9), "unknown");
});

test("a probe that fails for a real reason after the abort is still unreachable", async () => {
  // Guard the other side of the branch: only a live context reports a dead
  // seat, so a genuinely vanished executor is not masked by an idle abort.
  const { box } = loopback({ ping: async () => { throw new Error("router gone"); } });
  const [ctx] = createContext().withCancel();
  assert.equal(await box.probeWindow(ctx, "a", 10), "unreachable");
});

test("loopback readiness aborts the polling sleep promptly and passes its signal", async () => {
  const sleeping = deferred();
  let polls = 0, sleepSignal;
  const { box } = loopback({
    ping: async () => { polls += 1; return { outcome: polls === 1 ? "refused" : "ok" }; },
    sleep: async (ms, signal) => { sleepSignal = signal; sleeping.resolve(); await delay(ms, undefined, { signal }); },
  }, { pollIntervalMs: 150 });
  const [ctx, cancel] = createContext().withCancel();
  const pending = observe(box.ensureReady(ctx, "a"));
  await sleeping.promise;
  cancel(new Error("stop polling"));
  const promptly = await Promise.race([pending, delay(75).then(() => "still waiting")]);
  const result = await pending;
  assert.notEqual(promptly, "still waiting");
  assert.ok(result.error);
  assert.equal(sleepSignal, ctx.signal);
  assert.equal(polls, 1);
});

test("loopback cancellation exits a non-cooperative ping and ignores its late success", async () => {
  const entered = deferred(), ping = deferred();
  let accessors = 0;
  const { box } = loopback({
    ping: async () => { entered.resolve(); return ping.promise; },
    createRemoteAccessor: () => { accessors += 1; return {}; },
  });
  const [ctx, cancel] = createContext().withCancel();
  const pending = observe(box.ensureReady(ctx, "a"));
  await entered.promise;
  const reason = new Error("ping canceled");
  cancel(reason);
  const result = await Promise.race([pending, delay(75).then(() => "still waiting")]);
  ping.resolve({ outcome: "ok" });
  await pending;
  assert.notEqual(result, "still waiting");
  assertCanceled(result, reason);
  assert.equal(accessors, 0);
});

test("foreground cancellation does not wait for an unrelated watchdog poll", async () => {
  const watchdogSleep = deferred(), pollEntered = deferred(), pollDone = deferred(), nextSleep = deferred();
  let sleeps = 0, pings = 0;
  const { box } = loopback({
    sleep: async (_ms, signal) => {
      sleeps += 1;
      if (sleeps === 1) { await watchdogSleep.promise; return; }
      nextSleep.resolve();
      await delay(10_000, undefined, { signal });
    },
    ping: async () => {
      pings += 1;
      if (pings === 2) { pollEntered.resolve(); await pollDone.promise; }
      return { outcome: "ok" };
    },
  }, { telemetry: { reportDaemonPing() {} }, watchdogIntervalMs: 10 });
  await box.ensureReady(createContext(), "a");
  watchdogSleep.resolve();
  await pollEntered.promise;
  const [ctx, cancel] = createContext().withCancel();
  const pending = observe(box.ensureReady(ctx, "b"));
  const reason = new Error("foreground canceled behind watchdog");
  cancel(reason);
  const result = await Promise.race([pending, delay(75).then(() => "still waiting")]);
  pollDone.resolve();
  await pending;
  await nextSleep.promise;
  await box.dispose();
  assert.notEqual(result, "still waiting");
  assertCanceled(result, reason);
  assert.equal(pings, 2);
});

test("loopback rejects late successful ping without creating or caching a fork", async () => {
  const entered = deferred(), ready = deferred();
  let forks = 0;
  const { box, commands } = loopback({ ping: async (_ctx, endpoint) => {
    if (endpoint.port !== EXEC_DAEMON_PORT) { forks += 1; entered.resolve(); await ready.promise; }
    return { outcome: "ok" };
  } });
  const [ctx, cancel] = createContext().withCancel();
  const pending = observe(box.ensureWindow(ctx, "shared", 2, { ownerToken: "owner" }));
  await entered.promise;
  const reason = new Error("late ping canceled");
  cancel(reason);
  ready.resolve();
  assertCanceled(await pending, reason);
  await box.ensureWindow(createContext(), "shared", 2, { ownerToken: "owner" });
  assert.equal(forks, 2);
  assert.equal(commands.length, 2, "the canceled bringup must not populate the connection cache");
});

test("a cached loopback connection still honors cancellation before and after ping", async () => {
  let pendingPing;
  const { box } = loopback({ ping: async () => pendingPing == null ? { outcome: "ok" } : pendingPing.promise });
  await box.ensureWindow(createContext(), "shared", 2, { ownerToken: "owner" });
  const [abortedCtx, cancelBefore] = createContext().withCancel();
  const beforeReason = new Error("already canceled");
  cancelBefore(beforeReason);
  assertCanceled(await observe(box.ensureWindow(abortedCtx, "shared", 2, { ownerToken: "owner" })), beforeReason);
  pendingPing = deferred();
  const [ctx, cancel] = createContext().withCancel();
  const pending = observe(box.ensureWindow(ctx, "shared", 2, { ownerToken: "owner" }));
  await nextTurn();
  const reason = new Error("cached ping canceled");
  cancel(reason);
  pendingPing.resolve({ outcome: "ok" });
  assertCanceled(await pending, reason);
});
