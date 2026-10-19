import assert from "node:assert/strict";
import test from "node:test";
import { bundleServerPort } from "./server-port-bundle.mjs";

const m = await bundleServerPort(["host/runner/tools/sand-subagent-management-tools", "host/runner/delegated-work-stop",
  "host/extensions/transcript/agent-to-agent-messaging", "host/runner/subagent-runtime"]);
const info = id => ({ subagentId: id, subagentType: "executor", title: id, elapsedMs: 1, toolCallCount: 0, recentActivity: [] });

test("stop-all attempts every child and reports races and delegated failures separately", async () => {
  const attempts = [];
  const report = await m.stopAllRunningSubagents({ listRunningSubagents: () => [info("one"), info("done"), info("bad")],
    abortSubagent: async id => { attempts.push(id); if (id === "bad") throw new Error("cannot interrupt"); return id === "done" ? "not-running" : "ok"; },
    stopDelegatedWork: async () => { throw new Error("offline"); } });
  assert.deepEqual(attempts, ["one", "done", "bad"]);
  assert.deepEqual(report.stopped.map(row => row.subagentId), ["one"]);
  assert.deepEqual(report.alreadyFinished.map(row => row.subagentId), ["done"]);
  assert.deepEqual(report.failed.map(row => row.subagentId), ["bad"]);
  assert.equal(report.delegated[0].result, "failed");
  assert.throws(() => m.stopSubagentParameters.parse({ subagent_id: "one", all: true }));
  assert.throws(() => m.stopSubagentParameters.parse({}));
  assert.deepEqual(m.stopSubagentParameters.parse({ subagent_id: " ", all: true }), { subagent_id: "", all: true });
});

test("delegated cancellation never uses watched IDs as proof of cloud ownership", async () => {
  const cancelled = [];
  const stopper = m.createDelegatedWorkStopper({ selfId: "parent", stopPeers: async () => [], pendingCloudIds: () => ["ours", "unowned"],
    stopCloud: async id => { cancelled.push(id); return { result: "stopped" }; } });
  stopper.launched("ours");
  const result = await stopper.stop();
  assert.deepEqual(cancelled, ["ours"]);
  assert.deepEqual(result.map(row => [row.id, row.result]), [["ours", "stopped"], ["unowned", "unreachable"]]);
  assert.deepEqual(await stopper.stop({ visitedAgentIds: ["parent"] }), []);
});

test("peer stops withdraw only owned priority work and protect another user's active turn", async () => {
  let interrupted = 0;
  const tm = { runLifecycle: { runScheduler: { getActiveLane: () => "user" } },
    turnRuntime: { activeRequestSources: new Map([["target", "turn"]]) },
    runnerRegistry: { runners: new Map([["target", { interrupt: () => { interrupted++; } }]]) },
    backgroundWakes: { dmPreemptedWakeAgentIds: new Set() } };
  const messaging = new m.AgentToAgentMessaging(tm);
  const owned = { from: { id: "parent", name: "P" }, text: "owned", timestampMs: 1, priority: true };
  const unrelated = { from: { id: "other", name: "O" }, text: "other", timestampMs: 2, priority: true };
  const information = { ...owned, priority: false };
  messaging.pendingAgentInbound.set("target", [owned, unrelated, information]);
  messaging.activeBatches.set("target", [owned]);
  messaging.activeMessages.set("target", owned);
  const result = await messaging.stopDelegatedFromAgent("parent");
  assert.equal(interrupted, 0);
  assert.equal(result[0].result, "unreachable");
  assert.deepEqual(messaging.pendingAgentInbound.get("target"), [unrelated, information]);
});

