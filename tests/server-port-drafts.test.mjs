import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { bundleServerPort } from "./server-port-bundle.mjs";
const m = await bundleServerPort(["host/runner/tools/draft-attachments", "shared/external-drafts", "host/runner/tools/draft-connector", "host/runner/tools/draft-route-verification", "host/runner/tools/draft-send-calls", "host/runner/tools/draft-external-message-tool", "host/extensions/transcript/draft-sends", "packages/context/core"]);
const evidence = path.resolve(process.env.DRAFT_EVIDENCE_DIR ?? ".omo/evidence/drafts-20261019");
mkdirSync(evidence, { recursive: true });
const message = { type: "email-draft", draft: { from: "me@example.com", to: ["before@example.com"], subject: "Review", body: "Original" } };
const route = { platform: "email", providerIdentifier: "gmail-account" };
const verification = { platform: "email", sendingAddress: "me@example.com" };
const entry = { agentId: "agent", entryId: "card", message, route, verification, state: "editable", revision: 0 };
const ok = value => ({ outcome: "sent", resultText: JSON.stringify(value) });
function fixture(t, initial = entry, overrides = {}) {
  const filename = path.join(evidence, `${t.name.replace(/[^a-z0-9]+/gi, "-")}.sqlite`);
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS drafts (agent TEXT, id TEXT, revision INTEGER, value TEXT, PRIMARY KEY(agent,id)); DELETE FROM drafts;");
  db.prepare("INSERT INTO drafts VALUES (?,?,?,?)").run(initial.agentId, initial.entryId, initial.revision, JSON.stringify(initial));
  const store = {
    async read(key) { const row = db.prepare("SELECT value FROM drafts WHERE agent=? AND id=?").get(key.agentId, key.entryId); return row ? JSON.parse(row.value) : null; },
    async compareAndSet(before, after) { return db.prepare("UPDATE drafts SET value=?, revision=? WHERE agent=? AND id=? AND revision=?").run(JSON.stringify(after), after.revision, before.agentId, before.entryId, before.revision).changes === 1; },
    async listSending() { return db.prepare("SELECT value FROM drafts").all().map(row => JSON.parse(row.value)).filter(row => row.state === "sending"); },
  };
  const calls = [], events = [], prompts = [];
  const execute = async call => {
    calls.push({ ...call, signal: undefined });
    if (call.toolName === "search_threads") return ok({ threads: [{ messages: [{ sender: "Me <me@example.com>", labelIds: ["SENT"] }] }] });
    if (call.toolName === "get_me") return ok({ mail: "me@example.com" });
    if (call.toolName === "get_message") return ok({ id: "parent", subject: "Earlier", sender: "them@example.com" });
    if (call.toolName === "get_mail_message") return ok({ id: "parent", subject: "Earlier", from: { emailAddress: { address: "them@example.com" } } });
    return ok({ id: "provider-draft" });
  };
  const deps = { store, execute, onUpdate: e => events.push(e), onSettled: async (e, prompt) => prompts.push({ state: e.state, prompt }), ...overrides };
  t.after(() => { writeFileSync(filename + ".json", JSON.stringify({ calls, events, prompts, final: db.prepare("SELECT value FROM drafts").all().map(row => JSON.parse(row.value)) }, null, 2)); db.close(); });
  return { store, calls, events, prompts, deps, service: new m.DraftSends(deps), request: { agentId: initial.agentId, entryId: initial.entryId, draft: initial.message } };
}

