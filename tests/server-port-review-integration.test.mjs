import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundleServerPort } from "./server-port-bundle.mjs";
const m = await bundleServerPort(["host/review-interactions-service", "host/review-mcp-execution", "host/extensions/transcript/review-transcript-store", "host/extensions/transcript/review-draft-store", "host/extensions/session/agent-db", "packages/context/core"]);
const dir = mkdtempSync(path.join(tmpdir(), "review-integration-"));
const dbs = new Map();
after(() => { for (const db of dbs.values()) db.close(); rmSync(dir, { recursive: true, force: true }); });
function dbFor(agentId) {
  const hit = dbs.get(agentId);
  if (hit !== undefined) return hit;
  const db = new m.SandAgentDb(path.join(dir, agentId, "agent.db"));
  dbs.set(agentId, db);
  return db;
}
function connectorSuccess(text) {
  return { result: { case: "success", value: { isError: false, content: [{ content: { case: "text", value: { text } } }] } } };
}
function emailBehavior(calls, tools) {
  return async args => {
    calls.push({ toolName: args.toolName, providerIdentifier: args.providerIdentifier, keys: Object.keys(args.args ?? {}) });
    if (args.toolName === "search_threads") return connectorSuccess(JSON.stringify({ threads: [{ messages: [{ sender: "Me <me@example.com>", labelIds: ["SENT"] }] }] }));
  // Pending forms survive their turn end; submitted values wait for the resumed turn lease instead.
    if (args.toolName === "create_draft") return connectorSuccess(JSON.stringify({ id: "staged" }));
    return connectorSuccess(JSON.stringify({ id: "sent" }));
  };
}
function openService(wakes, calls, tools, extra) {
  const manager = {
    sessions: { activeSession: undefined, resolveBackgroundSession: async agentId => { const db = dbFor(agentId); return { db, dbPath: db.dbPath }; } },
    sessionStore: { listAgentRecordIds: async () => [...dbs.keys()] },
    roster: { emit: () => undefined, emitAgentUpdate: async () => undefined },
    boxHandoff: { resumeWithHiddenPrompt: async (agentId, prompt, token) => { wakes.push({ agentId, prompt, token }); } },
  // Third arg is the real token boundary: the fake stores it exactly as production carries it.
  };
  const mcp = {
    createExecutor: () => ({ execute: async (ctx, args) => emailBehavior(calls)(args) }),
    getTools: async () => tools,
  };
  return m.createReviewInteractions({ transcript: manager, mcp, resolvePrivateBox: async () => undefined, ...(extra ?? {}) });
}
function gmailTools() {
  return [
    { providerIdentifier: "gmail-1", toolName: "search_threads", name: "gmail-1-search_threads" },
    { providerIdentifier: "gmail-1", toolName: "send_message", name: "gmail-1-send_message" },
    { providerIdentifier: "gmail-1", toolName: "create_draft", name: "gmail-1-create_draft" },
  ];
}
async function invoke(tool, args) {
  const result = await tool.execute(m.createContext(),
    { executeToolCall: async (ctx, _init, _id, run) => run(ctx) },
    (async function* () { yield JSON.stringify(args); })(), { toolCallId: "review-test" });
  assert.equal(result.result.case, "success", result.result.case === "error" ? result.result.value.error : undefined);
  return result.result.value.currentStep;
}
function draftEntryId(agentId) {
  const found = dbFor(agentId).getTranscriptEntries().find(entry => entry.message !== null && typeof entry.message === "object" && entry.message.type === "email-draft");
  assert.ok(found);
  return found.id;
}
function formEntry(agentId, requestId) {
  const found = dbFor(agentId).getTranscriptEntries().find(entry => entry.message !== null && typeof entry.message === "object" && entry.message.type === "user-form" && entry.message.form.id === requestId);
  assert.ok(found);
  return found;
}
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
test("end-to-end: tool draft, edited user send, hidden wake, discard and recover", async () => {
  dbs.clear();
  const wakes = [], calls = [];
  const service = openService(wakes, calls, gmailTools());
  const tools = service.toolsForTurn({ agentId: "a1", requestId: "r1", endThisRunAwaitingUser: () => undefined });
  const draft = tools.find(tool => tool.name === "DraftExternalMessage");
  assert.ok(draft);
  const card = { platform: "email", providerIdentifier: "gmail-1", from: "me@example.com", to: ["a@example.com"], subject: "Hello", body: "Hi" };
  await invoke(draft, card);
  assert.equal(calls.filter(call => call.toolName === "search_threads").length, 1);
  const entryId = draftEntryId("a1");
  const sent = await service.sendDraft({ agentId: "a1", entryId, draft: { type: "email-draft", draft: { from: "me@example.com", to: ["edited@example.com"], subject: "Hello", body: "Final" } } });
  assert.equal(sent.accepted, true);
  const sendCalls = calls.filter(call => call.toolName === "send_message");
  assert.equal(sendCalls.length, 1);
  assert.deepEqual(Object.keys(sendCalls[0]).sort(), ["keys", "providerIdentifier", "toolName"]);
  assert.equal(wakes.length, 1);
  assert.match(wakes[0].prompt, /sent/);
  assert.equal((await service.sendDraft({ agentId: "a1", entryId, draft: { type: "email-draft", draft: { from: "me@example.com", to: ["x@example.com"], subject: "H", body: "b" } } })).accepted, false);
  await invoke(draft, { ...card, subject: "Second" });
  const cards = dbFor("a1").getTranscriptEntries().filter(entry => entry.message !== null && typeof entry.message === "object" && entry.message.type === "email-draft");
  const discarded = await service.discardDraft({ agentId: "a1", entryId: cards[cards.length - 1].id });
  assert.equal(discarded.accepted, true);
  assert.equal(wakes.length, 1);
  await service.recover();
  assert.equal(calls.length, calls.filter(call => call.toolName !== "discard").length);
});
test("turn lifecycle: pending forms survive turn end, submitted settle, stop halts pending", async () => {
  dbs.clear();
  const wakes = [], calls = [];
  const service = openService(wakes, calls, gmailTools());
  const tools = service.toolsForTurn({ agentId: "a2", requestId: "turn-1", endThisRunAwaitingUser: () => undefined });
  const requestForm = tools.find(tool => tool.name === "RequestUserForm");
  assert.ok(requestForm);
  const first = JSON.parse(await invoke(requestForm, { title: "Login", instruction: "Enter the code", reason: "auth", fields: [{ id: "code", label: "Code", type: "text" }] }));
  assert.equal(first.status, "shown");
  service.onTurnEnded("a2", "turn-1");
  await service.onTurnStarted("a2", "turn-2");
  assert.equal(dbFor("a2").getTranscriptEntries().length, 1);
  service.stopAgent("a2");
  await tick(10);
  await service.onTurnStarted("a2", "turn-3");
  assert.equal((await service.submitUserForm({ agentId: "a2", requestId: first.requestId, values: {} })).status, "unavailable");
  service.onTurnEnded("a2", "turn-3");
});
test("per-agent isolation: sweep marks only own stranded sending", async () => {
  dbs.clear();
  const wakes = [], calls = [];
  const service = openService(wakes, calls, gmailTools());
  service.toolsForTurn({ agentId: "a3", requestId: "r", endThisRunAwaitingUser: () => undefined });
  const draft = service.toolsForTurn({ agentId: "a4", requestId: "r", endThisRunAwaitingUser: () => undefined }).find(tool => tool.name === "DraftExternalMessage");
  await invoke(draft, { platform: "email", providerIdentifier: "gmail-1", from: "me@example.com", to: ["a@example.com"], subject: "S", body: "B" });
  const entry = dbFor("a4").getTranscriptEntries().find(item => item.message !== null && typeof item.message === "object" && item.message.type === "email-draft");
  dbFor("a4").compareAndSetTranscriptEntry(entry, { ...entry, draftSendState: "sending", draftRevision: 1 });
  await service.recover();
  const settled = dbFor("a4").getTranscriptEntries().find(item => item.id === entry.id);
  assert.equal(settled.draftSendState, "unconfirmed");
  assert.equal(dbFor("a3").getTranscriptEntries().length, 0);
});
test("instance dispose kills pending form values and revives nothing", async () => {
  dbs.clear();
  const wakes = [], calls = [];
  const service = openService(wakes, calls, gmailTools());
  const requestForm = service.toolsForTurn({ agentId: "a5", requestId: "turn-1", endThisRunAwaitingUser: () => undefined }).find(tool => tool.name === "RequestUserForm");
  const form = JSON.parse(await invoke(requestForm, { title: "Login", instruction: "Enter the code", reason: "auth", fields: [{ id: "code", label: "Code", type: "text" }]}));
  assert.equal(form.status, "shown", JSON.stringify(form));
  service.dispose();
  await tick(10);
  assert.equal((await service.submitUserForm({ agentId: "a5", requestId: form.requestId, values: {} })).status, "unavailable");
  assert.equal((await service.dismissUserForm({ agentId: "a5", requestId: form.requestId })).status, "unavailable");
});
test("recover expires pending forms without reviving their values", async () => {
  dbs.clear();
  const wakes = [], calls = [];
  const service = openService(wakes, calls, gmailTools());
  const requestForm = service.toolsForTurn({ agentId: "a6", requestId: "turn-1", endThisRunAwaitingUser: () => undefined }).find(tool => tool.name === "RequestUserForm");
  const raw = await invoke(requestForm, { title: "Login", instruction: "Enter the code", reason: "auth", fields: [{ id: "code", label: "Code", type: "text" }] });
  const form = typeof raw === "string" ? JSON.parse(raw) : raw;
  assert.equal(form.status, "shown");
  await service.recover();
  await tick(10);
  assert.equal((await service.submitUserForm({ agentId: "a6", requestId: form.requestId, values: {} })).status, "unavailable");
  assert.equal(wakes.length, 0);
});
test("user-form wake carries typed receipt structure, never values", async () => {
  dbs.clear();
  const wakes = [], calls = [];
  const service = openService(wakes, calls, gmailTools());
  const tools = service.toolsForTurn({ agentId: "a6", requestId: "r1", endThisRunAwaitingUser: () => undefined });
  const requestForm = tools.find(tool => tool.name === "RequestUserForm");
  assert.ok(requestForm);
  const created = JSON.parse(await invoke(requestForm, { title: 'Login', instruction: 'Enter the code', reason: 'auth', fields: [{ id: 'f1', label: 'F1', type: 'text' }, { id: 'f2', label: 'F2', type: 'checkbox' }] }));
  assert.equal(created.status, "shown");
  const receipt = await service.submitUserForm({ agentId: "a6", requestId: created.requestId, values: { f1: "secret-value", f2: true } });
  assert.equal(receipt.status, "submitted");
  await tick(30);
  const formWakes = wakes.filter(wake => wake.agentId === 'a6' && wake.prompt.indexOf('"type":"user-form"') !== -1);
  assert.equal(formWakes.length, 1);
  const payload = JSON.parse(formWakes[0].prompt);
  assert.equal(payload.type, "user-form");
  assert.equal(payload.requestId, created.requestId);
  assert.equal(payload.status, "submitted");
  assert.deepEqual(payload.fields, [{ id: "f1", status: "not_filled" }, { id: "f2", status: "not_filled" }]);
  assert.equal("values" in payload, false);
  assert.equal(formWakes[0].prompt.indexOf("secret-value"), -1);
  assert.equal(formEntry("a6", created.requestId).userFormState, "submitted");
});
test("restart expires orphaned form cards without refilling values", async () => {
  dbs.clear();
  const serviceA = openService([], [], gmailTools());
  const requestA = serviceA.toolsForTurn({ agentId: "a7", requestId: "r1", endThisRunAwaitingUser: () => undefined }).find(tool => tool.name === "RequestUserForm");
  assert.ok(requestA);
  const done = JSON.parse(await invoke(requestA, { title: "Done", instruction: "Enter", reason: "auth", fields: [{ id: "f1", label: "F1", type: "text" }] }));
  assert.equal((await serviceA.submitUserForm({ agentId: "a7", requestId: done.requestId, values: { f1: "v" } })).status, "submitted");
  const orphan = JSON.parse(await invoke(requestA, { title: "Orphan", instruction: "Enter", reason: "auth", fields: [{ id: "f2", label: "F2", type: "text" }] }));
  assert.equal(orphan.status, "shown");
  const wakesB = [], callsB = [];
  const serviceB = openService(wakesB, callsB, gmailTools());
  await serviceB.recover();
  assert.equal(formEntry("a7", done.requestId).userFormState, "submitted");
  const settled = formEntry("a7", orphan.requestId);
  assert.equal(settled.userFormState, "expired");
  assert.equal(settled.formResolution, "expired");
  assert.equal("values" in settled.message.form, false);
  const retry = await serviceB.submitUserForm({ agentId: "a7", requestId: orphan.requestId, values: { f2: "late" } });
  assert.equal(retry.status, "unavailable");
  assert.equal("values" in retry, false);
  assert.equal(wakesB.length, 0);
});
function scriptedBox(mode) {
  let ids = [];
  return {
    windowIndex: 3,
    terminalsFolder: "/t",
    upload: async () => undefined,
    spawn: async () => ({ shellId: 7, stdinLoggingSuppressed: true }),
    writeStdin: async (id, chars) => { ids = JSON.parse(chars).entries.map(entry => entry.field.id); },
    download: async () => Buffer.from("__USER_FORM_RESULT__" + JSON.stringify({ fields: ids.map(entryId => mode.current === "filled" ? { id: entryId, status: "filled" } : { id: entryId, status: "failed", reason: "stale_locator" }) })),
    terminate: async () => undefined,
  };
}
test("receipt token binds lease to its own held form", async () => {
  dbs.clear();
  const mode = { current: "filled" };
  const box = scriptedBox(mode);
  const wakes = [], calls = [];
  const service = openService(wakes, calls, gmailTools(), { resolvePrivateBox: async () => box });
  const agent = service.toolsForTurn({ agentId: "a8", requestId: "r1", endThisRunAwaitingUser: () => undefined });
  const requestForm = agent.find(tool => tool.name === "RequestUserForm");
  assert.ok(requestForm);
  const field = id => ({ id, label: id, type: "text", target: { kind: "ref", value: "name" } });
  const first = JSON.parse(await invoke(requestForm, { title: "F1", instruction: "Go", reason: "other", domain: "example.com", fields: [field("f1")] }));
  const second = JSON.parse(await invoke(requestForm, { title: "F2", instruction: "Go", reason: "other", domain: "example.com", fields: [field("f2")] }));
  assert.equal(first.status, "shown");
  assert.equal(second.status, "shown");
  mode.current = "stale";
  const submitted1 = await service.submitUserForm({ agentId: "a8", requestId: first.requestId, values: { f1: "one" } });
  assert.equal(submitted1.status, "submitted");
  assert.deepEqual(submitted1.remapFieldIds, ["f1"]);
  const submitted2 = await service.submitUserForm({ agentId: "a8", requestId: second.requestId, values: { f2: "two" } });
  assert.equal(submitted2.status, "submitted");
  await tick(30);
  const formWakes = wakes.filter(wake => wake.agentId === "a8" && typeof wake.prompt === "string" && wake.prompt.indexOf("submitted") !== -1);
  assert.equal(formWakes.length, 2);
  for (const wake of formWakes) assert.ok(wake.token !== null && typeof wake.token === "object" && typeof wake.token.inferenceRequestId === "string" && wake.token.inferenceRequestId.length > 0);
  const token1 = String(formWakes[0].token.inferenceRequestId), token2 = String(formWakes[1].token.inferenceRequestId);
  assert.ok(token1 !== token2);
  // Settle only the first lease turn: the second held form must survive untouched.
  service.onTurnEnded("a8", token1);
  // settleTurn notifies the card fire-and-forget, so yield before reading the entry.
  await tick(30);
  assert.equal(formEntry("a8", first.requestId).userFormState, "turn_ended");
  assert.equal(formEntry("a8", second.requestId).userFormState, "submitted");
  // A routine or new user turn that merely shares the agent id rebinds nothing.
  service.onTurnStarted("a8", "intruder");
  service.onTurnEnded("a8", "intruder");
  await tick(30);
  assert.equal(formEntry("a8", second.requestId).userFormState, "submitted");
  const intruder = service.toolsForTurn({ agentId: "a8", requestId: "intruder", endThisRunAwaitingUser: () => undefined });
  const remapIntruder = intruder.find(tool => tool.name === "RemapUserFormTargets");
  assert.equal(JSON.parse(await invoke(remapIntruder, { targets: [{ fieldId: "f2", target: { kind: "ref", value: "other" } }] })).status, "unavailable");
  const holder = service.toolsForTurn({ agentId: "a8", requestId: token2, endThisRunAwaitingUser: () => undefined });
  const remapHolder = holder.find(tool => tool.name === "RemapUserFormTargets");
  assert.equal(JSON.parse(await invoke(remapHolder, { targets: [{ fieldId: "f2", target: { kind: "ref", value: "other" } }] })).status, "remapped");
});
