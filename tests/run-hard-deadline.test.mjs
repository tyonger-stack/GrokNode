import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, "node_modules", ".cache"), { recursive: true });
const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };
const cacheDir = path.join(root, "node_modules", ".cache");

const lifecycleOut = path.join(cacheDir, "run-lifecycle-deadline.cjs");
await build({ entryPoints: [path.join(root, "source/host/extensions/transcript/run-lifecycle.ts")], bundle: true, platform: "node", format: "cjs", outfile: lifecycleOut, logLevel: "error", plugins: [jsToTs] });
const {
  RunLifecycle,
  RunProgressTracker,
  withRunHardDeadline,
  RUN_IDLE_DEADLINE_DEFAULT_MS,
  RUN_HARD_DEADLINE_DEFAULT_MS,
} = createRequire(import.meta.url)(lifecycleOut);

const poolOut = path.join(cacheDir, "agent-worker-pool-deadline.cjs");
await build({ entryPoints: [path.join(root, "source/host/agent-isolation/agent-worker-pool.ts")], bundle: true, platform: "node", format: "cjs", outfile: poolOut, logLevel: "error", plugins: [jsToTs] });
const { AgentWorkerPool, AgentWorkerConnection, DEFAULT_RPC_DEADLINE_MS } = createRequire(import.meta.url)(poolOut);

// Small deadline for every test in this file; the production defaults
// (10-minute idle, 2-hour total) would time the tests out instead. The tick
// floor stays at its 1s default, so awaiting tests budget one full tick cycle
// of margin.
process.env.SAND_RUN_HARD_DEADLINE_MS = "150";

// A worker that answers init and normal blobs, but never replies to the
// "poison" blob id — the observed 2026-09-28 wedge shape (thread alive, init
// answered, one op silently never returns).
const WEDGED_WORKER = `
const { parentPort, threadId } = require("node:worker_threads");
parentPort.on("message", (request) => {
  if (request.kind === "init") {
    parentPort.postMessage({ kind: "init-ok", requestId: request.requestId, threadId, pid: process.pid });
    return;
  }
  if (request.kind === "get-blob") {
    const poison = request.blobId.length === 1 && request.blobId[0] === 66;
    if (poison) return; // never answers - the deterministic wedge
    parentPort.postMessage({ kind: "get-blob-ok", requestId: request.requestId, blobData: new Uint8Array([1, 2, 3]) });
    return;
  }
  parentPort.postMessage({ kind: "ok", requestId: request.requestId });
});
`;

function makeFakeTm(agentId) {
  const appended = [];
  const interrupts = [];
  return {
    appended,
    interrupts,
    sendPipeline: { sendAttachmentBatchIds: new Map() },
    roster: { emitAgentUpdate() {} },
    runnerRegistry: {
      isAwaitingUserSelection: () => false,
      interruptWedgedRunForWatchdog: (id) => { interrupts.push(id); return true; },
    },
    sessions: {
      liveSessions: new Map([
        [agentId, { db: { appendTranscriptEntry: (entry) => appended.push(entry) } }],
      ]),
    },
    appendEntry: (entry) => appended.push(entry),
  };
}

test("withRunHardDeadline fails a never-settling task with a user-visible error", async () => {
  const wrapped = withRunHardDeadline("agent-x", "turn", () => new Promise(() => {}));
  let caught;
  await assert.rejects(wrapped(), (error) => { caught = error; return true; });
  assert.match(caught.message, /run hard deadline exceeded/);
  assert.match(caught.message, /source: turn/);
  // Must not read as an interrupt, or the failure notice gets filtered.
  for (const word of ["aborted", "cancel", "superseded", "interrupt", "watchdog"]) {
    assert.ok(!caught.message.toLowerCase().includes(word), `message must not contain "${word}"`);
  }
});