test("schema refuses platform fields invalid addresses and HTML", () => {
  // Given/When/Then: invalid boundary input must never become a typed draft.
  const valid = { platform: "email", providerIdentifier: "g", ...message.draft };
  for (const changed of [{ from: "Name <me@example.com>" }, { channelId: "C123" }, { to: [] }, { body: "<p>hello</p>" }]) assert.equal(m.draftExternalMessageParameters.safeParse({ ...valid, ...changed }).success, false);
  assert.equal(m.sendDraftRequestSchema.safeParse({ agentId: "a", entryId: "e", draft: message }).success, true);
});
test("tool saves verified card and reports held without sending", async t => {
  const f = fixture(t); const saved = [];
  const tool = m.createDraftExternalMessageTool({ execute: f.deps.execute, emitDraft: async emission => { saved.push(emission); return "card"; } });
  const result = await tool.execute(m.createContext(), { executeToolCall: async (ctx, _initial, _id, run) => run(ctx) }, (async function* () { yield JSON.stringify({ platform: "email", providerIdentifier: "gmail-account", ...message.draft }); })(), { toolCallId: "draft-test" });
  assert.equal(result.result.case, "success"); assert.match(result.result.value.currentStep, /Nothing has been sent/);
  assert.deepEqual(saved, [{ message, route, verification }]); assert.deepEqual(f.calls.map(c => c.toolName), ["search_threads"]);
});
test("tool refuses mismatched sender before emit", async t => {
  const f = fixture(t); let writes = 0;
  await assert.rejects(m.emitExternalDraft({ platform: "email", providerIdentifier: "gmail-account", ...message.draft, from: "other@example.com" }, { execute: f.deps.execute, emitDraft: async () => { writes++; return "id"; } }), /from does not match/);
  assert.equal(writes, 0);
});
test("final edits signature and resolved attachments reach connector", async t => {
  const f = fixture(t, entry, { prepareAttachments: async (_call, attachments) => ({ ok: true, attachments: attachments.map(a => ({ name: a.name, data: "resolved-authorized-bytes" })) }) });
  const draft = { type: "email-draft", draft: { ...message.draft, to: ["edited@example.com"], cc: ["cc@example.com"], subject: "Edited", body: "Final", signature: "User signature", attachments: [{ id: "authorized-id", name: "file.txt" }] } };
  assert.equal((await f.service.sendDraft({ ...f.request, draft })).accepted, true);
  assert.deepEqual(f.calls.at(-1).args, { to: ["edited@example.com"], cc: ["cc@example.com"], subject: "Edited", body: "Final\n\nUser signature", htmlBody: '<div dir="auto">Final<br><br>User signature</div>', attachments: [{ name: "file.txt", data: "resolved-authorized-bytes" }] });
  assert.equal((await f.store.read(entry)).state, "sent"); assert.deepEqual((await f.store.read(entry)).message, draft);
});
test("sender edits and unsupported attachments fail closed", async t => {
  const f = fixture(t);
  for (const edits of [{ from: "other@example.com" }, { attachments: [{ id: "x", name: "x" }] }]) assert.equal((await f.service.sendDraft({ ...f.request, draft: { ...message, draft: { ...message.draft, ...edits } } })).accepted, false);
  assert.equal(f.calls.length, 0); assert.equal((await f.store.read(entry)).state, "editable");
});
test("concurrent services claim one durable send", async t => {
  const f = fixture(t); const other = new m.DraftSends(f.deps);
  const results = await Promise.all([f.service.sendDraft(f.request), other.sendDraft(f.request), f.service.discardDraft({ agentId: entry.agentId, entryId: entry.entryId })]);
  assert.equal(results.filter(r => r.accepted).length, 1); assert.equal(f.calls.filter(c => c.toolName === "send_message").length, 1);
  assert.equal((await f.store.read(entry)).state, "sent");
});
test("account rebind rolls back preserving final edits", async t => {
  const f = fixture(t, entry, { execute: async () => ok({ threads: [{ messages: [{ sender: "changed@example.com", labelIds: ["SENT"] }] }] }) });
  const draft = { ...message, draft: { ...message.draft, body: "Edited" } };
  assert.equal((await f.service.sendDraft({ ...f.request, draft })).accepted, false);
  assert.equal((await f.store.read(entry)).state, "editable"); assert.deepEqual((await f.store.read(entry)).message, draft);
});
test("ambiguous dispatch is unconfirmed and cannot resend", async t => {
  const f = fixture(t); const read = f.deps.execute; let sends = 0;
  f.deps.execute = async call => { if (call.toolName === "send_message") { sends++; throw new Error("connection lost after dispatch"); } return read(call); };
  await f.service.sendDraft(f.request); assert.equal((await f.store.read(entry)).state, "unconfirmed");
  assert.equal((await f.service.sendDraft(f.request)).accepted, false); assert.equal(sends, 1); assert.match(f.prompts[0].prompt, /never automatically retry/);
});
for (const mailbox of ["gmail", "outlook"]) test(`${mailbox} reply stages then sends provider draft`, async t => {
  const f = fixture(t, { ...entry, route: { ...route, mailbox, replyToMessageId: "parent" }, verification: { ...verification, replyTo: "Earlier" } });
  await f.service.sendDraft(f.request);
  assert.equal(f.calls.at(-2).toolName, "create_draft"); assert.equal(f.calls.at(-2).args.replyToMessageId, "parent");
  assert.deepEqual(f.calls.at(-1).args, { draftId: "provider-draft" }); assert.equal(f.calls.at(-1).toolName, mailbox === "gmail" ? "send_message" : "send_draft");
  assert.equal((await f.store.read(entry)).state, "sent");
});
test("finishing failure leaves draft-created without automatic retry", async t => {
  const f = fixture(t, { ...entry, route: { ...route, replyToMessageId: "parent" }, verification: { ...verification, replyTo: "Earlier" } });
  const execute = f.deps.execute;
  f.deps.execute = call => call.args.draftId ? Promise.resolve({ outcome: "failed", error: "Tool unavailable" }) : execute(call);
  await f.service.sendDraft(f.request); assert.equal((await f.store.read(entry)).state, "draft-created");
  assert.equal((await f.service.sendDraft(f.request)).accepted, false); assert.match(f.prompts[0].prompt, /NOT sent/);
});
test("discard and startup sweep are durable and never dispatch", async t => {
  const f = fixture(t); const discarded = await f.service.discardDraft({ agentId: entry.agentId, entryId: entry.entryId });
  assert.equal(discarded.accepted, true); assert.equal(discarded.state, "discarded");
  assert.equal((await f.store.read(entry)).state, "discarded"); assert.equal((await f.service.sendDraft(f.request)).accepted, false);
  const stored = await f.store.read(entry); await f.store.compareAndSet(stored, { ...stored, state: "sending", revision: stored.revision + 1 });
  await new m.DraftSends(f.deps).sweepStrandedDraftSends(); assert.equal((await f.store.read(entry)).state, "unconfirmed"); assert.equal(f.calls.length, 0);
});
test("Slack facts verify channel account and thread before exact routing", async () => {
  const route = { platform: "slack", providerIdentifier: "slack-account", channelId: "C12345678", threadTs: "123.456" };
  const execute = async call => ok(call.toolName === "slack_read_channel" ? { messages: "Channel: #general (C12345678)" } : call.toolName === "slack_read_user_profile" ? { result: "Organization Name: Acme\nEmail: me@example.com" } : { messages: "From: Jane\nMessage TS: 123.456\nParent message" });
  const result = await m.resolveDraftRouteVerification(execute, route);
  assert.deepEqual(result, { ok: true, verification: { platform: "slack", channelName: "#general", workspace: "Acme (me@example.com)", thread: "Jane: Parent message" } });
  assert.equal((await m.resolveDraftRouteVerification(execute, { ...route, channelId: "C99999999" })).ok, false);
  assert.equal((await m.resolveDraftRouteVerification(execute, { ...route, threadTs: "999.999" })).ok, false);
  const card = { type: "slack-draft", draft: { target: "#general", body: "Hi", thread: "Jane: Parent message" } };
  assert.deepEqual(m.buildDraftSendCall(route, card).first.args, { channel_id: "C12345678", message: "Hi", thread_ts: "123.456" });
});
test("protobuf adapter reports permanent failures without fabricated success", () => {
  const args = m.buildDraftCallArgs({ providerIdentifier: "g", toolName: "send_message", args: { to: ["a@example.com"], body: "hi" } });
  assert.equal(args.name, "g-send_message"); assert.deepEqual(args.args.to.toJson(), ["a@example.com"]);
  for (const failure of ["toolNotFound", "serverNotFound", "permissionDenied", "approved", "rejected", "error"]) assert.equal(m.parseDraftCallResult({ result: { case: failure, value: {} } }).outcome, "failed");
  assert.equal(m.parseDraftCallResult({}).outcome, "unconfirmed");
  assert.deepEqual(m.parseDraftCallResult({ result: { case: "success", value: { isError: false, content: [{ content: { case: "text", value: { text: '{"id":"sent"}' } } }] } } }), { outcome: "sent", resultText: '{"id":"sent"}' });
});
test("deadline aborts connector and marks uncertainty", async () => {
  let signal;
  const result = await m.executeDraftWithDeadline(async call => { signal = call.signal; return new Promise(() => {}); }, { providerIdentifier: "g", toolName: "send_message", args: {} }, 5);
  assert.equal(result.outcome, "unconfirmed"); assert.equal(signal.aborted, true);
});

