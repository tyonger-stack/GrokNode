import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "node_modules/.cache/local-always-allow.cjs");
await mkdir(path.dirname(output), { recursive: true });
await build({ stdin: { resolveDir: root, contents: [
  'export {createLocalSmartModeClassifierExecutor} from "./source/host/extensions/auto-review/local-smart-mode-classifier-exec.ts";',
  'export {AutoReviewService} from "./source/host/extensions/auto-review/auto-review-service.ts";',
  'export {SandSettingsStore} from "./source/shared/node/settings/sand-settings-store.ts";',
  'export {SmartModeClassifierArgs,SmartModeRiskTarget} from "./source/packages/proto/generated/agent/v1/smart_mode_classifier_exec_pb.ts";',
  'export {createAutoReviewApprovalActions} from "./frontend/src/recovered/features/conversation/cards/transcript-card/auto-review-actions.ts";',
  'export {createMainEdgeHandlers} from "./source/electron-main/main-edge.ts";',
  'export {Struct} from "@bufbuild/protobuf";',
].join("\n") }, outfile: output, platform: "node", format: "cjs", bundle: true, packages: "external", logLevel: "error" });
const api = createRequire(import.meta.url)(output);
const target = (overrides = {}) => new api.SmartModeClassifierArgs({ parentConversationId: "bot", target: new api.SmartModeRiskTarget({ action: "shell", arguments: api.Struct.fromJson({ command: "command -v node", working_directory: "/workspace", surface: "isolated_box", ...overrides }) }) });

test("Always allow persists a Docker VM Shell grant, survives restart, and preserves its card status", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "grok-always-"));
  const file = path.join(dir, "settings.json");
  const store = new api.SandSettingsStore(file);
  const classifier = api.createLocalSmartModeClassifierExecutor(() => store.getAutoReviewInstructions());
  const updates = [];
  const service = new api.AutoReviewService({ auth: {}, settings: store, experiments: { checkFeatureGate: () => true },
    telemetry: { reportAutoReviewDisplayRecheckFailed() {}, reportAutoReviewApproval() {} },
    awaitingSink: { trySetForTab() {}, clearForTab() {} }, transcript: { settleStaleAutoReviewCard: async () => false },
    hostGeneration: "test", createClassifierExecutor: () => classifier });
  try {
    const result = await classifier.execute({}, target());
    assert.equal(result.result.value.decision, 2);
    const exactRule = result.result.value.proposedAllowRule;
    assert.ok(exactRule, "Local review must propose a persistable scoped rule");
    const bound = service.bindRunner({ agentId: "bot", onUpdate: e => updates.push(e) });
    const pending = bound.autoReviewController.requestApproval({ surface: "box_shell", summary: "Check node", reason: "confirmation", command: "command -v node", fingerprint: "node", proposedRule: exactRule, expiryPolicy: "park" });
    const card = updates[0].message.approval;
    const actions = api.createAutoReviewApprovalActions({ entryId: "entry", requestId: card.requestId, agentId: "bot", status: "pending", surface: "box_shell", proposedRule: exactRule }, {
      instructions: { load: async () => {}, snapshots: { get: () => ({ status: "ready", value: store.getAutoReviewInstructions() }), subscribe: () => () => {} }, setInstructions: async v => store.setAutoReviewInstructions(v) },
      resolver: { resolveAutoReviewApproval: async args => { await service.resolveApproval(args); return "resolved"; } },
    });
    assert.deepEqual(await actions.resolve("always"), { status: "settled", resolution: "always" });
    assert.deepEqual(await pending, { approved: true });
    assert.equal(updates.at(-1).status, "always", "Reloaded transcript must still say Always allowed");
    const nextCommand = await classifier.execute({}, target({ command: "pwd", working_directory: "/workspace" }));
    assert.equal(nextCommand.result.value.decision, 1, "A different VM command must inherit the standing Shell grant");
    assert.equal(nextCommand.result.value.blockReason, undefined);
    const otherDirectory = await classifier.execute({}, target({ command: "ls /tmp", working_directory: "/tmp" }));
    assert.equal(otherDirectory.result.value.decision, 1, "The grant applies across VM working directories");
    assert.deepEqual(bound.getAutoReviewModes(), {
      hostShell: "enforce",
      boxShell: "off",
      mcp: "enforce",
      computer: "enforce",
      automationWrite: "off",
      cloudAgent: "enforce",
      subagentLaunch: "enforce",
    });
    const restoredStore = new api.SandSettingsStore(file);
    const restoredService = new api.AutoReviewService({ auth: {}, settings: restoredStore, experiments: { checkFeatureGate: () => true },
      telemetry: { reportAutoReviewDisplayRecheckFailed() {}, reportAutoReviewApproval() {} },
      awaitingSink: { trySetForTab() {}, clearForTab() {} }, transcript: { settleStaleAutoReviewCard: async () => false },
      hostGeneration: "restored", createClassifierExecutor: () => classifier });
    const restoredBound = restoredService.bindRunner({ agentId: "other-bot", onUpdate() {} });
    assert.equal(restoredBound.getAutoReviewModes().boxShell, "off", "Restart must retain the grant");
    const saved = store.getAutoReviewInstructions();
    store.setAutoReviewInstructions({ ...saved, blockInstructions: ["Ask before running node commands"] });
    assert.equal(bound.getAutoReviewModes().boxShell, "enforce", "Ask-first rules have priority");
    assert.equal((await classifier.execute({}, target({ command: "pwd" }))).result.value.decision, 2, "Ask-first rules retain classifier priority");
    store.setAutoReviewInstructions({ ...saved, allowInstructions: [] });
    assert.equal(bound.getAutoReviewModes().boxShell, "enforce", "Removing the rule revokes permission");
    restoredService.stop();
  } finally { service.stop(); await rm(dir, { recursive: true, force: true }); }
});

