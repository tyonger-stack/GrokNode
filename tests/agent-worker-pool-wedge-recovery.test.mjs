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

const poolOut = path.join(cacheDir, "agent-worker-pool-deadline.cjs");
await build({ entryPoints: [path.join(root, "source/host/agent-isolation/agent-worker-pool.ts")], bundle: true, platform: "node", format: "cjs", outfile: poolOut, logLevel: "error", plugins: [jsToTs] });
const { AgentWorkerPool, DEFAULT_RPC_DEADLINE_MS } = createRequire(import.meta.url)(poolOut);

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

test("ForwardingInteractionListener forwards summary lifecycle into turn updates", async () => {
  const adaptersOut = path.join(cacheDir, "agent-adapters-summary.cjs");
  await build({
    entryPoints: [path.join(root, "source/host/runner/agent-adapters.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: adaptersOut,
    logLevel: "error",
    plugins: [jsToTs],
  });
  const { ForwardingInteractionListener } = createRequire(import.meta.url)(adaptersOut);
  const seen = [];
  const listener = new ForwardingInteractionListener((update) => seen.push(update.type));
  await listener.sendUpdate({}, { message: { case: "summaryStarted", value: {} } });
  await listener.sendUpdate({}, { message: { case: "summaryCompleted", value: {} } });
  assert.deepEqual(seen, ["summary-started", "summary-completed"]);
});