test("failed durable claim prevents connector dispatch", async t => {
  const f = fixture(t); f.deps.store = { ...f.store, compareAndSet: async () => false };
  assert.equal((await f.service.sendDraft(f.request)).accepted, false);
  assert.equal(f.calls.length, 0); assert.equal((await f.store.read(entry)).state, "editable");
});
test("bot stop and live sweep do not revoke a user send", async t => {
  const f = fixture(t); const execute = f.deps.execute; const turn = new AbortController();
  let release; const gate = new Promise(resolve => { release = resolve; });
  let started; const ready = new Promise(resolve => { started = resolve; });
  f.deps.execute = async call => { if (call.toolName === "send_message") { started(); await gate; assert.equal(call.signal.aborted, false); } return execute(call); };
  const sending = f.service.sendDraft(f.request); await ready; turn.abort();
  await f.service.sweepStrandedDraftSends(); assert.equal((await f.store.read(entry)).state, "sending");
  release(); await sending; assert.equal((await f.store.read(entry)).state, "sent");
});
test("permanent missing-tool failure executes once without argument repair", async t => {
  const f = fixture(t); const execute = f.deps.execute; let attempts = 0;
  f.deps.execute = async call => call.toolName === "send_message" ? (attempts++, { outcome: "failed", error: "The connector does not offer this tool." }) : execute(call);
  const result = await f.service.sendDraft(f.request);
  assert.equal(attempts, 1); assert.equal(result.accepted, true); assert.equal(result.state, "editable");
  assert.match(result.error, /does not offer/); assert.equal((await f.store.read(entry)).state, "editable");
});
test("finishing ambiguity remains unconfirmed", async t => {
  const f = fixture(t, { ...entry, route: { ...route, replyToMessageId: "parent" }, verification: { ...verification, replyTo: "Earlier" } });
  const execute = f.deps.execute;
  f.deps.execute = async call => call.args.draftId ? { outcome: "unconfirmed" } : execute(call);
  await f.service.sendDraft(f.request); assert.equal((await f.store.read(entry)).state, "unconfirmed");
  assert.equal((await f.service.sendDraft(f.request)).accepted, false);
});
test("staged draft without readable id is never resent", async t => {
  const f = fixture(t, { ...entry, route: { ...route, replyToMessageId: "parent" }, verification: { ...verification, replyTo: "Earlier" } });
  const execute = f.deps.execute;
  f.deps.execute = async call => call.toolName === "create_draft" ? ok({}) : execute(call);
  await f.service.sendDraft(f.request); assert.equal((await f.store.read(entry)).state, "draft-created");
  assert.equal(f.calls.filter(call => call.toolName === "send_message").length, 0);
});
test("Slack DM label uses recipient facts excluding account owner", async () => {
  const route = { platform: "slack", providerIdentifier: "s", channelId: "D12345678" };
  const result = await m.resolveDraftRouteVerification(async call => ok(call.toolName === "slack_read_channel" ? { messages: "Channel: DM (D12345678)\nMe <me@example.com>: old\nJane <jane@example.com>: hello" } : { result: "Organization Name: Acme\nEmail: me@example.com\nDisplay Name: Me" }), route);
  assert.equal(result.ok, true); assert.equal(result.verification.channelName, "Jane");
});
test("email HTML escapes prose and autolinks without trailing punctuation", () => {
  const result = m.buildDraftSendCall(route, { ...message, draft: { ...message.draft, body: 'See https://example.com/a).\n<note> & "quote"' } });
  assert.equal(result.first.args.htmlBody, '<div dir="auto">See <a href="https://example.com/a">https://example.com/a</a>).<br>&lt;note&gt; &amp; &quot;quote&quot;</div>');
});

