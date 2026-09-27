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
const requireBundled = createRequire(import.meta.url);

async function loadTs(entry) {
  const out = path.join(cacheDir, entry.replace(/\//g, "-") + ".cjs");
  await build({ entryPoints: [path.join(root, "source", entry)], bundle: true, platform: "node", format: "cjs", outfile: out, logLevel: "error", plugins: [jsToTs] });
  return requireBundled(out);
}

const runtime = await loadTs("host/extensions/transcript/turn-runtime.ts");
const admission = await loadTs("host/extensions/transcript/run-admission.ts");
const detector = await loadTs("host/extensions/transcript/tool-repeat-detector.ts");
const { classifyAgentError, httpStatusOf, quotaWordingOf, isTurnInterruptedFailure } = runtime;
const { admitRun, resolveMaxRunQueueDepth } = admission;
const { ToolRepeatDetector, toolRepeatKey, LOOP_SUSPECT_THRESHOLDS } = detector;

const apiError = (statusCode, message = "provider failure") => {
  const error = new Error(message);
  error.name = "AI_APICallError";
  error.statusCode = statusCode;
  return error;
};

// --- classifier: auth / quota ---

test("401 and 403 classify to a non-retryable auth failure", () => {
  for (const status of [401, 403]) {
    const classified = classifyAgentError(apiError(status));
    assert.equal(classified.code, "SAND-E0415");
    assert.equal(classified.statusCode, status);
  }
});

test("402 classifies to a non-retryable quota failure", () => {
  const classified = classifyAgentError(apiError(402, "payment required"));
  assert.equal(classified.code, "SAND-E0416");
});

test("quota wording classifies without an HTTP status", () => {
  const classified = classifyAgentError(new Error("insufficient credits for this request"));
  assert.equal(classified.code, "SAND-E0416");
});

test("httpStatusOf finds nested and absent statuses", () => {
  assert.equal(httpStatusOf(apiError(429)), 429);
  assert.equal(httpStatusOf(new Error("plain")), undefined);
  const wrapped = new Error("outer");
  wrapped.cause = apiError(401);
  assert.equal(httpStatusOf(wrapped), 401);
});

test("interrupt signals are recognized as interrupts, not failures", () => {
  const aborted = new Error("The operation was aborted");
  aborted.name = "AbortError";
  assert.equal(isTurnInterruptedFailure(aborted), true);
  assert.equal(isTurnInterruptedFailure(new Error("superseded by a new user message")), true);
  assert.equal(isTurnInterruptedFailure(new Error("run-queue watchdog: releasing a wedged predecessor")), true);
  assert.equal(isTurnInterruptedFailure(new Error("agent deleted")), true);
  assert.equal(isTurnInterruptedFailure(new Error("ECONNRESET: connection reset by peer")), false);
  assert.equal(isTurnInterruptedFailure(apiError(429, "rate limited")), false);
});

// --- admission gate ---

test("admitRun refuses only unattended traffic over the depth limit", () => {
  const max = 32;
  for (const surface of ["automation", "connector"]) {
    assert.deepEqual(
      admitRun({ surface, queueDepth: 32, maxQueueDepth: max, hasActiveRun: true }),
      { action: "refuse", code: "queue_full" },
    );
  }
  for (const surface of ["user", "group", "agent"]) {
    assert.deepEqual(
      admitRun({ surface, queueDepth: 99, maxQueueDepth: max, hasActiveRun: true }),
      { action: "queue" },
    );
  }
});

test("admitRun starts idle agents and queues into shallow backlogs", () => {
  assert.deepEqual(
    admitRun({ surface: "automation", queueDepth: 0, maxQueueDepth: 32, hasActiveRun: false }),
    { action: "start" },
  );
  assert.deepEqual(
    admitRun({ surface: "automation", queueDepth: 5, maxQueueDepth: 32, hasActiveRun: true }),
    { action: "queue" },
  );
  assert.deepEqual(resolveMaxRunQueueDepth({}), 32);
  assert.deepEqual(resolveMaxRunQueueDepth({ SAND_RUN_QUEUE_MAX: "8" }), 8);
});

// --- repeat detector ---

test("detector fires exactly on thresholds and resets per turn", () => {
  const repeats = new ToolRepeatDetector();
  let fired = [];
  for (let i = 1; i <= 21; i += 1) {
    const hit = repeats.record("s1", "shell", { cmd: "ls -la" });
    if (hit != null) fired.push(hit.count);
  }
  assert.deepEqual(fired, [5, 10, 20]);
  repeats.settle("s1");
  assert.equal(repeats.record("s1", "shell", { cmd: "ls -la" }), undefined);
  repeats.settle("s1");
  for (let i = 1; i <= 5; i += 1) {
    const hit = repeats.record("s1", "shell", { cmd: "ls -la" });
    if (i < 5) assert.equal(hit, undefined);
    else assert.deepEqual(hit, { count: 5, threshold: 5 });
  }

  // different arguments are different keys: same key 4x stays silent,
  // 5th hit reports with the threshold
  for (let i = 1; i <= 4; i += 1)
    assert.equal(repeats.record("s2", "shell", { cmd: "a" }), undefined);
  repeats.record("s2", "shell", { cmd: "b" });
  assert.deepEqual(repeats.record("s2", "shell", { cmd: "a" }), { count: 5, threshold: 5 });
});

test("detector ignores bare tool names and empty arguments", () => {
  assert.equal(toolRepeatKey("shell", undefined), null);
  assert.equal(toolRepeatKey("shell", {}), "shell:{}");
  assert.equal(toolRepeatKey("", { cmd: "x" }), null);
  assert.deepEqual(LOOP_SUSPECT_THRESHOLDS, [5, 10, 20]);
});
