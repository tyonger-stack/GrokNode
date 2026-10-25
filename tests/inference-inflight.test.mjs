import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(repoRoot, "node_modules/.cache"), { recursive: true });
const temporary = await mkdtemp(path.join(repoRoot, "node_modules/.cache/inference-inflight-"));
test.after(() => rm(temporary, { recursive: true, force: true }));

const output = path.join(temporary, "inference-inflight.mjs");
await build({
  entryPoints: [path.join(repoRoot, "source/host/extensions/inference/inference-inflight.ts")],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node26",
  logLevel: "silent",
});
const {
  acquireInferenceSlot,
  getInferenceInflightSnapshot,
  isAgentHoldingInferenceSlot,
  isAgentWaitingForInferenceSlot,
  resetInferenceInflightForTests,
  resolveMaxInferenceInflight,
  runWithInferenceSlot,
  takePreheldInferenceSlot,
  DEFAULT_MAX_INFERENCE_INFLIGHT,
} = await import(pathToFileURL(output).href);

test.beforeEach(() => {
  delete process.env.SAND_MAX_INFERENCE_INFLIGHT;
  resetInferenceInflightForTests();
});

test("resolveMaxInferenceInflight defaults to 4 and rejects junk", () => {
  assert.equal(resolveMaxInferenceInflight({}), DEFAULT_MAX_INFERENCE_INFLIGHT);
  assert.equal(resolveMaxInferenceInflight({ SAND_MAX_INFERENCE_INFLIGHT: "3" }), 3);
  assert.equal(resolveMaxInferenceInflight({ SAND_MAX_INFERENCE_INFLIGHT: "0" }), DEFAULT_MAX_INFERENCE_INFLIGHT);
  assert.equal(resolveMaxInferenceInflight({ SAND_MAX_INFERENCE_INFLIGHT: "-1" }), DEFAULT_MAX_INFERENCE_INFLIGHT);
  assert.equal(resolveMaxInferenceInflight({ SAND_MAX_INFERENCE_INFLIGHT: "nope" }), DEFAULT_MAX_INFERENCE_INFLIGHT);
});

test("the gate admits up to the limit and queues the rest", async () => {
  process.env.SAND_MAX_INFERENCE_INFLIGHT = "2";
  const first = await acquireInferenceSlot();
  const second = await acquireInferenceSlot();
  assert.deepEqual(getInferenceInflightSnapshot(), { active: 2, waiting: 0, limit: 2 });

  let thirdReleased = false;
  const thirdPromise = acquireInferenceSlot().then((release) => {
    thirdReleased = true;
    return release;
  });
  await Promise.resolve();
  assert.equal(getInferenceInflightSnapshot().waiting, 1);
  assert.equal(thirdReleased, false);

  first();
  const third = await thirdPromise;
  assert.equal(thirdReleased, true);
  assert.deepEqual(getInferenceInflightSnapshot(), { active: 2, waiting: 0, limit: 2 });

  second();
  third();
  assert.deepEqual(getInferenceInflightSnapshot(), { active: 0, waiting: 0, limit: 2 });
});

test("release is idempotent", async () => {
  process.env.SAND_MAX_INFERENCE_INFLIGHT = "1";
  const release = await acquireInferenceSlot();
  release();
  release();
  assert.deepEqual(getInferenceInflightSnapshot(), { active: 0, waiting: 0, limit: 1 });
});

test("an aborted wait never takes a slot", async () => {
  process.env.SAND_MAX_INFERENCE_INFLIGHT = "1";
  const held = await acquireInferenceSlot();
  const controller = new AbortController();
  const waiting = acquireInferenceSlot(controller.signal);
  await Promise.resolve();
  assert.equal(getInferenceInflightSnapshot().waiting, 1);
  controller.abort();
  await assert.rejects(waiting, /aborted/i);
  assert.deepEqual(getInferenceInflightSnapshot(), { active: 1, waiting: 0, limit: 1 });
  held();
});

test("queued agents are visible while waiting for the gate", async () => {
  process.env.SAND_MAX_INFERENCE_INFLIGHT = "1";
  const held = await acquireInferenceSlot();
  const agentId = "agent-waiting-for-slot";
  assert.equal(isAgentWaitingForInferenceSlot(agentId), false);
  let released = false;
  const waiting = acquireInferenceSlot({ agentId }).then((release) => {
    released = true;
    return release;
  });
  await Promise.resolve();
  assert.equal(isAgentWaitingForInferenceSlot(agentId), true);
  assert.equal(released, false);
  held();
  const release = await waiting;
  assert.equal(released, true);
  assert.equal(isAgentWaitingForInferenceSlot(agentId), false);
  assert.equal(isAgentHoldingInferenceSlot(agentId), true);
  release();
  assert.equal(isAgentHoldingInferenceSlot(agentId), false);
});