test("time spent waiting on the user does not consume the hard deadline", async () => {
  const awaiting = { value: true };
  const wrapped = withRunHardDeadline(
    "agent-x",
    "turn",
    () => new Promise(() => {}),
    () => awaiting.value,
  );
  const run = wrapped();
  let settled = false;
  run.catch(() => { settled = true; });
  // Park on the user well past the 150ms budget AND past a full tick cycle
  // (the tick floor is 1s), so the check actually runs while awaiting.
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(settled, false, "a run waiting on the user must not be failed");
  // Once the user answers, the budget starts biting again.
  awaiting.value = false;
  let caught;
  await run.catch((error) => { caught = error; });
  assert.match(caught.message, /run hard deadline exceeded/);
});

test("an unanswered prompt cannot pin the queue forever (awaiting cap)", async () => {
  const previous = process.env.SAND_RUN_HARD_DEADLINE_AWAITING_MAX_MS;
  process.env.SAND_RUN_HARD_DEADLINE_AWAITING_MAX_MS = "150";
  try {
    const wrapped = withRunHardDeadline(
      "agent-x",
      "turn",
      () => new Promise(() => {}),
      () => true,
    );
    let caught;
    await assert.rejects(wrapped(), (error) => { caught = error; return true; });
    assert.match(caught.message, /still awaiting the user/);
  } finally {
    if (previous === undefined) delete process.env.SAND_RUN_HARD_DEADLINE_AWAITING_MAX_MS;
    else process.env.SAND_RUN_HARD_DEADLINE_AWAITING_MAX_MS = previous;
  }
});

test("the deadline asks the runner to abort the run it gave up on", async () => {
  const aborted = [];
  const wrapped = withRunHardDeadline(
    "agent-x",
    "turn",
    () => new Promise(() => {}),
    () => false,
    (id) => aborted.push(id),
  );
  await assert.rejects(wrapped(), /run hard deadline exceeded/);
  assert.deepEqual(aborted, ["agent-x"]);
});

test("withRunHardDeadline passes a settling task through untouched", async () => {
  const wrapped = withRunHardDeadline("agent-x", "turn", async () => "done-marker");
  await wrapped();
  const failed = withRunHardDeadline("agent-x", "turn", async () => { throw new Error("real failure"); });
  await assert.rejects(failed(), /real failure/);
});

test("enqueueExclusiveRun releases the queue when a run wedges before inference", async () => {
  const agentId = "11111111-1111-4111-8111-111111111111";
  const previousScheduler = process.env.SAND_DISABLE_RUN_SCHEDULER;
  const previousDeadline = process.env.SAND_RUN_HARD_DEADLINE_MS;
  process.env.SAND_DISABLE_RUN_SCHEDULER = "1";
  process.env.SAND_RUN_HARD_DEADLINE_MS = "150";
  try {
    const tm = makeFakeTm(agentId);
    const lifecycle = new RunLifecycle(tm);

    // t1 hangs forever (a blob RPC that never settles); t2 queues behind it.
    let t2Started = false;
    const t1 = lifecycle.enqueueExclusiveRun(agentId, () => new Promise(() => {}), { lane: "user", source: "turn" });
    const t2 = lifecycle.enqueueExclusiveRun(
      agentId,
      async () => { t2Started = true; },
      { lane: "user", source: "turn" },
    );

    await assert.rejects(t1, /run hard deadline exceeded/);
    await t2;
    assert.equal(t2Started, true, "the queue must move on after the wedge is failed");

    // The failure surfaced as a turn-failure notice, not a silent drop.
    const notice = tm.appended.find((entry) => entry.text?.includes("ended without a reply"));
    assert.ok(notice, `expected a turn-failure notice, got: ${JSON.stringify(tm.appended.map((e) => e.text ?? e.content))}`);
    assert.match(notice.text, /run hard deadline exceeded/);
    // And the integration path actually asked the runner to abort the
    // abandoned run (not a no-op callback silently skipped).
    assert.deepEqual(tm.interrupts, [agentId]);
  } finally {
    if (previousScheduler === undefined) delete process.env.SAND_DISABLE_RUN_SCHEDULER;
    else process.env.SAND_DISABLE_RUN_SCHEDULER = previousScheduler;
    if (previousDeadline === undefined) delete process.env.SAND_RUN_HARD_DEADLINE_MS;
    else process.env.SAND_RUN_HARD_DEADLINE_MS = previousDeadline;
  }
});

