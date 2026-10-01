import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const cacheDir = path.join(root, "node_modules", ".cache");
await mkdir(cacheDir, { recursive: true });
const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(args.resolveDir ?? path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };
const outfile = path.join(cacheDir, "model-stream-wall-clock.cjs");
await build({
  stdin: {
    contents: [
      'export * from "./source/host/runner/model-stream-wall-clock.js";',
      'export { shouldRetryTurnAttempt } from "./source/host/runner/transient-stream-error.js";',
      'export { OutputTokensLimitExceededError } from "./source/packages/chat-inference/prompt-executor.js";',
    ].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  logLevel: "error",
  plugins: [jsToTs],
});
const {
  DEFAULT_MODEL_STREAM_WALL_CLOCK_LIMIT_MS,
  resolveModelStreamWallClockLimitMs,
  createModelStreamWallClockMiddleware,
  ModelStreamWallClockCutError,
  ModelStreamWallClockLimitError,
  isModelStreamWallClockLimitError,
  shouldRetryTurnAttempt,
  OutputTokensLimitExceededError,
} = createRequire(import.meta.url)(outfile);

function fakeCtx() {
  const children = [];
  return {
    children,
    withCancel() {
      const controller = new AbortController();
      const child = { signal: controller.signal };
      children.push(child);
      return [child, (reason) => controller.abort(reason)];
    },
  };
}

/** A provider that never finishes until its signal aborts, then rejects the
 * way the AI SDK does (a generic abort, not our limit error). */
function hangingExecutor() {
  const calls = [];
  return {
    calls,
    getMessages: () => [],
    getState: () => [],
    clearMessages() {},
    appendMessages() {},
    stream(ctx) {
      calls.push(ctx);
      const aborted = new Promise((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })), { once: true });
      });
      aborted.catch(() => {});
      return {
        fullStream: (async function* () {
          yield { type: "text-delta", textDelta: "partial" };
          await aborted;
        })(),
        response: aborted,
        usage: Promise.resolve({}),
      };
    },
  };
}

function quickExecutor() {
  return {
    getMessages: () => [],
    getState: () => [],
    clearMessages() {},
    appendMessages() {},
    stream() {
      return {
        fullStream: (async function* () { yield { type: "text-delta", textDelta: "done" }; })(),
        response: Promise.resolve({ id: "r1" }),
      };
    },
  };
}

async function drain(stream) {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

test("default is 15 minutes, env-overridable, and 0 disables", () => {
  assert.equal(DEFAULT_MODEL_STREAM_WALL_CLOCK_LIMIT_MS, 15 * 60_000);
  assert.equal(resolveModelStreamWallClockLimitMs({}), 15 * 60_000);
  assert.equal(resolveModelStreamWallClockLimitMs({ SAND_MODEL_STREAM_WALL_CLOCK_LIMIT_MS: "1234" }), 1234);
  assert.equal(resolveModelStreamWallClockLimitMs({ SAND_MODEL_STREAM_WALL_CLOCK_LIMIT_MS: "0" }), 0);
  assert.equal(resolveModelStreamWallClockLimitMs({ SAND_MODEL_STREAM_WALL_CLOCK_LIMIT_MS: "nope" }), 15 * 60_000);
  const inner = quickExecutor();
  assert.equal(createModelStreamWallClockMiddleware(0)(inner), inner, "0 must not wrap at all");
});

test("the first cut in a turn rides the output-token-limit path and aborts the provider", async () => {
  const apply = createModelStreamWallClockMiddleware(60);
  const inner = hangingExecutor();
  const ctx = fakeCtx();
  const result = apply(inner).stream(ctx, "inv-1", []);
  let caught;
  await assert.rejects(drain(result.fullStream), (error) => { caught = error; return true; });
  assert.ok(caught instanceof ModelStreamWallClockCutError);
  assert.ok(caught instanceof OutputTokensLimitExceededError, "must be caught by runWithMaxTokensRetry");
  assert.equal(isModelStreamWallClockLimitError(caught), false, "the first cut is retryable");
  assert.equal(inner.calls[0], ctx.children[0], "the provider must run on the cancellable child context");
  assert.equal(ctx.children[0].signal.aborted, true, "the provider stream must actually be stopped");
  await assert.rejects(result.response, ModelStreamWallClockCutError);
});

test("the second cut in the same turn is terminal and never retried", async () => {
  const apply = createModelStreamWallClockMiddleware(60);
  await assert.rejects(drain(apply(hangingExecutor()).stream(fakeCtx()).fullStream), ModelStreamWallClockCutError);
  let caught;
  await assert.rejects(drain(apply(hangingExecutor()).stream(fakeCtx()).fullStream), (error) => { caught = error; return true; });
  assert.ok(caught instanceof ModelStreamWallClockLimitError);
  assert.ok(!(caught instanceof OutputTokensLimitExceededError));
  assert.equal(isModelStreamWallClockLimitError(caught), true);
  assert.equal(isModelStreamWallClockLimitError(new Error("wrapped", { cause: caught })), true);
  assert.equal(
    shouldRetryTurnAttempt({ canceled: false, error: caught, streamOutputProduced: false, resumeCheckpointAvailable: false, automationIsRetryable: () => true }),
    false,
  );
  for (const word of ["abort", "cancel", "interrupt", "watchdog", "superseded"]) {
    assert.ok(!caught.message.toLowerCase().includes(word), `message must stay user-visible (no "${word}")`);
  }
});

test("each turn gets its own cut budget", async () => {
  const turnA = createModelStreamWallClockMiddleware(60);
  const turnB = createModelStreamWallClockMiddleware(60);
  await assert.rejects(drain(turnA(hangingExecutor()).stream(fakeCtx()).fullStream), ModelStreamWallClockCutError);
  await assert.rejects(drain(turnB(hangingExecutor()).stream(fakeCtx()).fullStream), ModelStreamWallClockCutError);
});

test("a stream that finishes in time passes through untouched and does not spend the budget", async () => {
  const apply = createModelStreamWallClockMiddleware(60);
  const ctx = fakeCtx();
  const result = apply(quickExecutor()).stream(ctx);
  assert.deepEqual(await drain(result.fullStream), [{ type: "text-delta", textDelta: "done" }]);
  assert.deepEqual(await result.response, { id: "r1" });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(ctx.children[0].signal.aborted, false, "a finished stream must be disarmed");
  await assert.rejects(drain(apply(hangingExecutor()).stream(fakeCtx()).fullStream), ModelStreamWallClockCutError);
});

test("a call without a cancellable context is passed straight through", () => {
  const apply = createModelStreamWallClockMiddleware(60);
  const sentinel = { fullStream: [], response: Promise.resolve() };
  const inner = { ...quickExecutor(), stream: (...args) => ({ sentinel, args }) };
  const out = apply(inner).stream("not-a-context", 1);
  assert.equal(out.sentinel, sentinel);
  assert.deepEqual(out.args, ["not-a-context", 1]);
});

test("every turn's provider executor is wrapped by the wall-clock middleware", () => {
  const shell = readFileSync(path.join(root, "source/host/runner/turn-run-shell.ts"), "utf8");
  assert.match(shell, /applyModelStreamWallClockLimit\(agent\.getExecutor\(\)\)/);
  assert.match(shell, /createModelStreamWallClockMiddleware\(\s*resolveModelStreamWallClockLimitMs\(\),?\s*\)/);
  const guard = readFileSync(path.join(root, "source/host/runner/transient-stream-error.ts"), "utf8");
  assert.match(guard, /if \(isModelStreamWallClockLimitError\(input\.error\)\) return false;/);
});