test("a live owned peer turn is interrupted and its child stop is invoked", async () => {
  const calls = [];
  const tm = { runLifecycle: { runScheduler: { getActiveLane: () => "agent" } },
    turnRuntime: { activeRequestSources: new Map([["target", "agent"]]) },
    runnerRegistry: { runners: new Map([["target", { stopSubagents: () => calls.push("children"), interrupt: () => calls.push("peer") }]]) },
    backgroundWakes: { dmPreemptedWakeAgentIds: new Set(["target"]) } };
  const messaging = new m.AgentToAgentMessaging(tm);
  const owned = { from: { id: "parent", name: "P" }, text: "owned", timestampMs: 1, priority: true };
  messaging.activeBatches.set("target", [owned]); messaging.activeMessages.set("target", owned);
  const result = await messaging.stopDelegatedFromAgent("parent");
  assert.deepEqual(calls, ["children", "peer"]);
  assert.equal(result[0].result, "stopped");
  assert.equal(tm.backgroundWakes.dmPreemptedWakeAgentIds.size, 0);
});

test("withdrawing a queued handoff cannot cancel that Bot's unrelated descendants", async () => {
  const descendants = [];
  const stopper = m.createDelegatedWorkStopper({ selfId: "parent", stopPeers: async () => [
    { kind: "peer", id: "queued-only", name: "Q", result: "stopped" },
    { kind: "peer", id: "owned-active", name: "A", result: "stopped", stopDescendants: true },
  ], stopPeerDescendants: async id => { descendants.push(id); return []; }, stopCloud: async () => ({ result: "stopped" }) });
  await stopper.stop(); assert.deepEqual(descendants, ["owned-active"]);
});

test("runtime recursively interrupts a child and grandchild and keeps repeated stops idempotent", async () => {
  const calls = [], finishes = [];
  const runtime = id => m.createSubagentRuntime({ getConversationId: () => id, resolveBoxId: () => "box", emitAsyncTasksChanged() {}, computerUse: { freeWindow() {} } });
  const root = runtime("root"), child = runtime("child");
  for (const [owner, id, descendants] of [[root, "child", child], [child, "grandchild", null]]) {
    owner.sessions.set(id, { stopSubagents: () => descendants?.stopSubagents(), interrupt: () => calls.push(id), getResolvedOutline: async () => [], getObservedToolCallCount: () => 0, getActivitySnapshot: () => [], getTranscriptPath: () => null });
    owner.dispatchBackgroundSubagent({ subagentAgentId: id, subagentType: "task", toolCallId: id, prompt: "work", run: () => new Promise(resolve => finishes.push(resolve)) });
  }
  root.stopSubagents(); root.stopSubagents();
  assert.deepEqual(calls, ["grandchild", "child"]);
  for (const finish of finishes) finish({ text: "", aborted: true });
  await Promise.all([root.drainBackgroundSubagents(), child.drainBackgroundSubagents()]);
});

test("the real inbound wake records ownership, stops its active turn and cleans the ledger", async () => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const finish = new Promise(resolve => { release = resolve; });
  const calls = [], session = { id: "target" };
  const runner = { run: async () => { entered(); await finish; return { aborted: true }; }, stopSubagents: () => calls.push("children"), interrupt: () => { calls.push("peer"); release(); } };
  const tm = { execution: { canExecute: true }, sessions: { resolveBackgroundSession: async () => session, isAgentGone: () => false },
    groupChat: { isGroupSession: () => false, isRemoteRoomSession: () => false },
    runLifecycle: { beginSessionRun() {}, endSessionRun() {}, enqueueExclusiveRun: async (_, run) => run(), runScheduler: { getActiveLane: () => "agent" } },
    turnRuntime: { activeRequestSources: new Map(), activeRequestPrompts: new Map() }, runnerRegistry: { getRunner: () => runner, runners: new Map([["target", runner]]) },
    backgroundWakes: { dmPreemptedWakeAgentIds: new Set() }, telemetry: { reportAgentError: error => assert.fail(JSON.stringify(error)) }, trayErrors: { pushError() {} } };
  const messaging = new m.AgentToAgentMessaging(tm); messaging.appendAgentInboundEntries = () => {};
  const wake = messaging.runAgentInboundWake("target", [{ from: { id: "parent", name: "P" }, text: "work", priority: true, timestampMs: 1 }]);
  await started; assert.equal((await messaging.stopDelegatedFromAgent("parent"))[0].result, "stopped"); await wake;
  assert.deepEqual(calls, ["children", "peer"]); assert.equal(messaging.activeBatches.size, 0); assert.equal(messaging.activeMessages.size, 0);
});
