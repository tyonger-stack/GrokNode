import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

async function load(name, entryPath) {
  const cache = path.join(root, "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(path.join(cache, "routine-email-"));
  const outfile = path.join(temporary, name + ".cjs");
  await build({
    entryPoints: [entryPath],
    outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent",
  });
  return { module: createRequire(import.meta.url)(outfile), dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("describeTrigger renders the official 0.75.8 email copy verbatim", async (t) => {
  const shared = await load("automations-shared", path.join(root, "source/shared/automations.ts"));
  const schedule = await load("automation-schedule", path.join(root, "source/shared/automation-schedule.ts"));
  t.after(() => Promise.all([shared.dispose(), schedule.dispose()]));
  assert.equal(schedule.module.describeTrigger({ type: "email", inbox: "bot@mail.grokbot.com" }), "When email arrives at bot@mail.grokbot.com");
  assert.equal(
    schedule.module.describeTrigger({ type: "email", inbox: "bot@mail.grokbot.com", requireAuthPass: false }),
    "When email arrives at bot@mail.grokbot.com, including unauthenticated senders",
  );
  // describeListener's email sentence through the group form: describeTrigger lowercases the
  // first letter of non-first segments and joins with " or ".
  assert.equal(
    schedule.module.describeTrigger({ type: "group", listeners: [{ type: "cron", schedule: "0 9 * * *" }, { type: "email", inbox: "bot@mail.grokbot.com" }] }),
    "Every day at 9:00 AM or when email arrives at bot@mail.grokbot.com",
  );
  assert.equal(
    schedule.module.describeTrigger({ type: "group", listeners: [{ type: "email", inbox: "bot@mail.grokbot.com", requireAuthPass: false }, { type: "cron", schedule: "0 9 * * *" }] }),
    "When email arrives at bot@mail.grokbot.com, including unauthenticated senders or every day at 9:00 AM",
  );
  assert.equal(shared.module.triggerHasEmailMember({ type: "group", listeners: [{ type: "cron", schedule: "0 9 * * *" }, { type: "email", inbox: "a@b.c" }] }), true);
  assert.equal(shared.module.triggerHasEmailMember({ type: "cron", schedule: "0 9 * * *" }), false);
  assert.deepEqual(shared.module.storedTriggerEmailInboxes({ type: "group", listeners: [{ type: "email", inbox: "Bot@Mail.grokbot.com" }, { type: "email", inbox: "bot@mail.grokbot.com" }, { type: "cron", schedule: "0 9 * * *" }] }), ["Bot@Mail.grokbot.com"]);
});

test("email triggers parse, round-trip, match events, and render the <email_message> block", async (t) => {
  const triggers = await load("automation-trigger", path.join(root, "source/host/automations/automation-trigger.ts"));
  const shared = await load("automations-shared-m", path.join(root, "source/shared/automations.ts"));
  t.after(() => Promise.all([triggers.dispose(), shared.dispose()]));
  const parsed = triggers.module.parseStoredTrigger({ type: "email", inbox: "bot@mail.grokbot.com" });
  assert.deepEqual(parsed, { type: "email", inbox: "bot@mail.grokbot.com" });
  assert.deepEqual(triggers.module.parseStoredTrigger(triggers.module.serializeStoredTrigger(parsed)), parsed);
  const full = triggers.module.parseStoredTrigger({ type: "email", inbox: "bot@mail.grokbot.com", from: ["boss@corp.com", "Bot@Corp.com"], requireAuthPass: false });
  assert.deepEqual(full, { type: "email", inbox: "bot@mail.grokbot.com", from: ["boss@corp.com", "Bot@Corp.com"], requireAuthPass: false });
  // An inbox without "@" is not a usable email trigger, matching the zod contract.
  assert.equal(triggers.module.parseStoredTrigger({ type: "email", inbox: "not-an-address" }), null);
  assert.equal(triggers.module.parseStoredTrigger({ type: "email" }), null);

  const event = { source: "email", inbox: "BOT@mail.grokbot.com", messageId: "m1", threadId: "t1", subject: "Deploy", from: { name: "Boss", email: "boss@corp.com" }, snippet: "go", occurredAtMs: 5 };
  assert.equal(triggers.module.triggerMatchesEvent(parsed, event), true, "inbox matching is case-insensitive");
  assert.equal(triggers.module.triggerMatchesEvent(parsed, { ...event, inbox: "other@mail.grokbot.com" }), false);
  const narrowed = triggers.module.parseStoredTrigger({ type: "email", inbox: "bot@mail.grokbot.com", from: ["BOSS@corp.com"] });
  assert.equal(triggers.module.triggerMatchesEvent(narrowed, event), true, "the from allowlist matches sender email case-insensitively");
  assert.equal(triggers.module.triggerMatchesEvent(narrowed, { ...event, from: { name: "X", email: "stranger@corp.com" } }), false);
  assert.equal(triggers.module.triggerMatchesEvent(narrowed, { ...event, from: undefined }), false);
  // requireAuthPass only changes the description; the wire summary has no auth field to filter on.
  const unauthenticated = triggers.module.parseStoredTrigger({ type: "email", inbox: "bot@mail.grokbot.com", requireAuthPass: false });
  assert.equal(triggers.module.triggerMatchesEvent(unauthenticated, event), true);

  assert.equal(triggers.module.describeTriggerEvent(event), 'email from boss@corp.com to BOT@mail.grokbot.com: "Deploy"');
  const block = triggers.module.buildTriggerEventContextBlock(event);
  assert.match(block, /<email_message>/);
  assert.match(block, /<\/email_message>/);
  assert.match(block, /"messageId": "m1"/);
  assert.equal(shared.module.triggerEventTriggers({ type: "email", inbox: "bot@mail.grokbot.com" }).length, 1, "email is an event trigger, never a bare-fire cron");
});

test("the state-tool zod accepts the full email trigger shape and rejects a missing inbox", async (t) => {
  const tool = await load("sand-state-tool", path.join(root, "source/host/runner/tools/sand-state-tool.ts"));
  t.after(() => tool.dispose());
  const parameters = tool.module.sandUpdateStateParameters;
  const base = { target: "routine", action: "create", name: "Mail me", prompt: "Do the thing" };
  assert.equal(parameters.safeParse({ ...base, trigger: { type: "email", inbox: "bot@mail.grokbot.com", from: ["boss@corp.com"], requireAuthPass: false } }).success, true);
  assert.equal(parameters.safeParse({ ...base, trigger: { type: "email", inbox: "bot@mail.grokbot.com" } }).success, true);
  assert.equal(parameters.safeParse({ ...base, trigger: { type: "email" } }).success, false, "a trigger without inbox is rejected");
  assert.equal(parameters.safeParse({ ...base, trigger: { type: "email", inbox: "no-at-sign" } }).success, false, "an inbox without @ is rejected");
  assert.equal(parameters.safeParse({ ...base, trigger: { type: "email", inbox: "bot@mail.grokbot.com", from: "boss@corp.com" } }).success, false, "from must be an array");
  assert.equal(parameters.safeParse({ ...base, trigger: { type: "group", listeners: [{ type: "email", inbox: "bot@mail.grokbot.com" }, { type: "cron", schedule: "0 9 * * *" }] } }).success, true);
});

function manualPolling() {
  let tick = null, disposed = 0;
  return { policy: { name: "manual", start(fn) { tick = fn; return { dispose() { tick = null; disposed += 1; } }; } }, tick: () => tick?.(), isDisposed: () => disposed > 0 };
}

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const thread = (threadId, subject, messages) => ({ threadId, subject, messageCount: messages.length, lastMessageAtMs: String(Math.max(...messages.map((m) => m.occurredAtMs))), participants: [], matchingMessages: messages, unreadCount: 1 });
const message = (messageId, email, occurredAtMs, direction = "INBOUND", snippet = "hi") => ({ messageId, from: { name: "Sender", email }, occurredAtMs: String(occurredAtMs), direction, snippet, unread: true });

function createEmailFixture({ searchBodies, listBody = { inboxes: [] } } ) {
  const calls = [];
  let handler = async (url, init) => {
    const method = String(url).split("/").pop();
    calls.push({ method, body: JSON.parse(init.body) });
    if (method === "ListGrokBotEmailInboxes") return jsonResponse(listBody);
    const next = searchBodies.shift();
    if (next instanceof Error) throw next;
    return next == null ? jsonResponse({ threads: [] }) : jsonResponse(next);
  };
  return { calls, setHandler: (next) => { handler = next; }, fetchImpl: (url, init) => handler(url, init) };
}

test("the email inbox source validates saves: owned passes, unknown blocks with the account's addresses, unreachable degrades to a warning", async (t) => {
  const source = await load("email-inbox-source", path.join(root, "source/host/extensions/automations/email-inbox-source.ts"));
  t.after(() => source.dispose());
  const build = (listBody) => {
    const fixture = createEmailFixture({ searchBodies: [], listBody });
    const { validateEmailInboxes } = source.module.createEmailInboxSources({
      getAccessToken: async () => "token", getBackendUrl: () => "https://backend.example", polling: manualPolling().policy, fetchImpl: fixture.fetchImpl,
    });
    return { validate: validateEmailInboxes, calls: fixture.calls };
  };
  const owned = build({ inboxes: [{ email: "bot@mail.grokbot.com", domain: "mail.grokbot.com", createdAtMs: "1", assigned: true }] });
  assert.deepEqual(await owned.validate(["bot@mail.grokbot.com"]), { ok: true });
  assert.equal(owned.calls.length, 1);
  assert.deepEqual(owned.calls[0].body, { showsAssigned: true }, "validation lists the account's assigned inboxes");
  assert.equal(owned.calls[0].method, "ListGrokBotEmailInboxes");

  const missing = build({ inboxes: [{ email: "first@mail.grokbot.com" }, { email: "second@mail.grokbot.com" }] });
  const rejected = await missing.validate(["Bot@Mail.grokbot.com"]);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /Bot@Mail\.grokbot\.com/);
  assert.match(rejected.reason, /first@mail\.grokbot\.com, second@mail\.grokbot\.com/);
  assert.match(rejected.reason, /official Grok Bot app/);

  const offlineResult = await (async () => {
    const brokenFetch = async () => { throw new Error("network down"); };
    const { validateEmailInboxes } = source.module.createEmailInboxSources({ getAccessToken: async () => "token", getBackendUrl: () => "https://backend.example", polling: manualPolling().policy, fetchImpl: brokenFetch });
    return await validateEmailInboxes(["bot@mail.grokbot.com"]);
  })();
  assert.equal(offlineResult.ok, true, "an unreachable RPC never blocks the save");
  assert.match(offlineResult.warning, /could not be confirmed/);
  assert.match(offlineResult.warning, /bot@mail\.grokbot\.com/);
});

test("the email polling source wakes on inbound mail, dedupes by messageId, skips outbound, and errors with backoff", async (t) => {
  const source = await load("email-inbox-source-poll", path.join(root, "source/host/extensions/automations/email-inbox-source.ts"));
  t.after(() => source.dispose());
  let nowMs = 1_000_000;
  const { policy, tick } = manualPolling();
  const searchBodies = [
    { threads: [thread("t1", "Deploy", [message("m1", "boss@corp.com", nowMs + 10), message("m2", "bot@mail.grokbot.com", nowMs + 20, "OUTBOUND")])] },
    { threads: [thread("t1", "Deploy", [message("m1", "boss@corp.com", nowMs + 10), message("m3", "peer@corp.com", nowMs + 30)])] },
  ];
  const fixture = createEmailFixture({ searchBodies });
  const { email, requestPoll } = source.module.createEmailInboxSources({
    getAccessToken: async () => "token", getBackendUrl: () => "https://backend.example", polling: policy, fetchImpl: fixture.fetchImpl, now: () => nowMs,
  });
  assert.deepEqual(email.getStatus(), { state: "idle" });
  const events = [];
  await email.start((event) => { events.push(event); return true; });
  assert.equal(email.getStatus().state, "connecting");
  email.setListeners([{ type: "email", inbox: "bot@mail.grokbot.com" }, { type: "email", inbox: "BOT@MAIL.GROKBOT.COM" }, { type: "slack", channel: "#eng", match: { kind: "message" } }]);

  await tick();
  assert.equal(email.getStatus().state, "listening");
  assert.equal(events.length, 1, "one inbox polled once (case-duplicated subscriptions dedupe), OUTBOUND skipped");
  assert.deepEqual(events[0], { source: "email", inbox: "bot@mail.grokbot.com", messageId: "m1", threadId: "t1", subject: "Deploy", from: { name: "Sender", email: "boss@corp.com" }, snippet: "hi", occurredAtMs: nowMs + 10 });
  assert.equal(fixture.calls.filter((call) => call.method === "SearchGrokBotEmailThreads").length, 1);
  const firstSearch = fixture.calls.find((call) => call.method === "SearchGrokBotEmailThreads");
  assert.deepEqual(firstSearch.body, { inboxEmail: "bot@mail.grokbot.com", limit: 20, mode: "HYBRID" }, "the first poll carries no afterMs (an empty query is the proto default and stays off the wire)");

  nowMs += 60_000;
  await tick();
  assert.equal(events.length, 2, "a repeated messageId never wakes twice; only the new inbound message fires");
  assert.equal(events[1].messageId, "m3");
  const secondSearch = fixture.calls.filter((call) => call.method === "SearchGrokBotEmailThreads").at(-1);
  assert.equal(secondSearch.body.afterMs, String(nowMs - 60_000 + 20), "the watermark is the largest occurredAtMs of the last response, outbound included");

  // Consecutive failures move the source to error and back off; recovery returns to listening.
  fixture.setHandler(async () => { throw new Error("poll exploded"); });
  nowMs += 60_000;
  await tick();
  assert.equal(email.getStatus().state, "error");
  assert.match(email.getStatus().detail, /poll exploded/);
  await tick();
  assert.equal(fixture.calls.filter((call) => call.method === "SearchGrokBotEmailThreads").length, 2, "a tick inside the backoff window does not hit the wire");
  nowMs += 60_000;
  await tick();
  assert.equal(email.getStatus().state, "error");
  fixture.setHandler(async () => jsonResponse({ threads: [thread("t2", "Later", [message("m4", "x@y.com", nowMs + 5)])] }));
  nowMs += 60_000;
  await tick();
  assert.equal(email.getStatus().state, "listening");
  assert.equal(events.at(-1).messageId, "m4");
  void requestPoll;

  await email.stop();
  assert.deepEqual(email.getStatus(), { state: "idle" });
  assert.equal(events.length, 3, "stop drops the sink and resets the watermark memory");
});

test("the email source never polls without listeners", async (t) => {
  const source = await load("email-inbox-source-idle", path.join(root, "source/host/extensions/automations/email-inbox-source.ts"));
  t.after(() => source.dispose());
  const { policy, tick } = manualPolling();
  const fetchImpl = async () => { throw new Error("must not be called"); };
  const { email } = source.module.createEmailInboxSources({ getAccessToken: async () => "token", getBackendUrl: () => "https://backend.example", polling: policy, fetchImpl });
  await email.start(() => true);
  email.setListeners([]);
  await tick();
  assert.deepEqual(email.getStatus(), { state: "connecting" }, "no listeners leaves the state untouched and the wire cold");
  await email.stop();
});

test("the trigger hub collects email listeners alongside slack and github", async (t) => {
  const hub = await load("sand-trigger-hub", path.join(root, "source/host/extensions/automations/sand-trigger-hub.ts"));
  t.after(() => hub.dispose());
  const instance = new hub.module.SandTriggerHub({
    polling: manualPolling().policy, sources: [],
    listAutomations: async () => [
      { agentId: "a", automation: { id: "r1", isEnabled: true, trigger: { type: "email", inbox: "bot@mail.grokbot.com" } } },
      { agentId: "a", automation: { id: "r2", isEnabled: true, trigger: { type: "group", listeners: [{ type: "slack", channel: "#eng", match: { kind: "message" } }, { type: "email", inbox: "bot@mail.grokbot.com" }] } } },
      { agentId: "a", automation: { id: "r3", isEnabled: false, trigger: { type: "email", inbox: "bot@mail.grokbot.com" } } },
    ],
    fire: async () => undefined, isReady: () => true,
  });
  const desired = await instance.desiredListenersByKind();
  assert.deepEqual([...desired.keys()].sort(), ["email", "slack"]);
  assert.equal(desired.get("email").length, 2, "one email listener per enabled automation, group members included");
});

test("email-triggered routines stay local: never cloud triggers, never server-schedulable", async (t) => {
  const cloudSync = await load("sand-automation-cloud-sync-email", path.join(root, "source/host/extensions/automations/sand-automation-cloud-sync.ts"));
  t.after(() => cloudSync.dispose());
  assert.equal(cloudSync.module.cloudTriggers({ type: "email", inbox: "bot@mail.grokbot.com" }), null);
  assert.equal(cloudSync.module.isServerSchedulable({ trigger: { type: "email", inbox: "bot@mail.grokbot.com" } }), false);
  const mixed = { type: "group", listeners: [{ type: "cron", schedule: "0 9 * * *" }, { type: "email", inbox: "bot@mail.grokbot.com" }] };
  assert.equal(cloudSync.module.cloudTriggers(mixed), null);
  assert.equal(cloudSync.module.isServerSchedulable({ trigger: mixed }), false);
  assert.equal(cloudSync.module.isServerSchedulable({ trigger: { type: "cron", schedule: "0 9 * * 1-5" } }), true, "cron keeps its cloud scheduling");
});

test("routine writes run the email inbox validation: a rejection blocks the save, a warning rides along", async (t) => {
  const tool = await load("sand-state-tool-write", path.join(root, "source/host/runner/tools/sand-state-tool.ts"));
  const triggers = await load("automation-trigger-write", path.join(root, "source/host/automations/automation-trigger.ts"));
  t.after(() => Promise.all([tool.dispose(), triggers.dispose()]));
  const create = (validateEmailInboxes) => {
    const writes = [];
    return {
      writes,
      deps: {
        state: { createAutomation: async ({ spec }) => { writes.push(spec); return { ok: true, detail: `Saved routine "${spec.name}"` }; } },
        parseTrigger: triggers.module.parseStoredTrigger,
        ...(validateEmailInboxes == null ? {} : { validateEmailInboxes }),
      },
    };
  };
  const blocked = create(async () => ({ ok: false, reason: "not one of this account's Bot email addresses" }));
  const blockedOutcome = await tool.module.applySandStateUpdate({ target: "routine", action: "create", name: "Mail me", prompt: "p", trigger: { type: "email", inbox: "bot@mail.grokbot.com" } }, blocked.deps);
  assert.equal(blockedOutcome.ok, false);
  assert.equal(blockedOutcome.reason, "not one of this account's Bot email addresses");
  assert.equal(blocked.writes.length, 0, "a rejected inbox never reaches the store");

  const warned = create(async () => ({ ok: true, warning: "couldn't confirm the account's addresses" }));
  const warnedOutcome = await tool.module.applySandStateUpdate({ target: "routine", action: "create", name: "Mail me", prompt: "p", trigger: { type: "group", listeners: [{ type: "email", inbox: "bot@mail.grokbot.com" }, { type: "cron", schedule: "0 9 * * *" }] } }, warned.deps);
  assert.equal(warnedOutcome.ok, true);
  assert.match(warnedOutcome.detail, /couldn't confirm the account's addresses/);
  assert.equal(warned.writes.length, 1);

  const untouched = create(null);
  const plainOutcome = await tool.module.applySandStateUpdate({ target: "routine", action: "create", name: "Daily", prompt: "p", schedule: "0 9 * * *" }, untouched.deps);
  assert.equal(plainOutcome.ok, true, "routines without email members never consult the validator");
});

test("the standing orders document the email trigger shape", async (t) => {
  const docs = await load("automation-docs-email", path.join(root, "source/host/automations/automation.ts"));
  t.after(() => docs.dispose());
  const prompt = docs.module.renderAutomationsSystemPrompt([], "/agents/a/automations", "Asia/Shanghai");
  assert.match(prompt, /\{ "type": "email", "inbox": "<address>" \}/);
  assert.match(prompt, /only create it when the user already has a Bot email address/);
  assert.match(prompt, /<email_message>/);
});
