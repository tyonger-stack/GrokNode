import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const modules = [
  "host/runner/memory-context", "host/runner/system-prompt-assembly", "host/extensions/memory/memory-service",
  "host/extensions/memory/project-membership", "host/extensions/session/agent-db", "host/runner/tools/context-tools",
  "host/runner/transcript-read", "host/runner/transcript-blobs", "packages/context/core", "packages/agent-kv/blob-store",
  "packages/agent-kv/serde", "packages/agent/serde", "packages/proto/generated/agent/v1/agent_pb",
  "packages/agent/self-summary/self-summary", "host/runner/start-fresh-conversation",
  "host/gateway-protocol",
];
const bundled = await build({ stdin: { contents: modules.map((name) => `export * from "./source/${name}.ts";`).join("\n"), resolveDir: root },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const debounce = { name: "test", wrap: (fn) => Object.assign(fn, { dispose() {} }) };

function promptDependencies(memory, epoch) {
  return { ...memory, basePrompt: "base", isSubagentRunner: false, isSharedRoomRunner: false, isSystemPromptOverridden: false,
    agentProfileProvider: () => null, agentStore: () => null, compactionEpoch: () => epoch.value,
    isBoxScopedSubagent: () => false, requestContext: { resolve: () => ({ timeZone: "UTC" }) },
    automationStore: () => null, workflowStore: () => null, channelStore: () => null, connectorManifests: [],
    mcpManagement: () => null, mcpCustomInstructionsSection: () => null, mcpDiscoveryStatusSection: () => null,
    remoteBoxSection: () => "", computerSection: () => null, isSpotlightEnabled: () => false,
    agentDirectory: () => [{ id: "other", name: "Other", description: "" }] };
}

test("persisted memory reaches the prompt and refreshes only after compaction", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "context-memory-"));
  const agentDir = path.join(dir, "agents", "self");
  const db = new m.SandAgentDb(path.join(agentDir, "store.db"));
  try {
    const store = new m.FileMemoryStore(path.join(agentDir, "memory"), debounce);
    store.addMemory("FACT-ALPHA", 1, "profile");
    const shared = new m.FileMemoryStore(m.getUserMemoryShardDir(dir, "other"), debounce);
    shared.addMemory("FACT-SHARED", 2, "profile");
    const membership = new m.AgentProjectMembership(agentDir);
    membership.join("project-one");
    const project = new m.FileMemoryStore(m.getProjectMemoryShardDir(dir, "project-one", "other"), debounce);
    project.addMemory("FACT-PROJECT", 3, "log");
    const memory = m.createRunnerMemoryContext({ agentId: "self", dbPath: db.dbPath, sandRoot: dir, store, snapshots: db, resolveAgentName: (id) => id });
    const epoch = { value: 0 };
    const assembly = m.createSystemPromptAssembly(promptDependencies(memory, epoch));
    const first = assembly.getSystemPrompt();
    assert.ok(["FACT-ALPHA", "FACT-SHARED", "FACT-PROJECT", "session_id other"].every((fact) => first.includes(fact)));
    store.addMemory("FACT-BETA", 4, "profile");
    assert.equal(assembly.getSystemPrompt().includes("FACT-BETA"), false);
    epoch.value = 1;
    assert.equal(assembly.getSystemPrompt().includes("FACT-BETA"), true);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("RecallMemory searches shared history beyond the prompt and former 500 fact cap", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "context-recall-"));
  try {
    const store = new m.FileMemoryStore(m.getUserMemoryShardDir(dir, "other"), debounce);
    store.addMemory("ARCHIVED-TICKET-731", 1, "log");
    for (let index = 0; index < 501; index += 1) store.addMemory(`new fact ${index}`, 1000 + index, "log");
    const deps = m.buildContextToolDependencies({ selfId: "self", sandRoot: dir, ownMemory: {}, state: {}, related: () => [], loadTranscript: async () => null });
    const result = await invoke(m.createContextTools(deps), "RecallMemory", { query: "ARCHIVED-TICKET-731" });
    assert.equal(result.result.case, "success");
    assert.ok(result.result.value.currentStep.includes("ARCHIVED-TICKET-731"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function invoke(tools, name, args) {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `missing ${name}`);
  return tool.execute(m.createContext(), { executeToolCall: async (context, _initial, _id, run) => run(context) },
    (async function* () { yield JSON.stringify(args); })(), { toolCallId: "fixture" });
}

function transcriptFixture() {
  const calls = [];
  const entries = [
    { kind: "message", role: "user", content: "first" },
    { kind: "tool-call", name: "Shell", args: { command: "PRIVATE-INPUT" }, result: "PRIVATE-RESULT" },
    { kind: "thinking", text: "PRIVATE-REASONING" },
    { kind: "send-message", message: { type: "text", content: "ticket ORBIT-731 complete" } },
  ];
  const deps = { selfId: "self", state: {}, listFacts: () => [], related: () => [{ id: "other", name: "Other" }],
    loadTranscript: async (id) => { calls.push(id); return { label: id, entries }; },
    loadSubagentTranscript: async (id) => id === "owned-child" ? { label: id, entries } : null };
  return { tools: m.createContextTools(deps), calls };
}

test("search hit opens through around and virtual file at the matching line", async () => {
  const { tools, calls } = transcriptFixture();
  const result = await invoke(tools, "SearchTranscripts", { query: "ORBIT-731" });
  assert.deepEqual(calls, ["self"]);
  const text = result.result.value.currentStep;
  const position = Number(/position (\d+)/.exec(text)[1]);
  const offset = Number(/self\.jsonl:(\d+)/.exec(text)[1]);
  const around = await invoke(tools, "ReadTranscript", { around: position, limit: 1 });
  assert.ok(around.result.value.currentStep.includes("ORBIT-731"));
  const file = await invoke(tools, "ReadTranscriptFile", { path: "/transcripts/self.jsonl", offset, limit: 1 });
  assert.ok(file.result.value.currentStep.includes("ORBIT-731"));
});

test("own transcript preserves tool payloads while peer transcript keeps them private", async () => {
  const { tools } = transcriptFixture();
  const own = await invoke(tools, "ReadTranscript", {});
  const peer = await invoke(tools, "ReadTranscript", { session_id: "other" });
  for (const token of ["PRIVATE-INPUT", "PRIVATE-RESULT", "PRIVATE-REASONING"]) {
    assert.ok(own.result.value.currentStep.includes(token));
    assert.equal(peer.result.value.currentStep.includes(token), false);
  }
});

test("unlisted conversation and filesystem paths are rejected before loading", async () => {
  const { tools, calls } = transcriptFixture();
  const denied = await invoke(tools, "ReadTranscript", { session_id: "unlisted" });
  const traversal = await invoke(tools, "ReadTranscriptFile", { path: "/transcripts/../../settings.json" });
  assert.equal(denied.result.case, "error");
  assert.equal(traversal.result.case, "error");
  assert.deepEqual(calls, []);
});

test("subagent transcripts use the owner registry and do not fall back to another agent", async () => {
  const { tools, calls } = transcriptFixture();
  const own = await invoke(tools, "ReadTranscript", { subagent_id: "owned-child" });
  const denied = await invoke(tools, "ReadTranscript", { subagent_id: "other" });
  assert.equal(own.result.case, "success");
  assert.equal(denied.result.case, "error");
  assert.deepEqual(calls, []);
});

test("summary archives restore original message blobs with reasoning and tool results", async () => {
  const blobs = new m.InMemoryBlobStore();
  const ctx = m.createContext();
  const archived = new TextEncoder().encode(JSON.stringify({ role: "assistant", content: [{ type: "reasoning", text: "ARCHIVED-REASONING" }, { type: "tool-call", toolName: "Shell", args: { command: "ARCHIVED-INPUT" } }] }));
  const tail = new TextEncoder().encode(JSON.stringify({ role: "tool", content: [{ type: "tool-result", toolName: "Shell", result: "LIVE-RESULT" }] }));
  const archivedId = await m.getBlobId(archived), tailId = await m.getBlobId(tail);
  const archive = new m.ConversationSummaryArchive({ summarizedMessages: [archivedId] }).toBinary();
  const archiveId = await m.getBlobId(archive);
  for (const [id, bytes] of [[archivedId, archived], [tailId, tail], [archiveId, archive]]) await blobs.setBlob(ctx, id, bytes);
  const entries = await m.readArchivedPromptEntries({ state: { summaryArchives: [archiveId], rootPromptMessagesJson: [tailId] }, getBlob: (id) => blobs.getBlob(ctx, id) });
  const rendered = m.readTranscriptWindow(m.transcriptLinesFromEntries(entries, true), {}).lines.join("\n");
  for (const token of ["ARCHIVED-REASONING", "ARCHIVED-INPUT", "LIVE-RESULT"]) assert.ok(rendered.includes(token));
  assert.ok(rendered.indexOf("ARCHIVED-INPUT") < rendered.indexOf("LIVE-RESULT"));
});

test("low token history stays uncompressed even after 1000 turns", () => {
  const messages = Array.from({ length: 1001 }, () => ({ role: "user", content: "x" }));
  assert.equal(m.shouldPerformSelfSummary(messages, { usedTokens: 100, maxTokens: 10000 }, undefined, undefined), false);
  assert.equal(m.shouldPerformSelfSummary(messages, { usedTokens: 9000, maxTokens: 10000 }, undefined, undefined), true);
});

test("local StartFresh fails explicitly without clearing the caller's messages", () => {
  assert.throws(() => m.refuseLocalConversationReset(), m.LocalConversationResetUnavailableError);
});

test("StartFresh gateway command forwards its target and returns the local refusal", async () => {
  let target;
  await assert.rejects(async () => m.SAND_GATEWAY_COMMANDS.startFreshConversation({
    startFreshConversation: async (args) => { target = args; m.refuseLocalConversationReset(); },
  }, JSON.stringify({ id: "self", sessionId: "conversation-a" })), m.LocalConversationResetUnavailableError);
  assert.deepEqual(target, { id: "self", sessionId: "conversation-a" });
});

test("an oversized spoken record cannot stall virtual file pagination", async () => {
  const deps = { selfId: "self", state: {}, listFacts: () => [], related: () => [], loadTranscript: async () => ({ label: "self", entries: [
    { kind: "message", role: "user", content: "大".repeat(15000) },
    { kind: "message", role: "user", content: "NEXT-RECORD" },
  ] }) };
  const result = await invoke(m.createContextTools(deps), "ReadTranscriptFile", { path: "/transcripts/self.jsonl", limit: 1 });
  assert.equal(result.result.case, "success");
  assert.ok(result.result.value.currentStep.includes("Next offset: 2"));
});

test("a finished subagent remains readable through its parent's persisted state reference", async () => {
  const ctx = m.createContext();
  const blobs = new m.InMemoryBlobStore();
  const message = new TextEncoder().encode(JSON.stringify({ role: "user", content: "FINISHED-CHILD" }));
  const messageId = await m.getBlobId(message);
  await blobs.setBlob(ctx, messageId, message);
  const child = new m.SubagentPersistedState({ conversationState: new m.ConversationStateStructure({ rootPromptMessagesJson: [messageId] }) }).toBinary();
  const childId = await m.getBlobId(child);
  await blobs.setBlob(ctx, childId, child);
  const runner = { options: { ctx }, getBlobStore: () => blobs,
    getAgentConversationStateStructure: () => ({ subagentStateRefs: { "owned-child": childId } }) };
  const found = await m.readOwnedSubagentTranscript(runner, "owned-child");
  assert.equal(found.entries[0].content, "FINISHED-CHILD");
  assert.equal(await m.readOwnedSubagentTranscript(runner, "unrelated-child"), null);
});

test("UpdateMemory accepts the official type field and cannot forget a different type", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "context-update-"));
  try {
    const store = new m.FileMemoryStore(path.join(dir, "memory"), debounce);
    const state = {
      writeMemory: async ({ content, tier }) => { store.addMemory(content, 1, tier); return { ok: true, detail: "saved" }; },
      removeMemory: async ({ content }) => ({ ok: store.removeMemoryByContent(content), detail: "removed" }),
    };
    const deps = m.buildContextToolDependencies({ selfId: "self", ownMemory: store, state, related: () => [], loadTranscript: async () => null });
    const tools = m.createContextTools(deps);
    await invoke(tools, "UpdateMemory", { action: "write", type: "profile", fact: "PERSISTED-PROFILE" });
    await invoke(tools, "UpdateMemory", { action: "forget", type: "journal", fact: "PERSISTED-PROFILE" });
    assert.equal(store.listMemories().some((fact) => fact.content === "PERSISTED-PROFILE"), true);
    await invoke(tools, "UpdateMemory", { action: "forget", type: "profile", fact: "PERSISTED-PROFILE" });
    assert.equal(store.listMemories().length, 0);
    const alias = await invoke(tools, "UpdateMemory", { action: "write", memory_type: "journal", fact: "LEGACY-ALIAS" });
    assert.equal(alias.result.case, "success");
    assert.equal(store.listMemories()[0].kind, "log");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
