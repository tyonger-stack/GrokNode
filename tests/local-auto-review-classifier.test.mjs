import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("local auto-review classifier produces a local confirmation decision without Cursor", async () => {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "local-auto-review-classifier.mjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({ entryPoints: [path.join(repoRoot, "source/host/extensions/auto-review/local-smart-mode-classifier-exec.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error", plugins: [{ name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(repoRoot + "/source") && existsSync(candidate) ? { path: candidate } : null; }); } }] });
  const module = await import(pathToFileURL(outfile).href + "?" + Date.now());
  const result = await module.createLocalSmartModeClassifierExecutor().execute({}, {});
  assert.equal(result.result.case, "success");
  assert.equal(result.result.value.decision, 2);
  assert.match(result.result.value.blockReason, /Local Auto-review/);
});

test("background Shell exposes the retry parameters required by local Auto-review", async () => {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "background-shell-approval.cjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({ entryPoints: [path.join(repoRoot, "source/packages/agent/tools/core/shell/create-shell-tool.ts")], bundle: true, platform: "node", format: "cjs", packages: "external", outfile, logLevel: "error" });
  const module = createRequire(import.meta.url)(outfile);
  const tool = module.createShellTool({ get: () => ({}) }, { agentType: "background", smartModeClassifierMode: true, smartModeApprovalProvider: { requestApproval: async () => ({ approved: true }) } });
  const properties = tool.parameters.jsonSchema.properties;
  assert.ok(properties.request_smart_mode_approval);
  assert.ok(properties.smart_mode_block_reason);
});

const rulesBundle = path.join(repoRoot, "node_modules", ".cache", "local-mcp-auto-review-rules.mjs");
mkdirSync(path.dirname(rulesBundle), { recursive: true });
await build({ stdin: { resolveDir: repoRoot, contents: [
  'export {createLocalSmartModeClassifierExecutor} from "./source/host/extensions/auto-review/local-smart-mode-classifier-exec.ts";',
  'export {localMcpAllowRule, matchesLocalAutoReviewRule} from "./source/host/extensions/auto-review/local-auto-review-rules.ts";',
  'export {SmartModeClassifierArgs, SmartModeClassifierDecision, SmartModeRiskTarget} from "./source/packages/proto/generated/agent/v1/smart_mode_classifier_exec_pb.ts";',
  'export {Struct} from "@bufbuild/protobuf";',
].join("\n") }, bundle: true, platform: "node", format: "esm", outfile: rulesBundle, logLevel: "error", plugins: [{ name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(repoRoot + "/source") && existsSync(candidate) ? { path: candidate } : null; }); } }] });
const rulesApi = await import(pathToFileURL(rulesBundle).href + "?" + Date.now());

function mcpClassifierArgs(rules, server, tool, mcpArguments) {
  return new rules.SmartModeClassifierArgs({
    toolCallId: "mcp-rule-test",
    parentConversationId: "conv-rules",
    target: new rules.SmartModeRiskTarget({
      action: "mcp",
      arguments: rules.Struct.fromJson({ server, tool_name: tool, ...(mcpArguments === undefined ? {} : { arguments: mcpArguments }) }),
    }),
  });
}

const GOOGLE_SERVER = { identifier: "google-calendar", name: "Google Calendar" };
const keyOfRule = (text) => /\[local-mcp:v1:([a-f0-9]{64})\]/.exec(text)[1];
const rulesExecutor = (rules, allowInstructions) =>
  rules.createLocalSmartModeClassifierExecutor(() => ({ isEnabled: true, allowInstructions, blockInstructions: [] }));

test("connected-service blocks propose a local-mcp standing grant keyed by server and tool", async () => {
  const blocked = await rulesExecutor(rulesApi, []).execute({}, mcpClassifierArgs(rulesApi, GOOGLE_SERVER, "list_events", { pageSize: 20 }));
  assert.equal(blocked.result.case, "success");
  assert.equal(blocked.result.value.decision, rulesApi.SmartModeClassifierDecision.BLOCK);
  assert.match(blocked.result.value.blockReason, /Local Auto-review/);
  const rule = blocked.result.value.proposedAllowRule;
  assert.match(rule, /^Always allow connected service tool \[local-mcp:v1:[a-f0-9]{64}\]: Use Google Calendar tool list_events$/);
  // Call arguments never enter the binding: the same server+tool grants across payloads.
  const rerun = await rulesExecutor(rulesApi, []).execute({}, mcpClassifierArgs(rulesApi, GOOGLE_SERVER, "list_events", { pageSize: 99, orderBy: "startTime" }));
  assert.equal(keyOfRule(rerun.result.value.proposedAllowRule), keyOfRule(rule));
  const otherTool = await rulesExecutor(rulesApi, []).execute({}, mcpClassifierArgs(rulesApi, GOOGLE_SERVER, "create_event", {}));
  assert.notEqual(keyOfRule(otherTool.result.value.proposedAllowRule), keyOfRule(rule));
  const otherServer = await rulesExecutor(rulesApi, []).execute({}, mcpClassifierArgs(rulesApi, { identifier: "github", name: "GitHub" }, "list_events", {}));
  assert.notEqual(keyOfRule(otherServer.result.value.proposedAllowRule), keyOfRule(rule));
});

test("a saved local-mcp grant allows the tool and shell digests never satisfy it", async () => {
  const blocked = await rulesExecutor(rulesApi, []).execute({}, mcpClassifierArgs(rulesApi, GOOGLE_SERVER, "list_events", {}));
  const rule = blocked.result.value.proposedAllowRule;
  const allowed = await rulesExecutor(rulesApi, [rule]).execute({}, mcpClassifierArgs(rulesApi, GOOGLE_SERVER, "list_events", { pageSize: 7 }));
  assert.equal(allowed.result.value.decision, rulesApi.SmartModeClassifierDecision.ALLOW);
  assert.equal(allowed.result.value.blockReason, undefined);
  const forgedShellDigest = "Always allow exact local command [local-shell:v1:" + keyOfRule(rule) + "] on your computer: x";
  assert.equal(rulesApi.matchesLocalAutoReviewRule(rule, forgedShellDigest), false);
  const stillBlocked = await rulesExecutor(rulesApi, [forgedShellDigest]).execute({}, mcpClassifierArgs(rulesApi, GOOGLE_SERVER, "list_events", {}));
  assert.equal(stillBlocked.result.value.decision, rulesApi.SmartModeClassifierDecision.BLOCK);
  assert.equal(stillBlocked.result.value.proposedAllowRule, rule);
});

test("degenerate connected-service targets block without a proposal", async () => {
  for (const target of [mcpClassifierArgs(rulesApi, GOOGLE_SERVER, "", {}), mcpClassifierArgs(rulesApi, { identifier: "", name: "" }, "list_events", {})]) {
    const result = await rulesExecutor(rulesApi, []).execute({}, target);
    assert.equal(result.result.value.decision, rulesApi.SmartModeClassifierDecision.BLOCK);
    assert.equal(result.result.value.proposedAllowRule, undefined);
  }
});