test("enqueueExclusiveRun releases the scheduler queue too (production path)", async () => {
  const agentId = "22222222-2222-4222-8222-222222222222";
  const previousDeadline = process.env.SAND_RUN_HARD_DEADLINE_MS;
  const previousWatchdog = process.env.SAND_RUN_WATCHDOG_MS;
  delete process.env.SAND_DISABLE_RUN_SCHEDULER;
  process.env.SAND_RUN_HARD_DEADLINE_MS = "150";
  process.env.SAND_RUN_WATCHDOG_MS = "3600000";
  try {
    const tm = makeFakeTm(agentId);
    tm.telemetry = { reportQueueAccepted() {}, reportQueueDequeued() {}, reportQueueDepth() {}, onWatchdog() {} };
    const lifecycle = new RunLifecycle(tm);

    let t2Started = false;
    const t1 = lifecycle.enqueueExclusiveRun(agentId, () => new Promise(() => {}), { lane: "background", source: "automation" });
    const t2 = lifecycle.enqueueExclusiveRun(
      agentId,
      async () => { t2Started = true; },
      { lane: "background", source: "automation" },
    );

    await assert.rejects(t1, /run hard deadline exceeded/);
    await t2;
    assert.equal(t2Started, true, "the scheduler queue must move on too");
  } finally {
    if (previousDeadline === undefined) delete process.env.SAND_RUN_HARD_DEADLINE_MS;
    else process.env.SAND_RUN_HARD_DEADLINE_MS = previousDeadline;
    if (previousWatchdog === undefined) delete process.env.SAND_RUN_WATCHDOG_MS;
    else process.env.SAND_RUN_WATCHDOG_MS = previousWatchdog;
  }
});

test("a wedged bookkeeping run fails silently (no notice outside the whitelist)", async () => {
  const agentId = "33333333-3333-4333-8333-333333333333";
  const previousScheduler = process.env.SAND_DISABLE_RUN_SCHEDULER;
  const previousDeadline = process.env.SAND_RUN_HARD_DEADLINE_MS;
  process.env.SAND_DISABLE_RUN_SCHEDULER = "1";
  process.env.SAND_RUN_HARD_DEADLINE_MS = "150";
  try {
    const tm = makeFakeTm(agentId);
    const lifecycle = new RunLifecycle(tm);

    const t1 = lifecycle.enqueueExclusiveRun(agentId, () => new Promise(() => {}), { lane: "background", source: "ack-redrive" });
    await assert.rejects(t1, /run hard deadline exceeded/);
    assert.equal(tm.appended.length, 0, "bookkeeping failures must stay silent");
  } finally {
    if (previousScheduler === undefined) delete process.env.SAND_DISABLE_RUN_SCHEDULER;
    else process.env.SAND_DISABLE_RUN_SCHEDULER = previousScheduler;
    if (previousDeadline === undefined) delete process.env.SAND_RUN_HARD_DEADLINE_MS;
    else process.env.SAND_RUN_HARD_DEADLINE_MS = previousDeadline;
  }
});

test("a task that finishes beside an expired tick is not killed or notified", async () => {
  const agentId = "44444444-4444-4444-8444-444444444444";
  const previousScheduler = process.env.SAND_DISABLE_RUN_SCHEDULER;
  process.env.SAND_DISABLE_RUN_SCHEDULER = "1";
  try {
    const tm = makeFakeTm(agentId);
    const lifecycle = new RunLifecycle(tm);
  // A fast task that settles on the same macrotask as an expired check must
  // win: the deadline must not abort or notice a finished turn.
  const done = lifecycle.enqueueExclusiveRun(agentId, async () => {}, { lane: "user", source: "turn" });
  await done;
  assert.deepEqual(tm.interrupts, [], "no abort for a settled turn");
  assert.equal(tm.appended.length, 0, "no failure notice for a settled turn");
  } finally {
    if (previousScheduler === undefined) delete process.env.SAND_DISABLE_RUN_SCHEDULER;
    else process.env.SAND_DISABLE_RUN_SCHEDULER = previousScheduler;
  }
});

