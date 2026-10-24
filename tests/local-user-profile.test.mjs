import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const modules = ["host/extensions/memory/local-user-profile", "host/extensions/memory/local-user-profile-evidence", "host/extensions/memory/extension", "host/extensions/memory/production", "host/extensions/session/agent-db", "host/runner/memory-context", "host/runner/system-prompt-assembly"];
const bundled = await build({ stdin: { contents: modules.map(name => `export * from './source/${name}.ts';`).join("\n"), resolveDir: root }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const preference = "Please run the focused tests before reporting the work complete.";
const debounce = { name: "fixture", wrap: fn => Object.assign(fn, { dispose() {} }) };

async function fixture(t, count = 4) {
  const dir = await mkdtemp(path.join(tmpdir(), "local-user-profile-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const databases = [];
  for (let index = 0; index < count; index++) {
    const db = new m.SandAgentDb(path.join(dir, "agents", `human-${index}`, "store.db"));
    db.appendTranscriptEntry({ id: "u1", kind: "message", role: "user", content: preference, timestampMs: 100 + index });
    databases.push(db);
  }
  t.after(() => databases.forEach(db => db.close()));
  return { dir, databases, agentsRoot: path.join(dir, "agents") };
}

function response(user, text = "The user expects focused tests before completion reports.") {
  const { conversations, claims } = JSON.parse(user);
  if (claims !== undefined) return JSON.stringify({ verdicts: claims.map(claim => ({ id: claim.id, decision: 'accept', basis: 'repeated_evidence', supportedSources: claim.sources.map((_, index) => index), corrections: claim.sources.map((source, sourceIndex) => ({ sourceIndex, quote: source.quote })), reason: 'The provided messages directly state the lasting instruction.' })) });
  return JSON.stringify({ claims: [{ section: "workstyle", text, sources: conversations.slice(0, 4).map(conversation => ({ conversationId: conversation.id, messageId: "u1", quote: preference })) }] });
}

function assembly(dir, id, overrides = {}) {
  return m.createSystemPromptAssembly({
    ...m.createRunnerMemoryContext({ agentId: id, dbPath: path.join(dir, "agents", id, "store.db"), sandRoot: dir, store: null, snapshots: null, resolveAgentName: name => name }),
    basePrompt: "base", isSubagentRunner: false, isSharedRoomRunner: false, isSystemPromptOverridden: false,
    agentProfileProvider: () => null, agentStore: () => null, compactionEpoch: () => 0,
    isBoxScopedSubagent: () => false, requestContext: { resolve: () => ({ timeZone: "UTC" }) },
    automationStore: () => null, workflowStore: () => null, channelStore: () => null, connectorManifests: [],
    mcpManagement: () => null, mcpCustomInstructionsSection: () => null, mcpDiscoveryStatusSection: () => null,
    remoteBoxSection: () => "", computerSection: () => null, isSpotlightEnabled: () => false,
    ...overrides,
  });
}

test("local human evidence excludes peers, connectors, hidden prompts, imports and shared rooms", async t => {
  const { dir, databases, agentsRoot } = await fixture(t);
  const db = databases[0];
  const excluded = [{ fromAgent: { id: "peer" } }, { toAgent: { id: "peer" } }, { fromUser: { name: "remote" } }, { channel: "slack" }, { channelSender: "other" }, { hidden: true }, { isHidden: true }, { source: "automation" }, { requestSource: "automation" }, { clientNonce: "memory-import-fixture" }];
  excluded.forEach((extra, index) => db.appendTranscriptEntry({ id: `excluded-${index}`, kind: "message", role: "user", content: "UNRELATED-IDENTITY", timestampMs: 999, ...extra }));
  ['自检：请回复hi', '再次给剩余的8个bot发：自检，请回复hi', '只回复两个字：收到', '继续', 'A'].forEach((content, index) => db.appendTranscriptEntry({ id: `probe-${index}`, kind: 'message', role: 'user', content, timestampMs: 1000 }));
  for (const [id, file] of [["group", "group.json"], ["remote", "remote-room.json"]]) {
    const group = new m.SandAgentDb(path.join(agentsRoot, id, "store.db"));
    group.appendTranscriptEntry({ id: "u1", kind: "message", role: "user", content: "UNRELATED-IDENTITY", timestampMs: 999 });
    group.close();
    await writeFile(path.join(agentsRoot, id, file), "{}");
  }
  const evidence = m.collectLocalProfileEvidence(agentsRoot);
  assert.equal(evidence.length, 4);
  assert.equal(evidence.flatMap(conversation => conversation.messages).length, 4);
  assert.ok(!JSON.stringify(evidence).includes("UNRELATED-IDENTITY"));
  assert.equal(m.readLocalUserProfile(dir), "");
});

test("profile persists and reaches multiple private Bots without per-Bot memory or cloud context", async t => {
  const { dir, agentsRoot } = await fixture(t);
  let calls = 0;
  const generate = async (system, user) => { calls++; assert.match(system, /LOCAL HUMAN/); return response(user); };
  const service = new m.LocalUserProfileService({ sandRoot: dir, agentsRoot, generate });
  t.after(() => service.dispose());
  assert.equal(await service.refresh(), "updated");
  const saved = await readFile(m.localUserProfilePath(dir), "utf8");
  assert.match(saved, /Sources: conversation human-/);
  assert.ok(!saved.includes(preference));
  for (const id of ["human-0", "new-bot"]) assert.match(assembly(dir, id).getSystemPrompt(), /<user_profile>[\s\S]*focused tests/);
  assert.doesNotMatch(assembly(dir, "group", { isSharedRoomRunner: true }).getSystemPrompt(), /<user_profile>/);
  const restarted = new m.LocalUserProfileService({ sandRoot: dir, agentsRoot, generate });
  t.after(() => restarted.dispose());
  assert.equal(await restarted.refresh(), "unchanged");
  assert.equal(calls, 2);
});

test("no conversations cannot trigger generation", async t => {
  const { dir, agentsRoot } = await fixture(t, 0);
  const service = new m.LocalUserProfileService({ sandRoot: dir, agentsRoot, generate: async () => { assert.fail("must not infer from insufficient conversations"); } });
  t.after(() => service.dispose());
  assert.equal(await service.refresh(), "insufficient-evidence");
});

test("invented citations and inference errors preserve the last successful profile", async t => {
  const { dir, databases, agentsRoot } = await fixture(t);
  let now = 10;
  let mode = "valid";
  const service = new m.LocalUserProfileService({ sandRoot: dir, agentsRoot, now: () => now, generate: async (_system, user) => {
    if (mode === "error") throw new Error("provider unavailable");
    if (_system.includes('LOCAL_USER_PROFILE_VERIFY')) return response(user);
    const result = JSON.parse(response(user));
    if (mode === "bad-quote") result.claims[0].sources[0].quote = "not present in the conversation";
    if (mode === "one-conversation") result.claims[0].sources = Array(4).fill(result.claims[0].sources[0]);
    return JSON.stringify(result);
  } });
  t.after(() => service.dispose());
  assert.equal(await service.refresh(), "updated");
  const saved = await readFile(m.localUserProfilePath(dir), "utf8");
  now += m.LOCAL_PROFILE_REFRESH_MS;
  databases[0].appendTranscriptEntry({ id: "u2", kind: "message", role: "user", content: "A changed conversation.", timestampMs: 1000 });
  for (mode of ["bad-quote", "one-conversation", "error"]) {
    assert.equal(await service.refresh(), mode === 'error' ? "failed" : "insufficient-evidence");
    assert.equal(await readFile(m.localUserProfilePath(dir), "utf8"), saved);
  }
});

test("refresh is single-flight and shutdown rejects an unfinished result", async t => {
  const { dir, agentsRoot } = await fixture(t);
  let resolve;
  let captured;
  const service = new m.LocalUserProfileService({ sandRoot: dir, agentsRoot, generate: (_system, user) => { captured = user; return new Promise(done => { resolve = done; }); } });
  const first = service.refresh();
  assert.equal(service.refresh(), first);
  service.dispose();
  resolve(response(captured));
  assert.equal(await first, "stopped");
  assert.equal(m.readLocalUserProfile(dir), "");
});

test("memory extension starts the local profile independently of authenticated gate hydration", async () => {
  let started = 0;
  let disposed = 0;
  const stops = [];
  const service = m.memoryExtension.start({ sandRoot: "/unused", agentsRootDir: "/unused/agents", debounce,
    deps: { experiments: { pinGateOnAuthenticatedBootstrap() {} }, inference: {}, telemetry: { logs: { reportMemorySynthesis() {} } } },
    createSynthesis() { assert.fail("cloud-gated dreaming must stay inactive"); },
    createUserProfile: () => ({ start() { started++; }, dispose() { disposed++; } }),
    onStop: callback => stops.push(callback),
  });
  assert.equal(started, 1);
  assert.ok(service);
  stops.forEach(stop => stop());
  assert.equal(disposed, 1);
});

test("evidence selection bounds conversation count and input size", async t => {
  const { databases, agentsRoot } = await fixture(t, 102);
  databases.forEach(db => {
    for (let index = 0; index < 45; index++) db.appendTranscriptEntry({ id: `long-${index}`, kind: "message", role: "user", content: "z".repeat(2200), timestampMs: 2000 + index });
  });
  const conversations = m.collectLocalProfileEvidence(agentsRoot);
  assert.equal(conversations.length, 100);
  assert.ok(conversations.every(conversation => conversation.messages.length <= 40));
  assert.ok(conversations.flatMap(conversation => conversation.messages).reduce((total, message) => total + message.content.length, 0) <= m.LOCAL_PROFILE_INPUT_CHARS);
});

test("a changed profile reaches an already-created prompt assembly after refresh", async t => {
  const { dir, databases, agentsRoot } = await fixture(t);
  let now = 1;
  let text = "The user prefers concise responses.";
  const service = new m.LocalUserProfileService({ sandRoot: dir, agentsRoot, now: () => now, generate: async (_system, user) => response(user, text) });
  t.after(() => service.dispose());
  await service.refresh();
  const prompt = assembly(dir, "human-0");
  assert.match(prompt.getSystemPrompt(), /concise responses/);
  now += m.LOCAL_PROFILE_REFRESH_MS;
  text = "The user expects focused tests before completion reports.";
  databases[0].appendTranscriptEntry({ id: "u2", kind: "message", role: "user", content: "New work.", timestampMs: 1000 });
  assert.equal(await service.refresh(), "updated");
  assert.match(prompt.getSystemPrompt(), /focused tests/);
  assert.doesNotMatch(prompt.getSystemPrompt(), /concise responses/);
});
