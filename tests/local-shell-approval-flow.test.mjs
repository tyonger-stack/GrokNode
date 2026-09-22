import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "node_modules/.cache/shell-approval-flow.cjs");
await mkdir(path.dirname(output), { recursive: true });
await build({ stdin: { resolveDir: root, contents: [
  'export {createShellTool} from "./source/packages/agent/tools/core/shell/create-shell-tool.ts";',
  'export {createContext} from "./source/packages/context/core.ts";',
  'export {AutoReviewService} from "./source/host/extensions/auto-review/auto-review-service.ts";',
  'export {createLocalSmartModeClassifierExecutor} from "./source/host/extensions/auto-review/local-smart-mode-classifier-exec.ts";',
  'export {createSandShellApprovalProvider} from "./source/host/runner/sand-auto-review-tool-escalations.ts";',
  'export {shellStreamExecutorResource} from "./source/packages/agent-exec/shell-stream.ts";',
].join("\n") }, outfile: output, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "error" });
const api = createRequire(import.meta.url)(output);

function fixture(surface) {
  const updates = [];
  const executed = [];
  const service = new api.AutoReviewService({
    auth: {}, experiments: { checkFeatureGate: () => true },
    settings: { getAutoReviewInstructions: () => ({ isEnabled: true, allowInstructions: [], blockInstructions: [] }) },
    telemetry: { reportAutoReviewDisplayRecheckFailed() {}, reportAutoReviewApproval() {} },
    awaitingSink: { trySetForTab() {}, clearForTab() {} }, transcript: { settleStaleAutoReviewCard: async () => false },
    hostGeneration: "test", createClassifierExecutor: () => api.createLocalSmartModeClassifierExecutor(),
  });
  const binding = service.bindRunner({ agentId: "approval-test", onUpdate: value => updates.push(value) });
  const executor = { async *execute(_ctx, args) {
    executed.push(args.command);
    const stdout = execFileSync("/bin/pwd", { encoding: "utf8" });
    yield { event: { case: "stdout", value: { data: stdout } } };
    yield { event: { case: "exit", value: { code: 0, aborted: false, localExecutionTimeMs: 1 } } };
  } };
  const tool = api.createShellTool({ get: key => key === api.shellStreamExecutorResource ? executor : binding.autoReviewClassifierExecutor }, {
    surface, smartModeClassifierMode: true, requestContext: { env: { smartModeClassifierAutoModeEnabled: true } },
    loadSmartModeWorkspacePermissionFiles: false,
    smartModeApprovalProvider: api.createSandShellApprovalProvider({ controller: binding.autoReviewController, agentId: "approval-test", surface: surface === "host_machine" ? "host_shell" : "box_shell", getExpiryPolicy: () => "park" }),
  });
  const ctx = api.createContext();
  const interaction = { getAbortSignal: () => ctx.signal, emitPartialToolCall() {}, executeToolCall: (ctx, _call, _id, run) => run(ctx) };
  const run = args => tool.execute(ctx, interaction, (async function* () { yield JSON.stringify({ command: "pwd", ...args }); })(), { toolCallId: "pwd-test", workspacePaths: [] });
  return { service, updates, executed, run, tool };
}

for (const surface of ["host_machine", "isolated_box"]) {
  for (const resolution of ["approved", "denied"]) {
    test(surface + " string approval request shows a card and waits for " + resolution, { timeout: 5000 }, async () => {
      const f = fixture(surface);
      try {
        assert.equal(f.tool.parameters.jsonSchema.properties.request_smart_mode_approval.type, "boolean");
        await assert.rejects(() => f.run({}), /Local Auto-review requires/);
        const operation = f.run({ request_smart_mode_approval: "true", smart_mode_block_reason: "Local Auto-review requires your confirmation." }).then(value => ({ value }), error => ({ error }));
        await new Promise(resolve => setImmediate(resolve));
        const card = f.updates.find(value => value.type === "send-message")?.message.approval;
        assert.ok(card, "The string true request must produce a pending approval card");
        assert.equal(card.command, "pwd"); assert.equal(card.status, "pending");
        assert.equal(f.executed.length, 0, "No process before user confirmation");
        await f.service.resolveApproval({ requestId: card.requestId, resolution, agentId: "approval-test", entryId: "card" });
        const result = await operation;
        if (resolution === "approved") {
          assert.equal(result.value?.result.case, "success");
          assert.equal(result.value.result.value.stdout.trim(), process.cwd());
          assert.deepEqual(f.executed, ["pwd"]);
        } else { assert.match(result.error?.message ?? "", /blocked/); assert.equal(f.executed.length, 0); }
      } finally { f.service.stop(); }
    });
  }
}

test("false and invalid approval values never grant approval or execute shell", async () => {
  const f = fixture("isolated_box");
  try {
    for (const value of [false, "false"]) await assert.rejects(() => f.run({ request_smart_mode_approval: value }), /Local Auto-review requires/);
    for (const value of ["yes", 1, {}, null]) await assert.rejects(() => f.run({ request_smart_mode_approval: value }), /Invalid arguments/);
    assert.equal(f.executed.length, 0); assert.equal(f.updates.length, 0);
  } finally { f.service.stop(); }
});
