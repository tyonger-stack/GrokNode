import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, mkdir, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundleServerPort } from "./server-port-bundle.mjs";

const m = await bundleServerPort(["host/extensions/session/agent-db", "host/extensions/transcript/review-transcript-store",
  "host/extensions/transcript/review-draft-store", "host/extensions/transcript/turn-runtime", "host/review-attachments", "packages/context/core", "host/box/protected-path-guard",
  "host/review-mcp-execution", "host/extensions/transcript/draft-sends", "host/extensions/transcript/box-handoff-resume"]);
const card = { type: "email-draft", draft: { from: "sender@example.com", to: ["before@example.com"], subject: "Synthetic", body: "Example" } };
const emission = { message: card, route: { platform: "email", providerIdentifier: "gmail-1" }, verification: { platform: "email", sendingAddress: "sender@example.com" } };
async function setup(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "review-production-")));
  const dir = path.join(root, "agents", "a"); await mkdir(dir, { recursive: true });
  const db = new m.SandAgentDb(path.join(dir, "store.db"));
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  const session = { id: "a", db, dbPath: path.join(dir, "store.db") };
  const manager = { sessions: { resolveBackgroundSession: async () => session, activeSession: undefined },
    sessionStore: { listAgentRecordIds: async () => ["a"] }, roster: { emitAgentUpdate: async () => {} } };
  const store = new m.ReviewTranscriptStore(manager);
  return { root, dir, db, session, manager, store };
}

test("SQLite compare-and-set gives only one competing send a durable claim", async t => {
  const { store, db } = await setup(t);
  const drafts = m.createReviewDraftStore(store);
  const entryId = await drafts.publish("a", emission);
  const expected = await drafts.read({ agentId: "a", entryId });
  const next = { ...expected, state: "sending", revision: expected.revision + 1 };
  const winners = await Promise.all([drafts.compareAndSet(expected, next), drafts.compareAndSet(expected, next)]);
  assert.equal(winners.filter(Boolean).length, 1);
  const stored = db.getEntryById(entryId);
  assert.equal(stored.draftSendState, "sending"); assert.equal(stored.draftRevision, 1);
});

test("an already saved review card fulfills delivery without appending a duplicate", async t => {
  const { store, db, session, manager } = await setup(t);
  const id = await (await store.open("a")).append(card);
  const fulfilled = [];
  manager.runLifecycle = { trackProgressFromUpdate() {}, trackComposingFromUpdate() {}, trackRetryingFromUpdate() {}, trackActivityFromUpdate() {} };
  manager.ackObligations = { fulfillAckObligation: (...args) => fulfilled.push(args) };
  const runtime = new m.TurnRuntime(manager);
  const result = runtime.handleAgentUpdate({ type: "send-message", message: card, reviewEntryId: id, timestampMs: Date.now(), ackToken: "owned-token" }, session);
  assert.equal(result, id); assert.deepEqual(fulfilled, [["a", "owned-token"]]); assert.equal(db.getTranscriptEntries().length, 1);
  assert.throws(() => runtime.handleAgentUpdate({ type: "send-message", message: card, reviewEntryId: "missing" }, session), TypeError);
});

test("attachment resolution reads only the bound agent bucket and honors the live connector schema", async t => {
  const { store, db, dir } = await setup(t);
  await mkdir(path.join(dir, "attachments"));
  const file = path.join(dir, "attachments", "report.txt"); await writeFile(file, "synthetic bytes");
  db.appendTranscriptEntry({ id: "file-entry", kind: "user-attachment", file_path: file, file_name: "report.txt" });
  const mcp = { createExecutor() {}, getTools: async () => [{ providerIdentifier: "mailbox", toolName: "send_mail", name: "send", inputSchema: {
    type: "object", properties: { attachments: { type: "array", items: { type: "object", required: ["name", "contentBytes"], properties: { name: { type: "string" }, contentBytes: { type: "string" } } } } },
  } }] };
  const resolve = m.createReviewAttachmentResolver(store, mcp);
  const request = { agentId: "a", providerIdentifier: "mailbox", toolName: "send_mail", id: "file-entry" };
  const attachment = await resolve(request);
  assert.equal(attachment.name, "report.txt"); assert.equal(Buffer.from(attachment.value.contentBytes, "base64").toString(), "synthetic bytes");
  assert.equal(await resolve({ ...request, providerIdentifier: "other-account" }), null);
  assert.equal(await resolve({ ...request, id: file }), null);
});

test("the private form driver stays outside model file access even without configured host roots", async () => {
  for (const candidate of ["/tmp/.sand-user-form-private.mjs", "/private/tmp/.sand-user-form-private.mjs", "../tmp/.sand-user-form-private.mjs"]) {
    await assert.rejects(m.assertPathOutsideProtectedRoots([], candidate, "/workspace"), m.SandProtectedPathError);
  }
  await m.assertPathOutsideProtectedRoots([], "/workspace/ordinary-report.txt", "/workspace");
});

test("a missing backend execution result permanently disables blind resend of the same card", async t => {
  const { store } = await setup(t), drafts = m.createReviewDraftStore(store);
  const entryId = await drafts.publish("a", emission);
  let dispatched = 0;
  const execute = m.createReviewDraftExecute({ needsAuth: async () => null,
    listTools: async () => ["search_threads", "send_message"].map(toolName => ({ providerIdentifier: "gmail-1", toolName, name: toolName })),
    execute: async args => {
      if (args.toolName === "send_message") { dispatched++; return { result: { case: "error", value: { error: "Backend MCP execution returned no result for send_message." } } }; }
      const text = JSON.stringify({ threads: [{ messages: [{ sender: "sender@example.com", labelIds: ["SENT"] }] }] });
      return { result: { case: "success", value: { isError: false, content: [{ content: { case: "text", value: { text } } }] } } };
    } });
  const sends = new m.DraftSends({ store: drafts, execute, onUpdate() {}, onSettled: async () => {} });
  const request = { agentId: "a", entryId, draft: card };
  assert.equal((await sends.sendDraft(request)).accepted, true);
  assert.equal((await sends.sendDraft(request)).accepted, false);
  assert.equal(dispatched, 1); assert.equal((await drafts.read(request)).state, "unconfirmed");
});

test("the hidden receipt resumes with the exact request identity owning its remap lease", async () => {
  let options;
  const session = { id: "a" };
  const handoff = new m.BoxHandoffResume({ execution: { canExecute: true }, sessions: { resolveBackgroundSession: async () => session },
    groupChat: { isGroupSession: () => false }, runnerRegistry: { getRunner: () => ({ run: async (_prompt, input) => { options = input; } }) },
    runLifecycle: { beginSessionRun() {}, endSessionRun() {}, enqueueExclusiveRun: async (_id, run) => run() },
    ackObligations: { mintAckRunToken: () => "ack", retireAckRunToken() {} },
    turnRuntime: { activeRequestPrompts: new Map(), activeRequestSources: new Map() }, roster: { emitAgentUpdate: async () => {} } });
  await handoff.resumeWithHiddenPrompt("a", "synthetic receipt", { errorTitle: "Resume test", inferenceRequestId: "form-resume-only" });
  assert.equal(options.inferenceRequestId, "form-resume-only"); assert.equal(options.hidden, true);
});
