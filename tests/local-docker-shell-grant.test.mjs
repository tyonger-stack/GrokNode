import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const outfile = path.join(root, "node_modules/.cache/local-docker-shell-grant.cjs");
await mkdir(path.dirname(outfile), { recursive: true });
await build({ stdin: { resolveDir: root, contents: [
  'export {AutoReviewService} from "./source/host/extensions/auto-review/auto-review-service.ts";',
  'export {SandSettingsStore} from "./source/shared/node/settings/sand-settings-store.ts";',
  'export {resolveTurnShellAutoReviewInputs,createTurnShellAutoReviewOptions} from "./source/host/runner/tools/turn-toolset.ts";',
].join("\n") }, outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "error" });
const api = createRequire(import.meta.url)(outfile);
const rule = "Always allow all Shell commands on this local Docker VM.";
const modes = { hostShell: "enforce", boxShell: "enforce", mcp: "enforce", computer: "off", automationWrite: "off", cloudAgent: "enforce", subagentLaunch: "enforce" };
function service(settings) {
  return new api.AutoReviewService({ auth: {}, settings, experiments: { checkFeatureGate: () => true },
    telemetry: { reportAutoReviewDisplayRecheckFailed() {}, reportAutoReviewApproval() {} },
    awaitingSink: { trySetForTab() {}, clearForTab() {} }, transcript: { settleStaleAutoReviewCard: async () => false },
    hostGeneration: "test", createClassifierExecutor: () => ({}) });
}

test("explicit Docker Shell grant changes only box Shell and survives store restart", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "grok-vm-shell-grant-"));
  try {
    const file = path.join(dir, "settings.json"), store = new api.SandSettingsStore(file);
    const first = service(store).bindRunner({ agentId: "one", onUpdate() {} });
    assert.deepEqual(first.getAutoReviewModes(), modes, "no implicit standing grant");
    store.setAutoReviewInstructions({ ...store.getAutoReviewInstructions(), allowInstructions: [rule] });
    assert.deepEqual(first.getAutoReviewModes(), { ...modes, boxShell: "off" });
    const reloaded = service(new api.SandSettingsStore(file)).bindRunner({ agentId: "other-bot", onUpdate() {} });
    assert.deepEqual(reloaded.getAutoReviewModes(), { ...modes, boxShell: "off" });
    const reviews = api.resolveTurnShellAutoReviewInputs({}, { hostDependencies: { autoReview: {
      requestContext: { env: { smartModeClassifierAutoModeEnabled: true } }, agentId: "other-bot",
      controller: reloaded.autoReviewController, getModes: reloaded.getAutoReviewModes,
      getInstructions: () => store.getAutoReviewInstructions(), getApprovalExpiryPolicy: () => "park",
    } } });
    assert.equal(reviews.box, undefined, "production tool projection omits box review");
    assert.equal(reviews.host.mode, "enforce", "host Mac remains reviewed");
    store.setAutoReviewInstructions({ ...store.getAutoReviewInstructions(), allowInstructions: [] });
    assert.deepEqual(first.getAutoReviewModes(), modes, "removing the rule revokes the grant immediately");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("similar text is not an all-shell grant and Ask-first rules retain precedence", () => {
  let instructions = { isEnabled: true, allowInstructions: ["Always allow shell commands"], blockInstructions: [] };
  const runner = service({ getAutoReviewInstructions: () => instructions }).bindRunner({ agentId: "one", onUpdate() {} });
  assert.deepEqual(runner.getAutoReviewModes(), modes);
  instructions = { ...instructions, allowInstructions: [rule], blockInstructions: ["Ask before deleting files"] };
  assert.deepEqual(runner.getAutoReviewModes(), modes);
});
