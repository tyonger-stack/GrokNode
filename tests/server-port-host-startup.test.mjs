import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bundleServerPort } from "./server-port-bundle.mjs";
const previousDeps = process.env.SAND_TREE_SITTER_NODE_DEPS;
process.env.SAND_TREE_SITTER_NODE_DEPS = fileURLToPath(new URL("../node_modules", import.meta.url));
const m = await bundleServerPort(["host/sand-host", "host/extensions/turn-execution/turn-execution-service"]);
if (previousDeps === undefined) delete process.env.SAND_TREE_SITTER_NODE_DEPS;
else process.env.SAND_TREE_SITTER_NODE_DEPS = previousDeps;
const tick = () => new Promise(resolve => setImmediate(resolve));

test("production SandHost startup and recreate gateway release work only after recovery ownership", async t => {
  const execution = new m.TurnExecutionRegistry(false), events = [];
  let release, backgroundReady;
  const hold = new Promise(resolve => { release = resolve; });
  let first = true;
  const apis = {
    "turn-execution": execution,
    inference: { isReady: async () => true },
    telemetry: { createHostLifecycleProgress: () => ({ complete() {}, fail: () => assert.fail("startup failed") }), logs: {} },
    attachments: { stageIntoBox() {}, scheduleRestage() {}, forgetAgent() {}, setFallbackAgentId() {} },
    "forever-box": { setBusy() {}, prewarm() {} },
    settings: { getHostSettings: () => ({}) },
    library: new Proxy({}, { get: () => () => [] }),
    automations: { suspendWakes: async () => { events.push("suspend"); }, resumeWakes: () => events.push("automations"), reconcileNow: async () => events.push("reconcile") },
    "cross-user-sharing": { resumeAfterRecreate: async () => events.push("sharing") },
    transcript: { ensureLoaded: async () => [], getActiveAgentId: () => null, liveRunningAgentIds: () => [],
      resumeInterruptedUpgradeTurns: async () => { await execution.waitForLocalWork(); events.push("resume"); if (first) { first = false; await hold; } },
      listUnacceptedResumeAgentIds: () => [], rearmPendingWakes: async () => { events.push("rearm"); return true; },
      redriveUnfulfilledAckObligations: async () => events.push("ack"),
      resumeAfterRecreate: async ids => { await execution.waitForLocalWork(); events.push(`carried:${ids.join(",")}`); return { resumed: ids.length }; },
      dispose: async () => events.push("disposed") },
  };
  const extensions = { order: Object.keys(apis), api: id => apis[id] ?? {}, stop: async () => {} };
  const host = new m.SandHost({ log: { log() {}, error: value => assert.fail(String(value)) },
    startExtensions: async context => { backgroundReady = context.whenBackgroundWorkReady; return extensions; },
    createRunnerComposition: () => ({ createRunner() {}, createGroupMemberRunner() {}, canAskLocalToolPermission: () => false, forgetLocalToolPermission() {}, dispose: async () => {} }),
    createGatewayDependencies: options => ({ ...options, handleDesktopMcpAuthCompletion: async () => {} }),
    registerConnectorConnectCard() {} });
  t.after(() => host.dispose());
  let userStarted = false;
  const user = execution.waitForLocalWork().then(() => { userStarted = true; events.push("user"); });
  await host.start(); await tick();
  assert.equal(execution.isLocalWorkAllowed, false); assert.equal(userStarted, false); assert.equal(events.includes("automations"), false);
  release(); await user; await backgroundReady; await tick();
  assert.ok(events.indexOf("resume") < events.indexOf("rearm"));
  assert.ok(events.indexOf("rearm") < events.indexOf("automations"));
  events.length = 0;
  const result = await host.getApi().resumeBoxAfterRecreate({ agentIds: ["a"], pendingWakes: [] });
  assert.equal(result.resumed, 1); assert.equal(execution.isLocalWorkAllowed, true);
  assert.ok(events.indexOf("sharing") < events.indexOf("carried:a"));
  assert.ok(events.indexOf("carried:a") < events.indexOf("rearm"));
  assert.ok(events.indexOf("rearm") < events.indexOf("automations"));
});
