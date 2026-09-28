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
const { RunLifecycle, withRunHardDeadline } = createRequire(import.meta.url)(lifecycleOut);

const poolOut = path.join(cacheDir, "agent-worker-pool-deadline.cjs");
await build({ entryPoints: [path.join(root, "source/host/agent-isolation/agent-worker-pool.ts")], bundle: true, platform: "node", format: "cjs", outfile: poolOut, logLevel: "error", plugins: [jsToTs] });
const { AgentWorkerPool, AgentWorkerConnection, DEFAULT_RPC_DEADLINE_MS } = createRequire(import.meta.url)(poolOut);

// Small deadline for every test in this file; the production default is
// 30 minutes and would time the tests out instead.
process.env.SAND_RUN_HARD_DEADLINE_MS = "150";

// A worker that answers init and normal blobs, but never replies to the
// "poison" blob id — the observed 2026-09-28 wedge shape (thread alive, init
// answered, one op silently never returns).
const WEDGED_WORKER = `
const { parentPort, threadId } = require("node:worker_threads");
parentPort.on("message", (request) => {
  if (request.kind === "init") {
    parentPort.postMessage({ kind: "ready", requestId: request.requestId, threadId, pid: process.pid });
    return;
  }
  if (request.kind === "get-blob") {
    const poison = request.blobId.length === 1 && request.blobId[0] === 66;
    if (poison) return; // never answers - the deterministic wedge
    parentPort.postMessage({ kind: "blob", requestId: request.requestId, blobData: new Uint8Array([1, 2, 3]) });
    return;
  }
  parentPort.postMessage({ kind: "ok", requestId: request.requestId });
});
`;

function makeFakeTm(agentId) {
  const appended = [];
  return {
    appended,
    sendPipeline: { sendAttachmentBatchIds: new Map() },
    roster: { emitAgentUpdate() {} },
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
  } finally {
    if (previousScheduler === undefined) delete process.env.SAND_DISABLE_RUN_SCHEDULER;
    else process.env.SAND_DISABLE_RUN_SCHEDULER = previousScheduler;
    if (previousDeadline === undefined) delete process.env.SAND_RUN_HARD_DEADLINE_MS;
    else process.env.SAND_RUN_HARD_DEADLINE_MS = previousDeadline;
  }
});

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

  // The next op transparently runs on a fresh worker.
  const again = await pool.getBlob("agent-x", dbPath, healthy);
  assert.deepEqual(again, new Uint8Array([1, 2, 3]));
  assert.equal(pool.connections.size, 1, "a replacement worker should be pooled");

  await wedged.worker.terminate();
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
