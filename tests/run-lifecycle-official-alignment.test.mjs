import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

const lifecycleSourcePath = path.join(root, "source/host/extensions/transcript/run-lifecycle.ts");
const lifecycleOut = path.join(cacheDir, "run-lifecycle-official-alignment.cjs");
await build({
  entryPoints: [lifecycleSourcePath],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: lifecycleOut,
  logLevel: "error",
  plugins: [jsToTs],
});
const lifecycleBundle = createRequire(import.meta.url)(lifecycleOut);

// The official host (image-baked bundle sha256 68b8ce61…, git-sha 2e44baf)
// has no run-level deadline: enqueueExclusiveRun there is a bare queue chain,
// and provider silence is bounded at the stream level only. These guards keep
// the reconstruction aligned with that shape. See the comment block at the top
// of run-lifecycle.ts for the 2026-10-25 group-turn false-kill that motivated
// the removal.
test("the compiled lifecycle bundle no longer ships a run-level deadline", async () => {
  for (const removedExport of [
    "withRunHardDeadline",
    "RunProgressTracker",
    "RUN_IDLE_DEADLINE_DEFAULT_MS",
    "RUN_HARD_DEADLINE_DEFAULT_MS",
    "RUN_HARD_DEADLINE_AWAITING_MAX_MS",
  ]) {
    assert.equal(lifecycleBundle[removedExport], undefined, `${removedExport} must not be exported`);
  }
  const bundleText = readFileSync(lifecycleOut, "utf8");
  for (const removedLiteral of [
    "run stalled: no model output",
    "SAND_RUN_IDLE_DEADLINE_MS",
    "SAND_RUN_HARD_DEADLINE_MS",
  ]) {
    assert.ok(!bundleText.includes(removedLiteral), `bundle must not contain "${removedLiteral}"`);
  }
  const sourceText = readFileSync(lifecycleSourcePath, "utf8");
  assert.ok(!sourceText.includes("progressTracker"), "no orphan progress-tracker plumbing may remain");
  assert.ok(!sourceText.includes("isAgentBusyOnInferenceSlot"), "the run-idle slot hook must stay removed");
});

// The queue watchdog and the failure-notice wrapper are the surviving
// official-anchored behaviors; exercise them through the chain path.
process.env.SAND_DISABLE_RUN_SCHEDULER = "1";

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a silent run is not failed: no run-level deadline, matching the official host", async () => {
  const agentId = "11111111-1111-4111-8111-111111111111";
  const tm = makeFakeTm(agentId);
  const lifecycle = new lifecycleBundle.RunLifecycle(tm);
  const run = lifecycle.enqueueExclusiveRun(agentId, () => new Promise(() => {}), {
    lane: "user",
    source: "turn",
  });
  let failed = false;
  run.catch(() => { failed = true; });
  await sleep(1200);
  assert.equal(failed, false, "a silent run must not be failed while it never settles");
  assert.equal(tm.appended.length, 0, "no failure notice without a real task failure");
  assert.deepEqual(tm.interrupts, [], "nothing may abort the run on a timer");
});

test("a task that really fails still surfaces a turn-failure notice", async () => {
  const agentId = "22222222-2222-4222-8222-222222222222";
  const tm = makeFakeTm(agentId);
  const lifecycle = new lifecycleBundle.RunLifecycle(tm);
  await assert.rejects(
    lifecycle.enqueueExclusiveRun(agentId, async () => { throw new Error("boom-marker"); }, {
      lane: "user",
      source: "turn",
    }),
    /boom-marker/,
  );
  const notice = tm.appended.find((entry) => entry.text?.includes("ended without a reply"));
  assert.ok(notice, `expected a turn-failure notice, got: ${JSON.stringify(tm.appended.map((e) => e.text ?? e.content))}`);
  assert.match(notice.text, /boom-marker/);
});

test("bookkeeping rerun failures stay silent outside the notice whitelist", async () => {
  const agentId = "33333333-3333-4333-8333-333333333333";
  const tm = makeFakeTm(agentId);
  const lifecycle = new lifecycleBundle.RunLifecycle(tm);
  await assert.rejects(
    lifecycle.enqueueExclusiveRun(agentId, async () => { throw new Error("silent-marker"); }, {
      lane: "background",
      source: "ack-redrive",
    }),
    /silent-marker/,
  );
  assert.equal(tm.appended.length, 0, "bookkeeping failures must stay silent");
});

test("runs still serialize per agent on the chain path", async () => {
  const agentId = "44444444-4444-4444-8444-444444444444";
  const tm = makeFakeTm(agentId);
  const lifecycle = new lifecycleBundle.RunLifecycle(tm);
  let finishT1;
  const t1 = lifecycle.enqueueExclusiveRun(
    agentId,
    () => new Promise((resolve) => { finishT1 = resolve; }),
    { lane: "user", source: "turn" },
  );
  let t2Started = false;
  const t2 = lifecycle.enqueueExclusiveRun(
    agentId,
    async () => { t2Started = true; },
    { lane: "user", source: "turn" },
  );
  await sleep(50);
  assert.equal(t2Started, false, "the second run must wait for the first");
  finishT1();
  await t1;
  await t2;
  assert.equal(t2Started, true, "the queue moves on once the first run settles");
});
