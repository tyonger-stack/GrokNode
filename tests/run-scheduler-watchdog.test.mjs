import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, "node_modules", ".cache"), { recursive: true });
const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };
const cacheDir = path.join(root, "node_modules", ".cache");

const schedulerOut = path.join(cacheDir, "run-scheduler.cjs");
await build({ entryPoints: [path.join(root, "source/host/extensions/transcript/run-scheduler.ts")], bundle: true, platform: "node", format: "cjs", outfile: schedulerOut, logLevel: "error", plugins: [jsToTs] });
const { SandRunScheduler } = createRequire(import.meta.url)(schedulerOut);

class FakeClock {
  nowMs = 1_000_000;
  timers = [];
  now = () => this.nowMs;
  schedule = (delayMs, callback) => {
    const timer = { at: this.nowMs + delayMs, callback, disposed: false };
    this.timers.push(timer);
    return { dispose: () => { timer.disposed = true; } };
  };
  advance(ms) {
    const target = this.nowMs + ms;
    let guard = 0;
    for (;;) {
      if (++guard > 10_000) throw new Error(`FakeClock advance loop: guard=${guard} nowMs=${this.nowMs} target=${target} timers=${JSON.stringify(this.timers.filter((t) => !t.disposed).map((t) => t.at))}`);
      const next = this.timers
        .filter((timer) => !timer.disposed && timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (next == null) break;
      this.nowMs = Math.max(this.nowMs, next.at);
      next.disposed = true; // a fired timer is consumed, like real setTimeout
      next.callback();
    }
    this.nowMs = target;
  }
}

function makeScheduler({ awaitingRef = { value: false }, watchdogMs = 1_000, watchdogGraceMs = 500, withProbe = true } = {}) {
  const clock = new FakeClock();
  const calls = { interrupts: 0, watchdogStages: [], startedTasks: 0 };
  const options = {
    watchdogMs,
    watchdogGraceMs,
    interruptWedgedRun: () => {
      calls.interrupts += 1;
      return true;
    },
    ...(withProbe
      ? { isAwaitingUserSelection: () => awaitingRef.value === true }
      : {}),
    telemetry: {
      onAccepted: () => {},
      onDequeued: () => {},
      onWatchdog: (event) => calls.watchdogStages.push(event.stage),
    },
    onRunStart: () => calls.startedTasks += 1,
  };
  return { scheduler: new SandRunScheduler(options, clock), clock, calls };
}

const hangForever = () => new Promise(() => {});

test("watchdog defers while the active run is awaiting user selection", async () => {
  const awaitingRef = { value: true };
  const { scheduler, clock, calls } = makeScheduler({ awaitingRef });
  void scheduler.enqueue("bot-1", hangForever, { lane: "background", source: "automation" });
  await new Promise((resolve) => setImmediate(resolve)); // the hang becomes the active run
  await new Promise((resolve) => setImmediate(resolve));
  let userTaskRan = false;
  void scheduler.enqueue("bot-1", async () => {
    userTaskRan = true;
  }, { lane: "user", source: "turn" });
  // pump runs on a microtask; flush it before driving the fake clock
  await new Promise((resolve) => setImmediate(resolve));

  clock.advance(1_000); // first window: deferred, not interrupted
  assert.equal(calls.interrupts, 0);
  assert.ok(calls.watchdogStages.includes("deferred_awaiting_user"));
  clock.advance(1_000); // second window: still deferred
  assert.equal(calls.interrupts, 0);
  assert.equal(
    calls.watchdogStages.filter((stage) => stage === "deferred_awaiting_user").length,
    2,
  );
  assert.equal(userTaskRan, false);
});

test("watchdog trips once the user-selection pause ends", async () => {
  const awaitingRef = { value: true };
  const { scheduler, clock, calls } = makeScheduler({ awaitingRef });
  void scheduler.enqueue("bot-1", hangForever, { lane: "background", source: "automation" });
  await new Promise((resolve) => setImmediate(resolve)); // the hang becomes the active run
  await new Promise((resolve) => setImmediate(resolve));
  let userTaskRan = false;
  void scheduler.enqueue("bot-1", async () => {
    userTaskRan = true;
  }, { lane: "user", source: "turn" });
  // pump runs on a microtask; flush it before driving the fake clock
  await new Promise((resolve) => setImmediate(resolve));

  clock.advance(2_000); // deferred while awaiting
  assert.equal(calls.interrupts, 0);
  awaitingRef.value = false; // the user answered elsewhere; the run is on its own now
  clock.advance(1_000); // fresh window expires with no exemption
  assert.equal(calls.interrupts, 1);
  assert.ok(calls.watchdogStages.includes("trip"));

  clock.advance(500); // grace expires: the wedged run escapes, queue pumps
  assert.equal(userTaskRan, true);
  assert.equal(calls.startedTasks, 2);
});

test("watchdog trips immediately when the exemption probe is absent", async () => {
  const { scheduler, clock, calls } = makeScheduler({ withProbe: false });
  void scheduler.enqueue("bot-1", hangForever, { lane: "background", source: "automation" });
  await new Promise((resolve) => setImmediate(resolve)); // the hang becomes the active run
  await new Promise((resolve) => setImmediate(resolve));
  let userTaskRan = false;
  void scheduler.enqueue("bot-1", async () => {
    userTaskRan = true;
  }, { lane: "user", source: "turn" });
  // pump runs on a microtask; flush it before driving the fake clock
  await new Promise((resolve) => setImmediate(resolve));

  clock.advance(1_000);
  assert.equal(calls.interrupts, 1);
  clock.advance(500);
  assert.equal(userTaskRan, true);
});

test("watchdog never arms without a queued user message", async () => {
  const awaitingRef = { value: true };
  const { scheduler, clock, calls } = makeScheduler({ awaitingRef });
  void scheduler.enqueue("bot-1", hangForever, { lane: "background", source: "automation" });
  await new Promise((resolve) => setImmediate(resolve));
  clock.advance(10_000);
  assert.deepEqual(calls.watchdogStages, []);
  assert.equal(calls.interrupts, 0);
});
