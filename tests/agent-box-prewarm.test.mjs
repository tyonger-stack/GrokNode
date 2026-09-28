import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  stdin: {
    contents: [
      'export * from "./source/host/box/agent-box-prewarm.ts";',
      'export { ForeverBoxService } from "./source/host/extensions/forever-box/forever-box-service.ts";',
      'export { HostBox } from "./source/host/extensions/forever-box/host-box.ts";',
      'export { createContext, createKey } from "./source/packages/context/core.ts";',
    ].join("\n"),
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "error",
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const flush = () => new Promise((resolve) => setImmediate(resolve));

class FakeClock {
  time = 0;
  timers = new Set();
  now = () => this.time;
  monotonicNow = () => this.time;
  schedule(delay, callback) {
    const timer = { at: this.time + delay, callback };
    this.timers.add(timer);
    return { dispose: () => this.timers.delete(timer) };
  }
  async advance(ms) {
    const target = this.time + ms;
    for (;;) {
      const next = [...this.timers].filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      this.time = next.at;
      this.timers.delete(next);
      next.callback();
      await flush();
    }
    this.time = target;
    await flush();
  }
}

function makeScheduler(ensure, options = {}) {
  const clock = new FakeClock();
  const logs = [];
  const warnings = [];
  const scheduler = new api.AgentBoxPrewarmScheduler({
    ctx: api.createContext(),
    ensure,
    clock,
    log: (message) => logs.push(message),
    warn: (message) => warnings.push(message),
    attemptTimeoutMs: 100,
    retryDelayMs: 10,
    ...options,
  });
  return { scheduler, clock, logs, warnings };
}

test("prewarm coalesces agents and bounds concurrent and pending work", async (t) => {
  const work = [];
  const { scheduler, clock, warnings } = makeScheduler((ctx, id) => {
    const deferred = Promise.withResolvers();
    work.push({ ctx, id, ...deferred });
    return deferred.promise;
  }, { maxPending: 1 });
  t.after(() => scheduler.dispose());

  for (const id of ["a", "a", "b", "c", "c", "overflow"]) scheduler.prewarm(id);
  await flush();
  assert.deepEqual(work.map(({ id }) => id), ["a", "b"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /queue.*full/);

  work[0].resolve();
  await flush();
  assert.deepEqual(work.map(({ id }) => id), ["a", "b", "c"]);
  work[1].resolve();
  work[2].resolve();
  await flush();
  assert.equal(clock.timers.size, 0);
});

test("prewarm retries a finite number of times without resetting on duplicate requests", async (t) => {
  const calls = [];
  const { scheduler, clock, warnings } = makeScheduler(async (ctx, id) => {
    calls.push({ ctx, id });
    throw new Error("not ready");
  });
  t.after(() => scheduler.dispose());

  scheduler.prewarm("a");
  await flush();
  assert.equal(calls.length, 1);
  scheduler.prewarm("a");
  await clock.advance(9);
  assert.equal(calls.length, 1);
  await clock.advance(1);
  assert.equal(calls.length, 2);
  await clock.advance(10);
  assert.equal(calls.length, 3);
  await clock.advance(1_000);
  assert.equal(calls.length, 3);
  assert.match(warnings.at(-1), /gave up after 3 attempts.*not ready/);
  assert.equal(clock.timers.size, 0);
});

test("deadline aborts the Context and retains capacity until the underlying ensure settles", async (t) => {
  const work = [];
  const { scheduler, clock, warnings } = makeScheduler((ctx, id) => {
    const deferred = Promise.withResolvers();
    work.push({ ctx, id, ...deferred });
    return deferred.promise;
  }, { maxConcurrency: 1, attempts: 2 });
  t.after(() => scheduler.dispose());

  scheduler.prewarm("stuck");
  scheduler.prewarm("queued");
  await flush();
  await clock.advance(100);
  assert.equal(work[0].ctx.signal.aborted, true);
  assert.match(work[0].ctx.reason.message, /Deadline exceeded/);
  assert.equal(work.length, 1);
  assert.match(warnings.at(-1), /still settling/);
  await clock.advance(1_000);
  scheduler.prewarm("stuck");
  assert.equal(work.length, 1, "no retry or another agent may overlap uncooperative work");

  work[0].resolve();
  await flush();
  await clock.advance(10);
  assert.deepEqual(work.map(({ id }) => id), ["stuck", "stuck"]);
  assert.equal(work[1].ctx.signal.aborted, false, "each attempt gets a fresh Context");
  work[1].resolve();
  await flush();
  assert.deepEqual(work.map(({ id }) => id), ["stuck", "stuck", "queued"]);
  work[2].resolve();
  await flush();
  assert.equal(clock.timers.size, 0);
});

test("cancel and dispose remove queued work and stop backoff without restarting late completions", async () => {
  const calls = [];
  const { scheduler, clock } = makeScheduler(async (ctx, id) => {
    calls.push({ ctx, id });
    throw new Error("not ready");
  }, { maxConcurrency: 1 });
  scheduler.prewarm("retrying");
  scheduler.prewarm("queued");
  scheduler.cancel("queued");
  await flush();
  scheduler.cancel("retrying");
  await clock.advance(1_000);
  assert.deepEqual(calls.map(({ id }) => id), ["retrying"]);
  assert.equal(clock.timers.size, 0);
  scheduler.dispose();
  scheduler.prewarm("after-dispose");
  await flush();
  assert.equal(calls.length, 1);

  const parent = api.createContext().withCancel();
  const deferred = Promise.withResolvers();
  const active = [];
  const second = makeScheduler((ctx, id) => {
    active.push({ ctx, id });
    return deferred.promise;
  }, { ctx: parent[0], maxConcurrency: 1 });
  second.scheduler.prewarm("active");
  second.scheduler.prewarm("queued");
  parent[1]();
  await flush();
  assert.equal(active[0].ctx.signal.aborted, true);
  deferred.resolve();
  await second.clock.advance(1_000);
  second.scheduler.prewarm("after-parent-abort");
  await flush();
  assert.deepEqual(active.map(({ id }) => id), ["active"]);
  assert.equal(second.clock.timers.size, 0);
});

function makeService(ensureReady, options = {}) {
  const releases = [];
  const logs = [];
  const clock = new FakeClock();
  const box = new api.HostBox({
    ensureReady,
    releaseWindow: async (ctx, id) => {
      assert.equal(ctx.signal.aborted, false, "window cleanup needs a usable Context");
      releases.push(id);
    },
    runState: async () => "running",
    listBoxes: async () => [],
    uploadFile: async () => {},
    downloadFile: async () => new Uint8Array(),
  });
  const unused = () => { throw new Error("unexpected background policy"); };
  const service = new api.ForeverBoxService({
    box,
    lifecycleClient: { recreateInBox: unused, fetchImageUpdateAvailable: unused },
    trays: { pushError: unused },
    telemetry: { reportBoxRecreateDecided: unused, reportBoxImageCheck: unused },
    imagePolling: { start: unused },
    imagePollingStartDelay: { schedule: unused },
    imageSeedRetry: { runWithRetry: unused },
    imageCheckDeadline: { run: unused },
    migrationExpiry: { arm: unused },
    screenshotDeadline: { run: unused },
    recreateFlushWaitDeadline: { run: unused },
    flushPendingUploads: unused,
    autoUpdateEnabled: false,
    hostBundleAutoUpdateEnabled: false,
    isInBox: () => false,
    log: (message) => logs.push(message),
    ...options,
    prewarm: { clock, attemptTimeoutMs: 100, retryDelayMs: 10, ...options.prewarm },
  });
  return { service, box, releases, logs, clock };
}

const connection = { vncUrl: "http://box/vnc" };

test("service ensure joins active prewarm and release waits for cancellation before window cleanup", async (t) => {
  const deferred = Promise.withResolvers();
  const calls = [];
  const { service, releases, clock, logs } = makeService((ctx, id) => {
    calls.push({ ctx, id });
    return deferred.promise;
  });
  t.after(() => service.dispose());
  assert.equal(service.prewarm({ id: "a" }), undefined);
  await flush();
  const foreground = service.ensure({ id: "a" });
  const foregroundRejected = assert.rejects(foreground, { name: "AbortError" });
  await flush();
  assert.equal(calls.length, 1);
  const release = service.releaseAgent("a");
  assert.equal(calls[0].ctx.signal.aborted, true);
  assert.deepEqual(releases, []);
  service.prewarm({ id: "a" });
  deferred.resolve(connection);
  await release;
  await foregroundRejected;
  await clock.advance(1_000);
  assert.deepEqual(releases, ["a"]);
  assert.equal(calls.length, 1);
  assert.equal(logs.some((message) => /completed/.test(message)), false);
  await assert.rejects(service.ensure({ id: "a" }), { name: "AbortError" });
});

test("foreground service ensure survives the prewarm deadline on the same HostBox startup", async (t) => {
  const deferred = Promise.withResolvers();
  const calls = [];
  const { service, box, clock } = makeService((ctx, id) => {
    calls.push({ ctx, id });
    return deferred.promise;
  }, { prewarm: { attemptTimeoutMs: 120_000 } });
  t.after(() => service.dispose());
  service.prewarm({ id: "shared" });
  await flush();
  const foreground = service.ensure({ id: "shared" });
  const foregroundResult = foreground.then(
    (status) => ({ status }),
    (error) => ({ error }),
  );
  await flush();
  assert.equal(calls.length, 1, "HostBox must coalesce the raw allocation");
  await clock.advance(120_000);
  deferred.resolve(connection);
  const result = await foregroundResult;
  assert.equal(result.error?.message, undefined, "foreground must not inherit the prewarm deadline");
  assert.equal(result.status.state, "running");
  assert.equal(calls[0].ctx.signal.aborted, false, "foreground keeps the raw startup alive");
  assert.equal(box.vncUrls.get("shared"), connection.vncUrl);
});

for (const action of ["release", "dispose"]) {
  test(`${action} still cancels all foreground service waiters after the prewarm deadline`, async (t) => {
    const deferred = Promise.withResolvers();
    const calls = [];
    const { service, box, clock, releases } = makeService((ctx, id) => {
      calls.push({ ctx, id });
      return deferred.promise;
    }, { prewarm: { attemptTimeoutMs: 120_000 } });
    t.after(() => service.dispose());
    service.prewarm({ id: "shared" });
    await flush();
    const foregrounds = [service.ensure({ id: "shared" }), service.ensure({ id: "shared" })];
    const rejected = foregrounds.map((foreground) => assert.rejects(foreground, { name: "AbortError" }));
    await flush();
    await clock.advance(120_000);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ctx.signal.aborted, false);
    const cleanup = action === "release" ? service.releaseAgent("shared") : service.dispose();
    assert.equal(calls[0].ctx.signal.aborted, true, "all service-owned demand must be canceled");
    assert.deepEqual(releases, [], "raw startup must settle before window cleanup");
    deferred.resolve(connection);
    await cleanup;
    await Promise.all(rejected);
    await clock.advance(10_000);
    assert.equal(calls.length, 1, "cancellation must prevent background retries");
    assert.equal(box.vncUrls.has("shared"), false);
    assert.deepEqual(releases, action === "release" ? ["shared"] : []);
    assert.equal(clock.timers.size, 0);
  });
}

test("foreground ensure takes queued prewarm and later prewarm joins foreground work", async (t) => {
  const work = [];
  const { service, clock } = makeService((ctx, id) => {
    const deferred = Promise.withResolvers();
    work.push({ ctx, id, ...deferred });
    return deferred.promise;
  }, { prewarm: { maxConcurrency: 1 } });
  t.after(() => service.dispose());
  service.prewarm({ id: "busy" });
  service.prewarm({ id: "foreground" });
  await flush();
  const foreground = service.ensure({ id: "foreground" });
  await flush();
  service.prewarm({ id: "foreground" });
  assert.deepEqual(work.map(({ id }) => id), ["busy", "foreground"]);
  work[1].resolve(connection);
  assert.equal((await foreground).state, "running");
  work[0].resolve(connection);
  await flush();
  await clock.advance(1_000);
  assert.deepEqual(work.map(({ id }) => id), ["busy", "foreground"]);
});

test("release before dispatch and during retry backoff prevents further prewarm", async (t) => {
  const calls = [];
  const { service, clock, releases } = makeService(async (ctx, id) => {
    calls.push({ ctx, id });
    throw new Error("not ready");
  });
  t.after(() => service.dispose());
  service.prewarm({ id: "immediate" });
  await service.releaseAgent("immediate");
  assert.equal(calls.length, 0, "release must fence the pending promise microtask too");
  service.prewarm({ id: "retrying" });
  await flush();
  assert.equal(calls.length, 1);
  await service.releaseAgent("retrying");
  service.prewarm({ id: "retrying" });
  await clock.advance(1_000);
  assert.equal(calls.length, 1);
  assert.deepEqual(releases, ["immediate", "retrying"]);
  assert.equal(clock.timers.size, 0);
});

test("service disposal aborts active work and discards queued work and late success", async () => {
  const work = [];
  const { service, clock, logs } = makeService((ctx, id) => {
    const deferred = Promise.withResolvers();
    work.push({ ctx, id, ...deferred });
    return deferred.promise;
  });
  for (const id of ["a", "b", "queued"]) service.prewarm({ id });
  await flush();
  assert.equal(work.length, 2);
  service.dispose();
  service.dispose();
  service.prewarm({ id: "after-dispose" });
  for (const item of work) {
    assert.equal(item.ctx.signal.aborted, true);
    item.resolve(connection);
  }
  await clock.advance(1_000);
  assert.equal(work.length, 2);
  assert.equal(logs.some((message) => /completed/.test(message)), false);
  assert.equal(clock.timers.size, 0);
  await assert.rejects(service.ensure({ id: "after-dispose" }), { name: "AbortError" });
});

test("scheduler validates finite bounds and never leaks failures from background logging", async () => {
  for (const maxConcurrency of [0, -1, NaN, Infinity, 1.5]) {
    assert.throws(() => makeScheduler(async () => {}, { maxConcurrency }), RangeError);
  }
  for (const maxPending of [-1, NaN, Infinity, 1.5]) {
    assert.throws(() => makeScheduler(async () => {}, { maxPending }), RangeError);
  }
  for (const attempts of [0, -1, NaN, Infinity]) {
    assert.throws(() => makeScheduler(async () => {}, { attempts }), RangeError);
  }
  const { scheduler, clock } = makeScheduler(() => { throw new Error("sync failure"); }, {
    attempts: 1,
    maxPending: 0,
    warn: () => { throw new Error("logger failed"); },
  });
  scheduler.prewarm("failed");
  await flush();
  assert.equal(clock.timers.size, 0);
  scheduler.dispose();
});

test("release returns within its wait budget while late ensure cleanup remains ordered", async (t) => {
  const deferred = Promise.withResolvers();
  const calls = [];
  const { service, clock, releases, logs } = makeService((ctx, id) => {
    calls.push({ ctx, id });
    return deferred.promise;
  });
  t.after(() => service.dispose());
  service.prewarm({ id: "stuck" });
  await flush();
  let returned = false;
  const release = service.releaseAgent("stuck").then(() => { returned = true; });
  await clock.advance(4_999);
  assert.equal(returned, false);
  assert.deepEqual(releases, []);
  await clock.advance(1);
  assert.equal(returned, true, "agent deletion must not wait forever for an abort-ignoring ensure");
  await release;
  assert.match(logs.at(-1), /cleanup.*pending/);
  assert.equal(calls[0].ctx.signal.aborted, true);
  service.prewarm({ id: "stuck" });
  deferred.resolve(connection);
  await flush();
  await clock.advance(1_000);
  assert.deepEqual(releases, ["stuck"]);
  assert.equal(calls.length, 1);
  assert.equal(clock.timers.size, 0);
});

test("service release fences direct HostBox foreground waiters before awaiting raw cleanup", async (t) => {
  const deferred = Promise.withResolvers();
  const calls = [];
  const { service, box, releases } = makeService((ctx, id) => {
    calls.push({ ctx, id });
    return deferred.promise;
  });
  t.after(() => service.dispose());
  service.prewarm({ id: "shared" });
  await flush();
  const foreground = box.ensureReady(api.createContext(), "shared");
  const rejected = assert.rejects(foreground, /released during startup/);
  await flush();
  assert.equal(calls.length, 1);
  const release = service.releaseAgent("shared");
  assert.equal(calls[0].ctx.signal.aborted, true, "release must fence direct foreground waiters immediately");
  assert.deepEqual(releases, [], "inner cleanup must wait for raw startup settlement");
  deferred.resolve(connection);
  await release;
  await rejected;
  assert.deepEqual(releases, ["shared"]);
  assert.equal(box.vncUrls.has("shared"), false);
});

test("prewarm ignores invalid ids without affecting the foreground caller", async (t) => {
  const calls = [];
  const { service } = makeService(async (_ctx, id) => { calls.push(id); return connection; });
  t.after(() => service.dispose());
  for (const id of ["", "  ", ".", "..", "../agent", "a/b", "a\\b", "a\0b", null, undefined]) {
    assert.doesNotThrow(() => service.prewarm({ id }));
  }
  await flush();
  assert.deepEqual(calls, []);
});
