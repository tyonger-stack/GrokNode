import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundleServerPort } from "./server-port-bundle.mjs";
const m = await bundleServerPort(["host/local-resume-coordinator", "host/extensions/turn-execution/local-recovery-gate",
  "host/extensions/transcript/sand-upgrade-resume-store", "host/extensions/transcript/upgrade-recreate-resume", "host/extensions/transcript/pending-wake-rearm"]);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("recovery claims old work before releasing queued user work and automation wakes", async t => {
  const gate = new m.LocalRecoveryGate(false), events = [], retry = deferred();
  t.after(() => gate.dispose());
  const pendingUser = gate.wait().then(() => events.push("user"));
  let ready = false;
  const coordinator = new m.LocalResumeCoordinator({ setAllowed: allowed => gate.setAllowed(allowed), runDuringRecovery: run => gate.runRecovery(run),
    isReady: async () => ready, suspendWakes: async () => { events.push("suspend"); },
    resumeTurns: async () => { await gate.wait(); events.push("old-accepted"); }, unacceptedAgentIds: () => [],
    rearmWakes: async () => { events.push("rearm"); return true; }, afterRelease: async () => { events.push("automations"); }, report() {},
    sleep: async (_, signal) => { await Promise.race([retry.promise, new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }))]); } });
  t.after(() => coordinator.dispose());
  assert.equal(await coordinator.request(), false);
  assert.deepEqual(events, ["suspend"]);
  ready = true; retry.resolve(); await pendingUser; await tick();
  assert.ok(events.indexOf("old-accepted") < events.indexOf("rearm"));
  assert.ok(events.indexOf("rearm") < events.indexOf("user"));
  assert.ok(events.indexOf("rearm") < events.indexOf("automations"));
});

test("superseded recovery cannot open the gate, and shutdown rejects waiting work", async () => {
  const gate = new m.LocalRecoveryGate(false), hold = deferred(), events = [];
  let calls = 0;
  const coordinator = new m.LocalResumeCoordinator({ setAllowed: value => { gate.setAllowed(value); events.push(value); }, runDuringRecovery: run => gate.runRecovery(run),
    isReady: async () => true, suspendWakes: async () => {}, resumeTurns: async () => { if (++calls === 1) await hold.promise; },
    unacceptedAgentIds: () => [], rearmWakes: async () => true, afterRelease: async () => {}, report() {} });
  const first = coordinator.request(); await tick(); const second = coordinator.request(); hold.resolve();
  assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(events.filter(Boolean).length, 1);
  coordinator.dispose(); const waiting = gate.wait(); gate.dispose(); await assert.rejects(waiting, m.LocalRecoveryDisposedError);
});

test("durable resume markers survive unavailable sessions and remain until accepted work finishes", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "recovery-store-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new m.SandUpgradeResumeStore(dir), finish = deferred();
  const marker = { agentId: "a", markedAtMs: 1, source: "turn" }; store.markPending(marker);
  let available = false, runs = 0, ended = 0;
  const session = { id: "a", automations: new Map() };
  const tm = { upgradeResumeStore: store, execution: { canExecute: true }, sessions: { isAgentGone: () => false,
    resolveBackgroundSession: async () => { if (!available) throw new Error("not loaded"); return session; } },
    groupChat: { isGroupSession: () => false }, runnerRegistry: { getRunner: () => ({ run: async () => { runs++; await finish.promise; } }) },
    runLifecycle: { beginSessionRun() {}, endSessionRun() { ended++; }, enqueueExclusiveRun: async (_, run) => run(), lastRequestIdBySession: new Map() },
    ackObligations: { mintAckRunToken: () => "ack", retireAckRunToken() {} }, turnRuntime: { activeRequestSources: new Map() },
    roster: { emitAgentUpdate: async () => {} }, automationRuntime: { emitAutomations() {} }, telemetry: { reportAgentError() {} }, trayErrors: { pushError() {} } };
  const resume = new m.UpgradeRecreateResume(tm);
  await resume.resumeInterruptedUpgradeTurns(); assert.equal(store.listPending().length, 1); assert.deepEqual(resume.listUnacceptedResumeAgentIds(), ["a"]);
  available = true; await tick(); await resume.resumeInterruptedUpgradeTurns();
  assert.equal(runs, 1); assert.equal(store.listPending().length, 1); assert.deepEqual(resume.listUnacceptedResumeAgentIds(), []);
  await resume.resumeInterruptedUpgradeTurns(); assert.equal(runs, 1);
  const newer = { ...marker, markedAtMs: 2 }; store.markPending(newer);
  finish.resolve(); await tick(); assert.equal(ended, 1); assert.deepEqual(store.listPending(), [newer]);
  store.clearIfUnchanged(newer); assert.deepEqual(store.listPending(), []);
});

test("wake rearm waits for ownership and preserves a failed durable wake for retry", async () => {
  const marker = { agentId: "a", kind: "cloud-agent", workId: "w", markedAtMs: Date.now() };
  const held = deferred(), reports = [], cleared = [];
  const tm = { execution: { canExecute: true }, pendingWakeStore: { pruneStale: () => [], listPending: () => [marker], clearOne: (...args) => cleared.push(args), markPending() {} },
    sessions: { isAgentGone: () => false, resolveBackgroundSession: async () => { await held.promise; throw new Error("offline"); } },
    telemetry: { reportPendingWake: event => reports.push(event) } };
  const rearm = new m.PendingWakeRearm(tm); let settled = false;
  const result = rearm.rearmPendingWakes().then(value => { settled = true; return value; }); await tick(); assert.equal(settled, false);
  held.resolve(); assert.equal(await result, false); assert.equal(cleared.length, 0); assert.equal(reports[0].outcome, "rearm_failed");
});

test("an accepted recovery task cannot retain a bypass lease through a later recovery", async () => {
  const gate = new m.LocalRecoveryGate(false), continueTask = deferred();
  let descendant;
  await gate.runRecovery(async () => {
    await gate.wait();
    descendant = (async () => { await continueTask.promise; await gate.wait(); })();
  });
  let finished = false; descendant.then(() => { finished = true; });
  continueTask.resolve(); await tick(); assert.equal(finished, false);
  gate.setAllowed(true); await descendant; assert.equal(finished, true); gate.dispose();
});
