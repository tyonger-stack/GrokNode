import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(entry) {
  const result = await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("memory types map journal and shared facts onto the existing profile and log files", async () => {
  const types = await load("source/host/runner/memory-types.ts");
  assert.equal(types.memoryWriteTarget("journal").tier, "log");
  assert.equal(types.memoryWriteTarget("journal").scope, "agent");
  assert.equal(types.memoryWriteTarget("shared_profile").scope, "user");
  assert.equal(types.memoryWriteTarget("shared_profile").tier, "profile");
  assert.equal(types.memoryTypeForStoredKind("log", "user"), "shared_journal");
  assert.equal(types.JOURNAL_MEMORY_TYPE.surface, "always_in_context");
  assert.equal(types.JOURNAL_MEMORY_TYPE.prompt.includes("Only the latest entries stay in view"), true);
});

test("recall searches facts outside the prompt slice and keeps the char budget", async () => {
  const recall = await load("source/host/runner/memory-recall.ts");
  const facts = [
    { content: "lives in Hangzhou", createdAt: 1, memoryType: "profile" },
    { content: "x".repeat(5000), createdAt: 2, memoryType: "journal" },
    { content: "ticket ACME-9 is waiting", createdAt: 3, memoryType: "shared_journal", assistantName: "other" },
  ];
  const found = recall.recallMemoryFacts(facts, "ACME-9", 20);
  assert.equal(found.searched, 3);
  assert.equal(found.lines.length, 1);
  assert.match(found.lines[0], /\[via other\] \[shared_journal\] ticket ACME-9/);
  const bulky = recall.recallMemoryFacts(
    [
      { content: "alpha one", createdAt: 2, memoryType: "journal" },
      { content: `alpha ${"y".repeat(5000)}`, createdAt: 1, memoryType: "journal" },
    ],
    "alpha",
    20,
  );
  assert.equal(bulky.lines.length, 1);
  const rendered = recall.renderRecallMemoryResult({ query: "missing", lines: [], searched: 4 });
  assert.match(rendered, /No facts/);
});

test("related conversations are links and do not copy transcript text", async () => {
  const prompt = await load("source/host/runner/sessions/related-conversations-prompt.ts");
  const secret = "the other chat said the password is swordfish";
  const rendered = prompt.renderRelatedConversationsPrompt([
    { id: "agent-b", name: "Research" },
  ]);
  assert.match(rendered, /nothing from them is copied into this prompt/);
  assert.match(rendered, /session_id agent-b/);
  assert.equal(rendered.includes(secret), false);
  assert.equal(prompt.renderRelatedConversationsPrompt([]), "");
});

test("reading another transcript keeps tool activity private and pages by position", async () => {
  const transcript = await load("source/host/runner/transcript-read.ts");
  const entries = [
    { kind: "message", role: "user", content: "hello from tuesday" },
    { kind: "tool-call", name: "Shell" },
    { kind: "send-message", message: { type: "text", content: "hello back" } },
  ];
  const spoken = transcript.transcriptLinesFromEntries(entries, false);
  assert.deepEqual(spoken.map((line) => line.role), ["user", "assistant"]);
  const withTools = transcript.transcriptLinesFromEntries(entries, true);
  assert.equal(withTools.some((line) => line.role === "tool"), true);
  const page = transcript.readTranscriptWindow(withTools, { limit: 1 });
  assert.equal(page.lines.length, 1);
  assert.equal(typeof page.olderBefore, "number");
  const older = transcript.readTranscriptWindow(withTools, { limit: 30, before: page.olderBefore });
  assert.equal(older.lines.some((line) => line.includes("Shell")), true);
  const rendered = transcript.renderTranscriptRead({
    label: "Research",
    window: transcript.readTranscriptWindow(spoken, {}),
    spokenOnly: true,
  });
  assert.match(rendered, /tool activity stays private/);
  assert.equal(rendered.includes("Shell"), false);
});

test("start fresh clears model messages and keeps memory", async () => {
  const fresh = await load("source/host/runner/start-fresh-conversation.ts");
  const messages = ["hi", "earlier turn"];
  const result = fresh.startFreshModelContext({ clearMessages: () => { messages.length = 0; } });
  assert.deepEqual(messages, []);
  assert.equal(result.messagesLeftModelContext, true);
  assert.deepEqual(result.kept, ["memory", "files", "routines", "connections", "settings"]);
});
