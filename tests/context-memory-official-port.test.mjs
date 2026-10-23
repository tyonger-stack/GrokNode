import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const modules = ["host/runner/transcript-trace", "host/runner/transcript-blobs", "host/runner/sessions/transcript-reader",
  "host/runner/sessions/related-conversations-prompt", "host/runner/sessions/related-conversations-section", "host/extensions/session/agent-db",
  "host/runner/tools/context-tools", "packages/context/core", "packages/redaction/core-message", "packages/redaction/classification",
  "packages/agent-kv/blob-store", "packages/proto/generated/agent/v1/agent_pb"];
const bundled = await build({ stdin: { contents: modules.map((name) => `export * from "./source/${name}.ts";`).join("\n"), resolveDir: root },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("formal trace maps reasoning and tool input/result without copying image bytes", () => {
  const line = JSON.parse(m.formatSandTranscriptTraceLine({ role: "assistant", content: [
    { type: "reasoning", text: "  calculation  " },
    { type: "tool-call", toolName: "Shell", toolCallId: "c1", args: { command: "pwd" } },
    { type: "tool-result", toolName: "Shell", toolCallId: "c1", result: { exitCode: 0 } },
    { type: "image", image: "PRIVATE-IMAGE-BYTES" },
  ] }));
  assert.deepEqual(line, { role: "assistant", message: { content: [
    { type: "thinking", thinking: "calculation" }, { type: "tool_use", id: "c1", name: "Shell", input: { command: "pwd" } },
    { type: "tool_result", tool_use_id: "c1", name: "Shell", result: { exitCode: 0 } }, { type: "text", text: "[Image]" },
  ] } });
});

test("trace omits system messages, summary carriers and injected context blocks", () => {
  assert.equal(m.formatSandTranscriptTraceLine({ role: "system", content: "SYSTEM" }), undefined);
  assert.equal(m.formatSandTranscriptTraceLine({ role: "user", content: "SUMMARY", providerOptions: { cursor: { isSummary: true } } }), undefined);
  const line = JSON.parse(m.formatSandTranscriptTraceLine({ role: "user", content: "<user_info>PRIVATE</user_info><instructions_update>NOTE</instructions_update>USER-TEXT" }));
  assert.deepEqual(line.message.content, [{ type: "text", text: "USER-TEXT" }]);
});

test("own blob transcript pages hydrate only the requested tail and keep archive positions", async () => {
  const ctx = m.createContext();
  const store = new m.InMemoryBlobStore();
  const ids = [];
  for (let index = 0; index < 80; index += 1) {
    const bytes = new TextEncoder().encode(JSON.stringify({ role: "user", content: `MESSAGE-${index}` }));
    const id = await m.getBlobId(bytes); ids.push(id); await store.setBlob(ctx, id, bytes);
  }
  const archiveBytes = new m.ConversationSummaryArchive({ summarizedMessages: ids.slice(0, 40) }).toBinary();
  const archiveId = await m.getBlobId(archiveBytes); await store.setBlob(ctx, archiveId, archiveBytes);
  let reads = 0;
  const source = m.createPromptTranscriptSource({ label: "self", state: () => ({ summaryArchives: [archiveId], rootPromptMessagesJson: ids.slice(40) }),
    getBlob: (id) => { reads += 1; return store.getBlob(ctx, id); } });
  const page = await source.read({ limit: 3 });
  assert.equal(reads, 4);
  assert.deepEqual({ first: page.first, end: page.end, total: page.total, before: page.olderBefore }, { first: 77, end: 80, total: 80, before: 77 });
  assert.deepEqual(page.lines.map((line) => JSON.parse(line).message.content[0].text), ["MESSAGE-77", "MESSAGE-78", "MESSAGE-79"]);
  const old = await source.read({ limit: 2, before: 2 });
  assert.deepEqual(old.lines.map((line) => JSON.parse(line).message.content[0].text), ["MESSAGE-0", "MESSAGE-1"]);
});

test("legacy conversation turns without prompt references retain the entry reader fallback", () => {
  assert.equal(m.hasPromptTranscriptState({ turns: [new Uint8Array([1])] }), false);
  assert.equal(m.hasPromptTranscriptState({ summaryArchives: [new Uint8Array([2])], rootPromptMessagesJson: [] }), true);
});

test("local access separates participating group sessions from other owned agents", async () => {
  const access = m.createLocalConversationAccess("bot-a", () => [
    { id: "bot-a", name: "A" }, { id: "bot-b", name: "B" },
    { id: "room-a", name: "Room A", isGroup: true, memberIds: ["bot-a", "bot-b"] },
    { id: "room-b", name: "Room B", isGroup: true, memberIds: ["bot-b"] },
  ]);
  assert.deepEqual(access.agents().map((row) => row.id), ["bot-b"]);
  assert.deepEqual(access.related().map((row) => row.id), ["room-a"]);
  const reads = [];
  const reader = m.createEntryTranscriptReader({ selfId: "bot-a", ...access, loadTranscript: async (id) => {
    reads.push(id); return { label: id, entries: [{ kind: "message", role: "user", content: "VISIBLE" }, { kind: "thinking", text: "PRIVATE" }] };
  } });
  assert.equal((await reader.openTranscript(undefined, { kind: "session", sessionId: "bot-b" })).kind, "refused");
  const peer = await reader.openTranscript(undefined, { kind: "agent", agentId: "bot-b" });
  assert.equal(peer.kind, "messages-only");
  assert.equal((await peer.read({})).lines.some((line) => line.includes("PRIVATE")), false);
  assert.deepEqual(reads, ["bot-b"]);
});

test("formal virtual paths round trip independent target kinds and reject malformed encodings", () => {
  for (const target of [{ kind: "self" }, { kind: "session", sessionId: "slack:one/two" }, { kind: "agent", agentId: "a" }, { kind: "subagent", subagentId: "c" }]) {
    assert.deepEqual(m.transcriptTargetOfPath(m.transcriptPath(target)), target);
  }
  assert.equal(m.transcriptTargetOfPath("/transcripts/sessions/%ZZ"), undefined);
  assert.equal(m.transcriptTargetOfPath("/transcripts/sessions/a/extra"), undefined);
});

test("related conversation prefix caps at eight and new links are announced once until compaction", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "formal-sections-"));
  const db = new m.SandAgentDb(path.join(dir, "store.db"));
  try {
    let links = [{ sessionId: "room-a", label: "A" }];
    let epoch = 0;
    const section = m.createRelatedConversationsSection({ related: () => links, compactionEpoch: () => epoch, snapshots: () => db });
    const first = section.render();
    links = [...links, { sessionId: "room-b", label: "B" }];
    assert.equal(section.render(), first);
    const before = [{ role: "user", content: "question" }];
    const after = section.appendUpdates(before);
    assert.equal(after.length, 2);
    assert.equal(typeof after[1].content, "string");
    assert.ok(after[1].content.includes("<instructions_update>"));
    assert.ok(after[1].content.includes("session_id room-b"));
    assert.equal(after[1].providerOptions.cursor.isInjectedReminder, true);
    const redacted = m.toRedactedCoreMessages(after, 3);
    assert.equal(redacted[1]._privacyMode, 3);
    assert.throws(() => m.toRedactedCoreMessages([redacted[1]], 3), /map is not a function/);
    assert.equal(section.appendUpdates(after).length, 2);
    epoch = 1;
    assert.ok(section.render().includes("session_id room-b"));
    const capped = m.renderRelatedConversationsPrompt(Array.from({ length: 12 }, (_, index) => ({ sessionId: String(index), label: String(index) })));
    assert.equal(capped.split("\n").filter((line) => line.startsWith("- ")).length, 8);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("clearing conversation state invalidates persisted and in-memory section snapshots", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "formal-clear-"));
  const db = new m.SandAgentDb(path.join(dir, "store.db"));
  try {
    let links = [{ sessionId: "before", label: "Before" }];
    const section = m.createRelatedConversationsSection({ related: () => links, compactionEpoch: () => 0, snapshots: () => db });
    section.render();
    assert.equal(db.clearConversation(), true);
    assert.equal(db.getPromptSectionSnapshot("related_conversations"), null);
    links = [{ sessionId: "after", label: "After" }];
    const next = section.render();
    assert.ok(next.includes("session_id after"));
    assert.equal(next.includes("session_id before"), false);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

async function recall(deps, scope) {
  const tool = m.createContextTools(deps).find((item) => item.name === "RecallMemory");
  return tool.execute(m.createContext(), { executeToolCall: async (ctx, _initial, _id, run) => run(ctx) },
    (async function* () { yield JSON.stringify({ query: "MATCH", scope }); })(), { toolCallId: "scope" });
}

test("RecallMemory scope filters the candidates before ranking and counts only visible facts", async () => {
  const deps = { selfId: "self", state: {}, related: () => [], loadTranscript: async () => null,
    listFacts: () => [{ content: "MATCH-OWN", createdAt: 1, memoryType: "profile" }, { content: "MATCH-SHARED", createdAt: 2, memoryType: "shared_profile" }] };
  const own = (await recall(deps, "agent")).result.value.currentStep;
  const shared = (await recall(deps, "user")).result.value.currentStep;
  assert.ok(own.includes("MATCH-OWN")); assert.equal(own.includes("MATCH-SHARED"), false);
  assert.ok(shared.includes("MATCH-SHARED")); assert.equal(shared.includes("MATCH-OWN"), false);
});

test("blank optional transcript targets behave like omitted targets as in the formal tool contract", async () => {
  const calls = [];
  const deps = { selfId: "self", state: {}, listFacts: () => [], related: () => [], loadTranscript: async (id) => {
    calls.push(id); return { label: id, entries: [{ kind: "message", role: "user", content: "BLANK-TARGET-QA" }] };
  } };
  for (const name of ["ReadTranscript", "SearchTranscripts"]) {
    const tool = m.createContextTools(deps).find((item) => item.name === name);
    const args = { session_id: "", agent_id: " ", subagent_id: "", ...(name === "SearchTranscripts" ? { query: "BLANK-TARGET-QA", all_conversations: true } : { before: 0, around: 0 }) };
    const result = await tool.execute(m.createContext(), { executeToolCall: async (ctx, _initial, _id, run) => run(ctx) },
      (async function* () { yield JSON.stringify(args); })(), { toolCallId: name });
    assert.equal(result.result.case, "success");
  }
  assert.deepEqual(calls, ["self", "self"]);
});