async function withEnv(overrides, body) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("defaults judge progress, not elapsed time: 10-minute idle, 2-hour total", () => {
  assert.equal(RUN_IDLE_DEADLINE_DEFAULT_MS, 10 * 60_000);
  assert.equal(RUN_HARD_DEADLINE_DEFAULT_MS, 2 * 60 * 60_000);
});

test("a run with no progress fails on the idle budget with a user-visible stall error", () =>
  withEnv({ SAND_RUN_HARD_DEADLINE_MS: "3600000", SAND_RUN_IDLE_DEADLINE_MS: "1500" }, async () => {
    const tracker = new RunProgressTracker();
    const wrapped = withRunHardDeadline(
      "agent-x",
      "turn",
      () => new Promise(() => {}),
      () => false,
      () => {},
      (id) => tracker.snapshot(id),
    );
    let caught;
    await assert.rejects(wrapped(), (error) => { caught = error; return true; });
    assert.match(caught.message, /run stalled: no model output and no tool activity for 1500ms/);
    assert.match(caught.message, /source: turn/);
    for (const word of ["aborted", "cancel", "superseded", "interrupt", "watchdog"]) {
      assert.ok(!caught.message.toLowerCase().includes(word), `message must not contain "${word}"`);
    }
  }));

test("steady progress keeps a run alive past the idle budget, and silence then trips it", () =>
  withEnv({ SAND_RUN_HARD_DEADLINE_MS: "3600000", SAND_RUN_IDLE_DEADLINE_MS: "1500" }, async () => {
    const tracker = new RunProgressTracker();
    const wrapped = withRunHardDeadline(
      "agent-x",
      "turn",
      () => new Promise(() => {}),
      () => false,
      () => {},
      (id) => tracker.snapshot(id),
    );
    const run = wrapped();
    let caught;
    run.catch((error) => { caught = error; });
    for (let elapsed = 0; elapsed < 3500; elapsed += 250) {
      tracker.record("agent-x", { type: "thinking-delta" });
      await sleep(250);
    }
    assert.equal(caught, undefined, "a run streaming output must not be failed");
    await run.catch(() => {});
    assert.match(caught.message, /run stalled/);
  }));

test("progress credited to another agent does not keep this run alive", () =>
  withEnv({ SAND_RUN_HARD_DEADLINE_MS: "3600000", SAND_RUN_IDLE_DEADLINE_MS: "1500" }, async () => {
    const tracker = new RunProgressTracker();
    const wrapped = withRunHardDeadline(
      "agent-x",
      "turn",
      () => new Promise(() => {}),
      () => false,
      () => {},
      (id) => tracker.snapshot(id),
    );
    const run = wrapped();
    const feeder = setInterval(() => tracker.record("agent-y", { type: "text-delta", text: "hi" }), 200);
    try {
      await assert.rejects(run, /run stalled/);
    } finally {
      clearInterval(feeder);
    }
  }));

test("a tool call in flight suspends the idle budget; the total cap still applies", () =>
  withEnv({ SAND_RUN_HARD_DEADLINE_MS: "3600000", SAND_RUN_IDLE_DEADLINE_MS: "1500" }, async () => {
    const tracker = new RunProgressTracker();
    tracker.record("agent-x", { type: "tool-call", id: "call-1", name: "shell", status: "pending" });
    const wrapped = withRunHardDeadline(
      "agent-x",
      "turn",
      () => new Promise(() => {}),
      () => false,
      () => {},
      (id) => tracker.snapshot(id),
    );
    const run = wrapped();
    let caught;
    run.catch((error) => { caught = error; });
    await sleep(3200);
    assert.equal(caught, undefined, "long tool work must not count as a stall");
    tracker.record("agent-x", { type: "tool-call", id: "call-1", name: "shell", status: "done" });
    await run.catch(() => {});
    assert.match(caught.message, /run stalled/);
  }));