test("holding a slot (first-token / dial) is visible to callers", async () => {
  process.env.SAND_MAX_INFERENCE_INFLIGHT = "1";
  const agentId = "agent-holding-slot";
  const release = await acquireInferenceSlot({ agentId });
  assert.equal(isAgentWaitingForInferenceSlot(agentId), false);
  assert.equal(isAgentHoldingInferenceSlot(agentId), true);
  release();
  assert.equal(isAgentHoldingInferenceSlot(agentId), false);
});

test("a pre-aborted signal is refused without queueing", async () => {
  process.env.SAND_MAX_INFERENCE_INFLIGHT = "1";
  await acquireInferenceSlot();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(acquireInferenceSlot(controller.signal), /aborted/i);
  assert.equal(getInferenceInflightSnapshot().waiting, 0);
});

test("runWithInferenceSlot pre-holds for takePreheld and releases if unused", async () => {
  process.env.SAND_MAX_INFERENCE_INFLIGHT = "1";
  let sawActive = false;
  await runWithInferenceSlot({}, async () => {
    assert.deepEqual(getInferenceInflightSnapshot(), { active: 1, waiting: 0, limit: 1 });
    sawActive = true;
    // leave preheld in ALS — finally must release
  });
  assert.equal(sawActive, true);
  assert.deepEqual(getInferenceInflightSnapshot(), { active: 0, waiting: 0, limit: 1 });

  let stolenRelease;
  await runWithInferenceSlot({}, async () => {
    stolenRelease = takePreheldInferenceSlot();
    assert.equal(typeof stolenRelease, "function");
    assert.equal(takePreheldInferenceSlot(), undefined);
    assert.deepEqual(getInferenceInflightSnapshot(), { active: 1, waiting: 0, limit: 1 });
  });
  // stolen: finally must not double-release
  assert.deepEqual(getInferenceInflightSnapshot(), { active: 1, waiting: 0, limit: 1 });
  stolenRelease();
  assert.deepEqual(getInferenceInflightSnapshot(), { active: 0, waiting: 0, limit: 1 });
});

test("runWithInferenceSlot queues behind the cap before fn runs", async () => {
  process.env.SAND_MAX_INFERENCE_INFLIGHT = "1";
  const held = await acquireInferenceSlot();
  const agentId = "prehold-waiter";
  let fnEntered = false;
  const pending = runWithInferenceSlot({ agentId }, async () => {
    fnEntered = true;
    assert.equal(isAgentWaitingForInferenceSlot(agentId), false);
    const release = takePreheldInferenceSlot();
    release?.();
  });
  await Promise.resolve();
  assert.equal(fnEntered, false);
  assert.equal(isAgentWaitingForInferenceSlot(agentId), true);
  held();
  await pending;
  assert.equal(fnEntered, true);
  assert.deepEqual(getInferenceInflightSnapshot(), { active: 0, waiting: 0, limit: 1 });
});

test("openRouterExecutor prefers takePreheld then falls back to acquire before streamText", () => {
  const source = readFileSync(
    path.join(repoRoot, "source/host/extensions/inference/provider-session.ts"),
    "utf8",
  );
  assert.match(source, /takePreheldInferenceSlot/);
  assert.match(source, /acquireInferenceSlot/);
  const gateAt = source.indexOf("takePreheldInferenceSlot() ?? await acquireInferenceSlot({");
  const streamAt = source.indexOf("streamText({", gateAt);
  assert.ok(gateAt > 0 && streamAt > gateAt);
  assert.match(source, /agentId/);
  assert.match(source, /result\.response\.finally\(detachSlot\)/);
  assert.doesNotMatch(
    source,
    /const result = streamText\(\{[\s\S]{0,200}acquireInferenceSlot/,
  );
});

test("production adapter wraps openrouter attempts with runWithInferenceSlot", () => {
  const source = readFileSync(
    path.join(repoRoot, "source/host/runner/production-turn-run-shell-adapter.ts"),
    "utf8",
  );
  assert.match(source, /withInferenceCapacity/);
  assert.match(source, /runWithInferenceSlot/);
  assert.match(source, /provider !== "openrouter"/);
});
