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

const attemptOut = path.join(cacheDir, "stream-attempt.cjs");
await build({ entryPoints: [path.join(root, "source/host/runner/stream-attempt.ts")], bundle: true, platform: "node", format: "cjs", outfile: attemptOut, logLevel: "error", plugins: [jsToTs] });
const { createStreamAttempt } = createRequire(import.meta.url)(attemptOut);

const transientOut = path.join(cacheDir, "transient-stream-error.cjs");
await build({ entryPoints: [path.join(root, "source/host/runner/transient-stream-error.ts")], bundle: true, platform: "node", format: "cjs", outfile: transientOut, logLevel: "error", plugins: [jsToTs] });
const { shouldRetryTurnAttempt } = createRequire(import.meta.url)(transientOut);

const CONNECTION_RESET = new Error("ECONNRESET: connection reset by peer");
const INSTANT_POLICY = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, random: () => 0.5, sleep: async () => {} };

// Builds a StreamAttemptHost against an in-memory context and records every
// engine interaction so tests can assert the retry boundary's contract.
function makeHost(overrides = {}, ctxState = { canceled: false }) {
  const calls = {
    startStream: 0,
    lastResume: undefined,
    reportTurnRetry: [],
    emitRetrying: 0,
    deadlines: [],
  };
  const host = {
    ctx: {
      get canceled() {
        return ctxState.canceled;
      },
      withCancel: () => [
        {
          get canceled() {
            return ctxState.canceled;
          },
        },
        // Attempt-scoped cancel: deliberately does NOT flip the run-level
        // flag, mirroring a real Context tree where an engine-side attempt
        // abort must not read as a user cancellation.
        () => {},
      ],
    },
    hidden: false,
    setStreamOutputProduced: (value) => {
      host.output = value;
    },
    getStreamOutputProduced: () => host.output === true,
    persistCheckpoint: async (_ctx, checkpoint, accepted) => {
      accepted(checkpoint);
    },
    startStream: async (_ctx, resume, _persist) => {
      calls.startStream += 1;
      calls.lastResume = resume;
      if (overrides.startStream != null) {
        return await overrides.startStream({
          attempt: calls.startStream,
          resume,
          setOutput: () => {
            host.output = true;
          },
          persistCheckpoint: _persist,
        });
      }
      return "final-state";
    },
    createDeadlineTimer: (callback, deadlineMs) => {
      calls.deadlines.push(deadlineMs);
      return overrides.deadlineTimer != null
        ? overrides.deadlineTimer(callback, deadlineMs)
        : { cancel() {}, restart() {} };
    },
    setDeadlineHooks: () => {},
    clearDeadlineHookIf: () => {},
    setTraceAttributes: () => {},
    emitRetrying: () => {
      calls.emitRetrying += 1;
    },
    reportTurnRetry: (info) => {
      calls.reportTurnRetry.push(info);
    },
  };
  return { host, calls };
}

const runAttempt = async (host) => {
  const attempt = createStreamAttempt(host);
  return await attempt.run();
};

test("success on the first attempt performs no retry bookkeeping", async () => {
  const { host, calls } = makeHost();
  const state = await runAttempt(host);
  assert.equal(state, "final-state");
  assert.equal(calls.startStream, 1);
  assert.deepEqual(calls.reportTurnRetry, []);
  assert.equal(calls.emitRetrying, 0);
});

test("a transient failure is retried and reported as retried", async () => {
  const { host, calls } = makeHost({
    startStream: async ({ attempt }) => {
      if (attempt === 1) throw CONNECTION_RESET;
      return "final-state";
    },
  });
  const state = await runAttempt({ ...host, transientStreamRetry: INSTANT_POLICY });
  assert.equal(state, "final-state");
  assert.equal(calls.startStream, 2);
  assert.equal(calls.emitRetrying, 1);
  assert.equal(calls.reportTurnRetry.length, 1);
  assert.equal(calls.reportTurnRetry[0].outcome, "retried");
  assert.equal(calls.reportTurnRetry[0].attempt, 1);
});

test("exhausted transient failures reject after the last attempt", async () => {
  const { host, calls } = makeHost({
    startStream: async () => {
      throw CONNECTION_RESET;
    },
  });
  await assert.rejects(
    runAttempt({ ...host, transientStreamRetry: { ...INSTANT_POLICY, maxAttempts: 2 } }),
    /ECONNRESET/,
  );
  assert.equal(calls.startStream, 2);
  const exhausted = calls.reportTurnRetry.find((info) => info.outcome === "exhausted");
  assert.equal(exhausted?.attempt, 2);
});

test("a turn that already streamed without a checkpoint is not retried", async () => {
  const { host, calls } = makeHost({
    startStream: async ({ attempt, setOutput }) => {
      if (attempt === 1) {
        setOutput();
        throw CONNECTION_RESET;
      }
      return "final-state";
    },
  });
  await assert.rejects(runAttempt(host), /ECONNRESET/);
  assert.equal(calls.startStream, 1);
  assert.equal(calls.reportTurnRetry[0]?.outcome, "gave_up_ineligible");
});

test("an accepted checkpoint makes a streamed turn retryable from that checkpoint", async () => {
  const checkpoint = { marker: "step-1" };
  const { host, calls } = makeHost({
    startStream: async ({ attempt, setOutput, persistCheckpoint }) => {
      if (attempt === 1) {
        setOutput();
        await persistCheckpoint({ canceled: false }, checkpoint);
        throw CONNECTION_RESET;
      }
      return "final-state";
    },
  });
  const state = await runAttempt({ ...host, transientStreamRetry: INSTANT_POLICY });
  assert.equal(state, "final-state");
  assert.equal(calls.startStream, 2);
  assert.equal(calls.lastResume, checkpoint);
});

test("a canceled turn is never retried", async () => {
  const { host, calls } = makeHost(
    {
      startStream: async () => {
        throw CONNECTION_RESET;
      },
    },
    { canceled: true },
  );
  await assert.rejects(runAttempt(host), /ECONNRESET/);
  assert.equal(calls.startStream, 1);
});

test("first-token stall fires the exponential deadline and is retried", async () => {
  const { host, calls } = makeHost({
    startStream: () => new Promise(() => {}),
    deadlineTimer: (callback) => {
      callback();
      return { cancel() {}, restart() {} };
    },
  });
  await assert.rejects(
    runAttempt({ ...host, transientStreamRetry: { ...INSTANT_POLICY, maxAttempts: 2 } }),
    (error) => error?.name === "FirstTokenStallError" || error?.isFirstTokenStall === true,
  );
  assert.deepEqual(calls.deadlines, [150_000, 300_000]);
  assert.equal(calls.startStream, 2);
});

test("shouldRetryTurnAttempt gates on cancellation, output, checkpoint, and overflow", () => {
  const base = { canceled: false, streamOutputProduced: false, resumeCheckpointAvailable: false };
  assert.equal(shouldRetryTurnAttempt({ ...base, error: CONNECTION_RESET }), true);
  assert.equal(shouldRetryTurnAttempt({ ...base, canceled: true, error: CONNECTION_RESET }), false);
  assert.equal(
    shouldRetryTurnAttempt({ ...base, streamOutputProduced: true, error: CONNECTION_RESET }),
    false,
  );
  assert.equal(
    shouldRetryTurnAttempt({
      ...base,
      streamOutputProduced: true,
      resumeCheckpointAvailable: true,
      error: CONNECTION_RESET,
    }),
    true,
  );
  const overflow = Object.assign(new Error("too large"), { name: "InputTokenLimitError" });
  assert.equal(shouldRetryTurnAttempt({ ...base, error: overflow }), false);
});
