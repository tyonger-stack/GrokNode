import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "node_modules/.cache/mcp-approval-flow.cjs");
await mkdir(path.dirname(output), { recursive: true });
await build({ stdin: { resolveDir: root, contents: [
  'export {createCallMcpTool} from "./source/packages/agent/tools/mcp/mcp.ts";',
  'export {createContext} from "./source/packages/context/core.ts";',
  'export {AutoReviewService} from "./source/host/extensions/auto-review/auto-review-service.ts";',
  'export {createLocalSmartModeClassifierExecutor} from "./source/host/extensions/auto-review/local-smart-mode-classifier-exec.ts";',
  'export {createSandMcpApprovalProvider} from "./source/host/runner/sand-auto-review-tool-escalations.ts";',
  'export {mcpExecutorResource} from "./source/packages/agent-exec/mcp.ts";',
  'export {McpResult, McpSuccess} from "./source/packages/proto/generated/agent/v1/mcp_exec_pb.ts";',
].join("\n") }, outfile: output, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "error" });
const api = createRequire(import.meta.url)(output);

const AGENT_ID = "mcp-approval-test";

function fixture(allowInstructions) {
  const updates = [];
  const executed = [];
  const instructions = () => ({ isEnabled: true, allowInstructions, blockInstructions: [] });
  const service = new api.AutoReviewService({
    auth: {}, experiments: { checkFeatureGate: () => true },
    settings: { getAutoReviewInstructions: instructions },
    telemetry: { reportAutoReviewDisplayRecheckFailed() {}, reportAutoReviewApproval() {} },
    awaitingSink: { trySetForTab() {}, clearForTab() {} }, transcript: { settleStaleAutoReviewCard: async () => false },
    hostGeneration: "test", createClassifierExecutor: () => api.createLocalSmartModeClassifierExecutor(instructions),
  });
  const binding = service.bindRunner({ agentId: AGENT_ID, onUpdate: value => updates.push(value) });
  const resourceAccessor = { get: resource => resource === api.mcpExecutorResource
    ? { async execute(_ctx, args) { executed.push(args); return new api.McpResult({ result: { case: "success", value: new api.McpSuccess({ isError: false }) } }); } }
    : binding.autoReviewClassifierExecutor };
  // Mirror host-runner-composition's wiring: it derives serverDisplayName from the
  // preflight target before handing it to the escalation provider.
  const escalationProvider = api.createSandMcpApprovalProvider({ controller: binding.autoReviewController, agentId: AGENT_ID, getExpiryPolicy: () => "park" });
  const tool = api.createCallMcpTool({
    resourceAccessor,
    smartModeClassifierMode: true,
    smartModeApprovalProvider: {
      requestApproval: request => escalationProvider.requestApproval({
        fingerprint: request.fingerprint,
        signal: request.signal,
        target: {
          blockReason: request.target.blockReason,
          serverDisplayName: request.target.serverDisplayName ?? request.target.serverName ?? request.target.serverIdentifier,
          toolName: request.target.toolName,
          ...(request.target.mcpArguments === undefined ? {} : { mcpArguments: request.target.mcpArguments }),
          ...(request.target.description === undefined ? {} : { description: request.target.description }),
          ...(request.target.proposedAllowRule === undefined ? {} : { proposedAllowRule: request.target.proposedAllowRule }),
        },
      }),
    },
  });
  const ctx = api.createContext();
  const interaction = { getAbortSignal: () => ctx.signal, emitPartialToolCall() {}, executeToolCall: (ctx, _call, _id, run) => run(ctx) };
  const run = (toolName, mcpArguments) => tool.execute(ctx, interaction, (async function* () { yield JSON.stringify({ server: "google-calendar", toolName, arguments: mcpArguments }); })(), { toolCallId: "mcp-flow-test" });
  return { service, updates, executed, run };
}

const pendingCard = (updates) => updates.find(value => value.type === "send-message")?.message.approval;
async function waitForCard(updates, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const card = pendingCard(updates);
    if (card !== undefined) return card;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return undefined;
}
const digestOf = (rule) => /\[local-mcp:v1:([a-f0-9]{64})\]/.exec(rule)[1];
let savedMcpRule = null;

test("connected-service approval card carries a reusable always-allow rule", { timeout: 5000 }, async () => {
  const f = fixture([]);
  try {
    const operation = f.run("list_events", { pageSize: 20 }).then(value => ({ value }), error => ({ error }));
    const card = await waitForCard(f.updates);
    assert.ok(card, "the blocked MCP call must produce a pending approval card");
    assert.equal(card.status, "pending");
    assert.equal(card.surface, "mcp");
    assert.match(card.command, /^Use google-calendar tool list_events with /);
    assert.match(card.proposedRule, /^Always allow connected service tool \[local-mcp:v1:[a-f0-9]{64}\]: Use google-calendar tool list_events$/);
    savedMcpRule = card.proposedRule;
    assert.equal(f.executed.length, 0, "no tool execution before user confirmation");
    await f.service.resolveApproval({ requestId: card.requestId, resolution: "approved", agentId: AGENT_ID, entryId: "card" });
    const result = await operation;
    assert.equal(result.value?.result.case, "success");
    assert.equal(f.executed.length, 1);
  } finally { f.service.stop(); }
});

test("a saved connected-service grant executes without an approval card", { timeout: 5000 }, async () => {
  assert.ok(savedMcpRule, "previous test must capture the proposed rule");
  const f = fixture([savedMcpRule]);
  try {
    const result = await f.run("list_events", { pageSize: 5, orderBy: "startTime" });
    assert.equal(result.result.case, "success");
    assert.equal(f.executed.length, 1);
    assert.equal(pendingCard(f.updates), undefined, "a saved grant must not open a card");
  } finally { f.service.stop(); }
});

test("the grant is scoped: another tool on the same server still asks", { timeout: 5000 }, async () => {
  const f = fixture([savedMcpRule]);
  try {
    const operation = f.run("create_event", { summary: "x" }).then(value => ({ value }), error => ({ error }));
    const card = await waitForCard(f.updates);
    assert.ok(card, "a different tool must ask again");
    assert.notEqual(digestOf(card.proposedRule), digestOf(savedMcpRule));
    await f.service.resolveApproval({ requestId: card.requestId, resolution: "denied", agentId: AGENT_ID, entryId: "card" });
    const result = await operation;
    assert.match(result.error?.message ?? "", /Local Auto-review|rejected/);
    assert.equal(f.executed.length, 0);
  } finally { f.service.stop(); }
});

test("a shell digest with the same hex never satisfies a connected-service call", { timeout: 5000 }, async () => {
  const forged = "Always allow exact local command [local-shell:v1:" + digestOf(savedMcpRule) + "] on your computer: x";
  const f = fixture([forged]);
  try {
    const operation = f.run("list_events", {}).then(value => ({ value }), error => ({ error }));
    const card = await waitForCard(f.updates);
    assert.ok(card, "cross-kind digests must not allow the call");
    await f.service.resolveApproval({ requestId: card.requestId, resolution: "approved", agentId: AGENT_ID, entryId: "card" });
    const result = await operation;
    assert.equal(result.value?.result.case, "success");
    assert.equal(f.executed.length, 1);
  } finally { f.service.stop(); }
});