test("the total cap fails a run that keeps making progress forever", async () => {
  const tracker = new RunProgressTracker();
  const feeder = setInterval(() => tracker.record("agent-x", { type: "thinking-delta" }), 50);
  try {
    const wrapped = withRunHardDeadline(
      "agent-x",
      "turn",
      () => new Promise(() => {}),
      () => false,
      () => {},
      (id) => tracker.snapshot(id),
    );
    await assert.rejects(wrapped(), /run hard deadline exceeded \(150ms\)/);
  } finally {
    clearInterval(feeder);
  }
});

test("RunProgressTracker counts model and tool events and tracks pending tools", () => {
  const tracker = new RunProgressTracker();
  assert.deepEqual(tracker.snapshot("a"), { progressSeq: 0, toolInFlight: false });
  tracker.record("a", { type: "retrying" });
  assert.equal(tracker.snapshot("a").progressSeq, 0, "retry bookkeeping is not progress");
  tracker.record("a", { type: "tool-call", id: "t1", name: "x", status: "pending" });
  tracker.record("a", { type: "tool-call", id: "t1", name: "x", status: "pending" });
  tracker.record("a", { type: "tool-call", id: "t2", name: "y", status: "pending" });
  assert.equal(tracker.snapshot("a").toolInFlight, true);
  tracker.record("a", { type: "tool-call", id: "t1", name: "x", status: "done" });
  assert.equal(tracker.snapshot("a").toolInFlight, true, "t2 still running");
  tracker.record("a", { type: "tool-call", id: "t2", name: "y", status: "failed" });
  assert.equal(tracker.snapshot("a").toolInFlight, false);
  assert.equal(tracker.snapshot("a").progressSeq, 5);
  tracker.record("a", { type: "tool-call", id: "t3", name: "z", status: "pending" });
  tracker.record("a", { type: "turn-ended" });
  assert.equal(tracker.snapshot("a").toolInFlight, false, "turn end clears dangling tools");
  tracker.record("a", { type: "tool-call", id: "t4", name: "z", status: "pending" });
  tracker.reset("a");
  assert.equal(tracker.snapshot("a").toolInFlight, false, "a new run starts without inherited tools");
  assert.deepEqual(tracker.snapshot("b"), { progressSeq: 0, toolInFlight: false });
});

test("enqueueExclusiveRun keeps a progressing run alive via trackProgressFromUpdate", () =>
  withEnv(
    { SAND_DISABLE_RUN_SCHEDULER: "1", SAND_RUN_HARD_DEADLINE_MS: "3600000", SAND_RUN_IDLE_DEADLINE_MS: "1500" },
    async () => {
      const agentId = "55555555-5555-4555-8555-555555555555";
      const tm = makeFakeTm(agentId);
      const lifecycle = new RunLifecycle(tm);
      let finish;
      const run = lifecycle.enqueueExclusiveRun(
        agentId,
        () => new Promise((resolve) => { finish = resolve; }),
        { lane: "user", source: "turn" },
      );
      for (let elapsed = 0; elapsed < 3500; elapsed += 250) {
        lifecycle.trackProgressFromUpdate({ type: "text-delta", text: "." }, agentId);
        await sleep(250);
      }
      finish();
      await run;
      assert.deepEqual(tm.interrupts, [], "a progressing run must not be aborted");
      assert.equal(tm.appended.length, 0, "no failure notice for a progressing run");
    },
  ));