for (const failure of ["missing-rule", "save-failed"]) {
  test("Always allow never silently becomes allow-once when " + failure, async () => {
    let resolutions = 0;
    const action = api.createAutoReviewApprovalActions({ agentId: "bot", entryId: "e", requestId: "r", status: "pending", surface: "host_shell", ...(failure === "missing-rule" ? {} : { proposedRule: "Allow pwd" }) }, {
      instructions: { load: async () => {}, snapshots: { get: () => ({ status: "ready", value: { isEnabled: true, allowInstructions: [], blockInstructions: [] } }), subscribe: () => () => {} }, setInstructions: async () => { throw new Error("disk full"); } },
      resolver: { resolveAutoReviewApproval: async () => { resolutions++; return "resolved"; } },
    });
    assert.equal((await action.resolve("always")).status, "failed");
    assert.equal(resolutions, 0, "No approval when persistence fails");
    assert.deepEqual(await action.resolve("approved"), { status: "settled", resolution: "approved" }, "Allow once remains an explicit user choice");
  });
}


test("Always allow does not claim success until the VM confirms the saved rules", async () => {
  const original = { isEnabled: true, allowInstructions: [], blockInstructions: [] };
  const changed = { ...original, allowInstructions: ["Persisted rule"] };
  let stored = original;
  let mode = "offline";
  const handler = api.createMainEdgeHandlers({
    settingsStore: { getAutoReviewInstructions: () => stored, setAutoReviewInstructions: value => { stored = value; } },
    syncHostSettingsToBox: async value => {
      if (mode === "offline") throw new Error("VM unreachable");
      return mode === "stale" ? { autoReviewInstructions: original } : value;
    },
  }).setAutoReviewInstructions;
  await assert.rejects(() => handler({ instructions: changed }), /unreachable/);
  assert.deepEqual(stored, original);
  mode = "stale";
  await assert.rejects(() => handler({ instructions: changed }), /did not confirm/);
  assert.deepEqual(stored, original);
  mode = "connected";
  assert.deepEqual(await handler({ instructions: changed }), changed);
});