// Formal oracle: executable 2e0e295 host code, used directly instead of a hand-built fixture.
const formalSource = readFileSync("/private/tmp/grok-before0712-evidence-20261019/host-main.cjs", "utf8");
assert.equal(formalSource.includes("create_reply_draft"), false);
function extractFormalFunction(source, name) {
  const start = source.indexOf("function " + name + "(");
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, name);
  const code = source.slice(start, end + 3);
  new vm.Script(code);
  return code;
}
function extractFormalConst(source, name) {
  const start = source.indexOf("var " + name + " = ");
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n", start);
  return source.slice(start, end === -1 ? source.length : end) + ";";
}
const oracleSource = ["inertDraftText", "escapeHtml", "proseHtml", "emailDraftHtmlBody",
  "withoutTrailingProsePunctuation", "closesUnopenedParenthesis",
  "parseDraftConnectorJson", "parseDraftConnectorRecord", "parseCreatedDraftId",
  "buildEmailSendCall"].map(name => extractFormalFunction(formalSource, name)).join("\n")
  + "\n" + ["BARE_URL", "TRAILING_PROSE_PUNCTUATION"].map(name => extractFormalConst(formalSource, name)).join("\n");
writeFileSync(path.join(evidence, "formal-draft-oracle.js"), oracleSource);
const oracle = vm.runInNewContext(oracleSource + "\nbuildEmailSendCall;", {});
test("formal model schema carries no signature alias or attachment support", () => {
  const schemaStart = formalSource.indexOf("var draftExternalMessageObjectSchema = ");
  assert.ok(schemaStart >= 0);
  const schemaText = formalSource.slice(schemaStart, formalSource.indexOf("var PLATFORM_SCOPED_DRAFT_FIELDS", schemaStart));
  for (const field of ["signature", "sendAs", "attachments"]) assert.equal(new RegExp("\bb" + field + "\bs*:").test(schemaText), false);
  assert.equal(m.draftExternalMessageParameters.safeParse({ platform: "email", providerIdentifier: "p", ...message.draft, signature: "Some other person" }).success, false);
  assert.equal(m.sendDraftRequestSchema.safeParse({ agentId: "a", entryId: "e", draft: { ...message, draft: { ...message.draft, signature: "User edited" } } }).success, true);
});
test("send call matches executable formal host for both mailboxes", () => {
  const draft = { from: "me@example.com", to: ["a@example.com"], cc: ["cc@example.com"], subject: "Subject", body: "Hi https://example.com/a)." };
  for (const mailbox of ["gmail", "outlook"]) for (const replyToMessageId of [undefined, "parent"]) {
    const route = { platform: "email", providerIdentifier: "p", mailbox, ...(replyToMessageId === undefined ? {} : { replyToMessageId }) };
    const expected = oracle(route, draft);
    const actual = m.buildDraftSendCall(route, { type: "email-draft", draft });
    assert.equal(actual.first.toolName, expected.toolName);
    assert.deepEqual(JSON.parse(JSON.stringify(actual.first.args)), JSON.parse(JSON.stringify(expected.args)));
    if (expected.completion) for (const resultText of ['{"id":"staged"}', '"staged"', '{}', '  {"id":"x"}  ']) {
      const next = actual.completion(resultText);
      const want = expected.completion.buildCall(resultText);
      assert.deepEqual(next === null ? null : { toolName: next.toolName, args: JSON.parse(JSON.stringify(next.args)) },
        want === null ? null : { toolName: want.toolName, args: JSON.parse(JSON.stringify(want.args)) });
      if (next !== null) assert.deepEqual(Object.keys(next.args), ["draftId"]);
    } else assert.equal(actual.completion, undefined);
  }
});
test("attachment preparer refuses undiscoverable or incapable connectors", async () => {
  let resolves = 0;
  const deps = { listTools: async () => [], resolveAttachment: async () => { resolves++; return null; } };
  const call = { providerIdentifier: "p", toolName: "send_message", args: {} };
  assert.equal((await m.createDraftAttachmentPreparer(deps)(call, [{ id: "a", name: "f.txt" }])).ok, false);
  assert.equal(resolves, 0);
});
test("attachment preparer enforces discovered schema and authorized ids", async () => {
  const schema = { type: "object", properties: { channel_id: { type: "string" }, message: { type: "string" }, attachments: { type: "array", items: { type: "object", properties: { fileId: { type: "string" } }, required: ["fileId"] } } }, required: ["channel_id", "message"] };
  const seen = [];
  const deps = {
    listTools: async () => [{ providerIdentifier: "p", toolName: "slack_send_message", inputSchema: schema }],
    resolveAttachment: async (request) => { seen.push(request.id); return request.id === "ok" ? { id: "ok", name: "f.txt", providerIdentifier: "p", value: { fileId: "f1" } } : null; },
  };
  const prepare = m.createDraftAttachmentPreparer(deps);
  const call = { providerIdentifier: "p", toolName: "slack_send_message", args: { channel_id: "C1", message: "hi" } };
  assert.deepEqual(await prepare(call, [{ id: "ok", name: "f.txt" }]), { ok: true, attachments: [{ fileId: "f1" }] });
  assert.equal((await prepare(call, [{ id: "nope", name: "f.txt" }])).ok, false);
  assert.equal((await prepare({ ...call, toolName: "other_tool" }, [{ id: "ok", name: "f.txt" }])).ok, false);
  assert.deepEqual(seen, ["ok", "nope"]);
});