test("enqueueExclusiveRun fails a silent run on the idle budget and notifies", () =>
  withEnv(
    { SAND_DISABLE_RUN_SCHEDULER: "1", SAND_RUN_HARD_DEADLINE_MS: "3600000", SAND_RUN_IDLE_DEADLINE_MS: "1500" },
    async () => {
      const agentId = "66666666-6666-4666-8666-666666666666";
      const tm = makeFakeTm(agentId);
      const lifecycle = new RunLifecycle(tm);
      // A tool left pending by an earlier run must not shield this one.
      lifecycle.trackProgressFromUpdate({ type: "tool-call", id: "stale", name: "x", status: "pending" }, agentId);
      const run = lifecycle.enqueueExclusiveRun(agentId, () => new Promise(() => {}), { lane: "user", source: "turn" });
      await assert.rejects(run, /run stalled/);
      assert.deepEqual(tm.interrupts, [agentId]);
      const notice = tm.appended.find((entry) => entry.text?.includes("ended without a reply"));
      assert.ok(notice, "expected a turn-failure notice");
      assert.match(notice.text, /run stalled/);
    },
  ));

test("a wedged worker RPC rejects, retires the connection, and the next op gets a fresh worker", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-worker-deadline-"));
  const workerPath = path.join(dir, "wedged-worker.cjs");
  await writeFile(workerPath, WEDGED_WORKER);

  const pool = new AgentWorkerPool({ workerEntryPath: workerPath, rpcDeadlineMs: 250, sweepIntervalMs: 60_000 });
  const dbPath = path.join(dir, "blobs.db");
  const poison = new Uint8Array([66]);
  const healthy = new Uint8Array([1, 2, 3, 4]);

  // Sanity: a responsive op answers.
  const good = await pool.getBlob("agent-x", dbPath, healthy);
  assert.deepEqual(good, new Uint8Array([1, 2, 3]));
  // The wedged connection leaves the pool on die(), so closeAll() will not
  // reach it - keep a handle for the explicit teardown below or the worker
  // thread keeps this test process alive forever.
  const wedged = pool.connections.get(dbPath);

  // The poison blob never comes back; the deadline converts the hang into a
  // rejection and retires the wedged connection.
  await assert.rejects(
    pool.getBlob("agent-x", dbPath, poison),
    (error) => {
      assert.match(error.message, /agent worker rpc timed out after 250ms/);
      assert.match(error.message, /kind: get-blob/);
      return true;
    },
  );
  assert.equal(pool.connections.size, 0, "the wedged connection must leave the pool");
  // The retired thread must actually go away: it still holds the agent's
  // open blob-db handle and the sweeper can no longer see it.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(wedged.worker.threadId, -1, "the wedged worker thread must be terminated");

  // The next op transparently runs on a fresh worker.
  const again = await pool.getBlob("agent-x", dbPath, healthy);
  assert.deepEqual(again, new Uint8Array([1, 2, 3]));
  assert.equal(pool.connections.size, 1, "a replacement worker should be pooled");

  await pool.closeAll();
});

test("default RPC deadline is one minute and env-overridable at construction", () => {
  assert.equal(DEFAULT_RPC_DEADLINE_MS, 60_000);
  const previous = process.env.SAND_AGENT_WORKER_RPC_DEADLINE_MS;
  process.env.SAND_AGENT_WORKER_RPC_DEADLINE_MS = "1234";
  try {
    const pool = new AgentWorkerPool({ workerEntryPath: "/nonexistent/worker.cjs" });
    assert.equal(pool.rpcDeadlineMs, 1234);
  } finally {
    if (previous === undefined) delete process.env.SAND_AGENT_WORKER_RPC_DEADLINE_MS;
    else process.env.SAND_AGENT_WORKER_RPC_DEADLINE_MS = previous;
  }
});

test("defaultWorkerEntryPath prefers the worker beside the pool, else the bundle layout", async () => {
  const bundle = await import(`file://${poolOut}`);
  assert.equal(typeof bundle.defaultWorkerEntryPath, "function");
  // In this checkout only the .ts sources exist (no compiled .cjs beside
  // the pool), so the probe must fall back to the bundle layout the
  // packager produces: dist/host/agent-isolation/agent-store-worker.cjs.
  // (The live container verified the fallback resolves to the real file.)
  const resolved = bundle.defaultWorkerEntryPath();
  assert.ok(
    resolved.endsWith(path.join("agent-isolation", "agent-store-worker.cjs")),
    `unexpected fallback: ${resolved}`,
  );
});
