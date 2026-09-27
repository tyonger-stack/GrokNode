import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

async function load(name, entryPath) {
  const cache = path.join(root, "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(path.join(cache, "local-webhook-"));
  const outfile = path.join(temporary, name + ".cjs");
  await build({
    entryPoints: [entryPath],
    outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent",
  });
  return { module: createRequire(import.meta.url)(outfile), dispose: () => rm(temporary, { recursive: true }) };
}

test("webhook trigger parses, describes, round-trips, and never matches broadcast events", async () => {
  const triggerLayer = await load("automation-trigger", path.join(root, "source/host/automations/automation-trigger.ts"));
  const sharedAutomations = await load("automations-shared", path.join(root, "source/shared/automations.ts"));
  const scheduleLayer = await load("automation-schedule", path.join(root, "source/shared/automation-schedule.ts"));
  try {
    const parsed = triggerLayer.module.parseStoredTrigger({ type: "webhook" });
    assert.deepEqual(parsed, { type: "webhook" });
    assert.deepEqual(triggerLayer.module.parseStoredTrigger(triggerLayer.module.serializeStoredTrigger(parsed)), parsed);
    assert.equal(scheduleLayer.module.describeTrigger({ type: "webhook" }), "When its webhook URL is called");
    assert.equal(triggerLayer.module.triggerMatchesEvent({ type: "webhook" }, { source: "slack", channel: "#eng", text: "hi", isMention: true }), false);
    assert.equal(sharedAutomations.module.triggerEventTriggers({ type: "webhook" }).length, 0);
    assert.equal(sharedAutomations.module.triggerHasWebhookMember({ type: "group", listeners: [{ type: "cron", schedule: "0 9 * * *" }, { type: "webhook" }] }), true);
    assert.equal(sharedAutomations.module.triggerHasWebhookMember({ type: "cron", schedule: "0 9 * * *" }), false);
    assert.equal(triggerLayer.module.describeTriggerEvent({ source: "webhook", text: "ping" }), 'a webhook call: "ping"');
    assert.match(triggerLayer.module.buildTriggerEventContextBlock({ source: "webhook", text: "ping" }), /<webhook_event>/);
  } finally {
    await triggerLayer.dispose();
    await sharedAutomations.dispose();
    await scheduleLayer.dispose();
  }
});

test("webhook routines stay local: no cloud triggers and never server-schedulable", async () => {
  const loaded = await load("sand-automation-cloud-sync", path.join(root, "source/host/extensions/automations/sand-automation-cloud-sync.ts"));
  try {
    assert.equal(loaded.module.cloudTriggers({ type: "webhook" }), null);
    assert.equal(loaded.module.isServerSchedulable({ trigger: { type: "webhook" } }), false);
    const mixed = { type: "group", listeners: [{ type: "cron", schedule: "0 9 * * *" }, { type: "webhook" }] };
    assert.equal(loaded.module.cloudTriggers(mixed), null);
    assert.equal(loaded.module.isServerSchedulable({ trigger: mixed }), false);
    assert.equal(loaded.module.isServerSchedulable({ trigger: { type: "cron", schedule: "0 9 * * 1-5" } }), true);
  } finally { await loaded.dispose(); }
});

test("webhook credentials: mint, store, verify, delete, and URL shape", async () => {
  const loaded = await load("webhook-credentials", path.join(root, "source/host/automations/webhook-credentials.ts"));
  const sandRoot = await mkdtemp(path.join(root, "node_modules", ".cache", "webhook-cred-"));
  const routineFolder = path.join(sandRoot, "agents", "agent-a", "automations", "wake-me");
  try {
    const key = loaded.module.generateWebhookKey();
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.notEqual(key, loaded.module.generateWebhookKey());
    assert.equal(loaded.module.verifyWebhookKey(undefined, key), false);
    assert.equal(loaded.module.verifyWebhookKey(key, "deadbeef"), false);
    await loaded.module.writeWebhookCredential(routineFolder, key, 1234);
    assert.equal(await loaded.module.readWebhookKey(routineFolder), key);
    assert.equal(loaded.module.verifyWebhookKey(key, key), true);
    assert.deepEqual(await readdir(routineFolder), ["webhook.json"]);
    assert.equal(loaded.module.webhookCredentialExists(routineFolder), true);
    await loaded.module.deleteWebhookCredential(routineFolder);
    assert.equal(await loaded.module.readWebhookKey(routineFolder), undefined);

    assert.equal(loaded.module.resolveWebhookListenerPort(sandRoot), 17901);
    await mkdir(sandRoot, { recursive: true });
    await writeFile(path.join(sandRoot, "settings.json"), JSON.stringify({ version: 1, webhookListenerPort: 12345 }));
    assert.equal(loaded.module.resolveWebhookListenerPort(sandRoot), 12345);

    assert.equal(loaded.module.buildWebhookUrl("agent-a", "wake-me", 17901), "http://127.0.0.1:17901/webhook/agent-a/wake-me");
    assert.equal(loaded.module.buildWebhookUrl("agent id", "wake me", 12345), "http://127.0.0.1:12345/webhook/agent%20id/wake%20me");
  } finally {
    await loaded.dispose();
    await rm(sandRoot, { recursive: true, force: true });
  }
});

test("routine create mints a webhook credential, update away from webhook removes it, and the key never enters the reply", async () => {
  const loaded = await load("agent-state", path.join(root, "source/host/extensions/memory/agent-state.ts"));
  const sandRoot = await mkdtemp(path.join(root, "node_modules", ".cache", "agent-state-"));
  const agentDir = path.join(sandRoot, "agents", "agent-a");
  const routineFolder = path.join(agentDir, "automations", "wake-me");
  const now = () => Date.parse("2026-09-25T10:00:00Z");
  let stored = null;
  const automationPort = {
    upsert: (spec) => { stored = { id: "wake-me", name: spec.name, trigger: spec.trigger, isEnabled: spec.isEnabled !== false }; return stored; },
    update: (id, spec) => { if (stored == null || stored.id !== id) return null; stored = { ...stored, name: spec.name ?? stored.name, trigger: spec.trigger }; return stored; },
    setEnabled: (id, isEnabled) => stored != null && stored.id === id ? { ...stored, isEnabled } : null,
    get: (id) => stored != null && stored.id === id ? { name: stored.name } : null,
    remove: (id) => { if (stored == null || stored.id !== id) return false; stored = null; return true; },
  };
  const deps = {
    agentId: "agent-a", agentDir, sandRoot,
    memory: { addMemory: () => ({ content: "saved" }), removeMemoryByContent: () => true },
    membership: { read: () => new Set(), join: () => true, leave: () => true },
    channels: { remove: () => true },
    automations: automationPort,
    workflows: { create: () => null, update: () => null, remove: () => false },
    readProfile: () => ({}), writeProfile: () => {}, writeSettings: () => {},
    now,
  };
  try {
    const state = loaded.module.createSandAgentState(deps);
    const created = await state.createAutomation({ spec: { name: "Wake me", prompt: "Do the thing", trigger: { type: "webhook" } } });
    assert.equal(created.ok, true);
    assert.match(created.message, /Saved routine "Wake me" \(folder wake-me\)/);
    assert.match(created.message, /http:\/\/127\.0\.0\.1:17901\/webhook\/agent-a\/wake-me/);
    assert.match(created.message, new RegExp(`Webhook: POST .* — the key is saved in .*${path.join("automations", "wake-me", "webhook.json")}`));
    const credential = JSON.parse(await readFile(path.join(routineFolder, "webhook.json"), "utf8"));
    assert.match(credential.key, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(created.message, new RegExp(credential.key));

    const updatedToWebhook = await state.updateAutomation({ id: "wake-me", spec: { name: "Wake me", prompt: "Do the thing", trigger: { type: "webhook" } } });
    assert.equal(updatedToWebhook.ok, true);
    const keyBefore = JSON.parse(await readFile(path.join(routineFolder, "webhook.json"), "utf8")).key;
    assert.equal(keyBefore, credential.key, "an existing credential is kept, not rotated");

    const updatedToCron = await state.updateAutomation({ id: "wake-me", spec: { name: "Wake me", prompt: "Do the thing", trigger: { type: "cron", schedule: "0 9 * * *" } } });
    assert.equal(updatedToCron.ok, true);
    assert.equal((await readdir(routineFolder).catch(() => [])).includes("webhook.json"), false, "credential is dropped when the trigger stops being a webhook");

    const reWebhook = await state.updateAutomation({ id: "wake-me", spec: { name: "Wake me", prompt: "Do the thing", trigger: { type: "webhook" } } });
    assert.equal(reWebhook.ok, true);
    const deleted = await state.deleteAutomation({ id: "wake-me" });
    assert.equal(deleted.ok, true);
    assert.equal((await readdir(routineFolder).catch(() => [])).includes("webhook.json"), false, "deleting the routine removes its credential");
  } finally {
    await loaded.dispose();
    await rm(sandRoot, { recursive: true, force: true });
  }
});

test("standing orders document the webhook trigger shape and its credential rule", async () => {
  const loaded = await load("automation-docs", path.join(root, "source/host/automations/automation.ts"));
  try {
    const prompt = loaded.module.renderAutomationsSystemPrompt([], "/agents/a/automations", "Asia/Shanghai");
    assert.match(prompt, /\{ "type": "webhook" \}/);
    assert.match(prompt, /webhook\.json/);
    assert.match(prompt, /never paste the key into chat/);
    assert.match(prompt, /host\.docker\.internal/);
    assert.match(prompt, /<webhook_event>/);
    assert.match(prompt, /fires when its webhook URL is POSTed/);
  } finally { await loaded.dispose(); }
});

test("the mac listener routes, authenticates, caps, and forwards webhook wakes", async () => {
  const loaded = await load("webhook-automation-listener", path.join(root, "source/electron-main/webhook-automation-listener.ts"));
  const forwarded = [];
  let outcome = { ok: true, status: 200 };
  const listener = loaded.module.startWebhookAutomationListener({
    port: 0,
    forwarder: { runAgentWebhookAutomation: async (args) => { forwarded.push(args); return outcome; } },
    onBindError: () => {},
  });
  const port = await listener.boundPort();
  assert.ok(port > 0);
  try {
    const post = (pathname, key, body) => fetch(`http://127.0.0.1:${port}${pathname}`, { method: "POST", ...(key == null ? {} : { headers: { authorization: `Bearer ${key}` } }), ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });

    assert.equal((await post("/nope", "k")).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/webhook/a/b`, { method: "GET", headers: { authorization: "Bearer k" } })).status, 405);
    assert.equal((await post("/webhook/agent-a/wake-me", null)).status, 401);

    assert.equal((await post("/webhook/agent-a/wake-me", "right-key", { text: "hello", extra: 1 })).status, 200);
    assert.equal(forwarded.at(-1).agentId, "agent-a");
    assert.equal(forwarded.at(-1).automationId, "wake-me");
    assert.equal(forwarded.at(-1).key, "right-key");
    assert.deepEqual(forwarded.at(-1).payload, { text: "hello", extra: 1 });

    assert.equal((await post("/webhook/agent-a/wake-me", "right-key", "plain text body")).status, 200);
    assert.deepEqual(forwarded.at(-1).payload, { text: "plain text body" });

    outcome = { ok: false, status: 401, message: "invalid webhook key" };
    assert.equal((await post("/webhook/agent-a/wake-me", "wrong-key")).status, 401);
    const rejected = await (await post("/webhook/agent-a/wake-me", "wrong-key")).json();
    assert.equal(rejected.message, "invalid webhook key");

    assert.equal((await post("/webhook/agent-a/wake-me", "right-key", "x".repeat(70 * 1024))).status, 413);
  } finally {
    listener.dispose();
    await loaded.dispose();
  }
});

test("the mac listener answers health checks, capability URLs, sender headers, and form payloads", async () => {
  const loaded = await load("webhook-listener-ingress", path.join(root, "source/electron-main/webhook-automation-listener.ts"));
  const forwarded = [];
  const listener = loaded.module.startWebhookAutomationListener({
    port: 0,
    forwarder: { runAgentWebhookAutomation: async (args) => { forwarded.push(args); return { ok: true, status: 200 }; } },
    onBindError: () => {},
  });
  const port = await listener.boundPort();
  const base = "http://127.0.0.1:" + port;
  try {
    const health = await fetch(base + "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "grok-node-webhook-automation" });

    const viaPathKey = await fetch(base + "/webhook/agent-a/wake-me/path-key-123", { method: "POST", body: JSON.stringify({ text: "via path" }) });
    assert.equal(viaPathKey.status, 200);
    assert.equal(forwarded.at(-1).key, "path-key-123");
    assert.deepEqual(forwarded.at(-1).payload, { text: "via path" });

    const viaHeaders = await fetch(base + "/webhook/agent-a/wake-me", {
      method: "POST",
      headers: { authorization: "Bearer right-key", "x-github-delivery": "d-123", "x-github-event": "push", "content-type": "application/json" },
      body: JSON.stringify({ repository: "acme/app" }),
    });
    assert.equal(viaHeaders.status, 200);
    assert.equal(forwarded.at(-1).deliveryId, "d-123");
    assert.equal(forwarded.at(-1).eventName, "push");
    assert.equal(forwarded.at(-1).contentType, "application/json");
    assert.deepEqual(forwarded.at(-1).payload, { repository: "acme/app" });

    const viaForm = await fetch(base + "/webhook/agent-a/wake-me", {
      method: "POST",
      headers: { authorization: "Bearer right-key", "content-type": "application/x-www-form-urlencoded" },
      body: "task=deploy&note=hello%20world",
    });
    assert.equal(viaForm.status, 200);
    assert.deepEqual(forwarded.at(-1).payload, { task: "deploy", note: "hello world" });

    const badJson = await fetch(base + "/webhook/agent-a/wake-me", {
      method: "POST",
      headers: { authorization: "Bearer right-key", "content-type": "application/json" },
      body: "{nope",
    });
    assert.equal(badJson.status, 400);
    assert.match((await badJson.json()).error, /invalid JSON/);
    assert.equal(forwarded.length, 3, "malformed JSON is rejected before reaching the host");
  } finally {
    listener.dispose();
    await loaded.dispose();
  }
});

test("the mac listener rate-limits a hammering sender with 429 and Retry-After", async () => {
  const loaded = await load("webhook-listener-rate", path.join(root, "source/electron-main/webhook-automation-listener.ts"));
  assert.equal(loaded.module.WEBHOOK_RATE_LIMIT, 30);
  const listener = loaded.module.startWebhookAutomationListener({
    port: 0,
    forwarder: { runAgentWebhookAutomation: async () => ({ ok: true, status: 200 }) },
    onBindError: () => {},
  });
  const port = await listener.boundPort();
  try {
    let limited = null;
    for (let i = 0; i <= loaded.module.WEBHOOK_RATE_LIMIT; i += 1) {
      const response = await fetch("http://127.0.0.1:" + port + "/webhook/agent-a/wake-me", { method: "POST", headers: { authorization: "Bearer k" }, body: "{}" });
      if (response.status === 429) { limited = response; break; }
    }
    assert.ok(limited, "expected a 429 once the per-endpoint budget is exhausted");
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    assert.equal((await limited.json()).error, "webhook rate limit exceeded");
  } finally {
    listener.dispose();
    await loaded.dispose();
  }
});

test("updateAgentAutomation preserves a webhook trigger against UI-originated overwrites", async () => {
  const loaded = await load("automation-runtime-guard", path.join(root, "source/host/extensions/transcript/automation-runtime.ts"));
  try {
    const webhookRecord = { id: "wake-me", name: "Wake me", prompt: "p", trigger: { type: "webhook" }, isEnabled: true, schedule: "", runs: [] };
    const captured = [];
    const tm = {
      sessions: { activeSession: null },
      sessionStore: {
        listAgentAutomations: () => [webhookRecord],
        updateAgentAutomation: (_agentId, _automationId, spec) => { captured.push(spec); return [webhookRecord]; },
      },
      shouldEmitAutomations: () => false,
    };
    await new loaded.module.AutomationRuntime(tm).updateAgentAutomation("agent-a", "wake-me", { name: "Renamed", prompt: "p2", trigger: { type: "cron", schedule: "0 8 * * *" } });
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].trigger, { type: "webhook" }, "the stored webhook trigger survives a UI-originated schedule overwrite (the pinned editor cannot represent it)");
    assert.equal(captured[0].name, "Renamed", "name edits still pass through");
    assert.equal(captured[0].prompt, "p2", "prompt edits still pass through");

    const cronRecord = { id: "daily", name: "Daily", prompt: "p", trigger: { type: "cron", schedule: "0 9 * * *" }, isEnabled: true, schedule: "0 9 * * *", runs: [] };
    const cronCaptured = [];
    const cronTm = {
      sessions: { activeSession: null },
      sessionStore: {
        listAgentAutomations: () => [cronRecord],
        updateAgentAutomation: (_agentId, _automationId, spec) => { cronCaptured.push(spec); return [cronRecord]; },
      },
      shouldEmitAutomations: () => false,
    };
    await new loaded.module.AutomationRuntime(cronTm).updateAgentAutomation("agent-a", "daily", { name: "Daily", prompt: "p", trigger: { type: "cron", schedule: "0 10 * * *" } });
    assert.deepEqual(cronCaptured[0].trigger, { type: "cron", schedule: "0 10 * * *" }, "non-webhook routine updates keep their new trigger");
  } finally { await loaded.dispose(); }
});

test("the gateway protocol dispatches the webhook wake command", async () => {
  const loaded = await load("gateway-protocol", path.join(root, "source/host/gateway-protocol.ts"));
  try {
    assert.ok(typeof loaded.module.SAND_GATEWAY_COMMANDS.runAgentWebhookAutomation === "function");
    assert.ok(typeof loaded.module.SAND_GATEWAY_COMMANDS.getAutomationWebhookCredential === "function");
    const calls = [];
    const api = { runAgentWebhookAutomation: (args) => { calls.push(args); return { ok: true, status: 200 }; } };
    const result = loaded.module.SAND_GATEWAY_COMMANDS.runAgentWebhookAutomation(api, JSON.stringify({ agentId: "a", automationId: "b", key: "k", payload: { text: "hi" }, deliveryId: "d1", eventName: "push", contentType: "application/json", userAgent: "ci/1.0" }));
    assert.deepEqual(result, { ok: true, status: 200 });
    assert.deepEqual(calls, [{ agentId: "a", automationId: "b", key: "k", payload: { text: "hi" }, deliveryId: "d1", eventName: "push", contentType: "application/json", userAgent: "ci/1.0" }]);
    const gatewayApiSource = await readFile(path.join(root, "source/host/host-gateway-api.ts"), "utf8");
    assert.match(gatewayApiSource, /deliveryId: args\.deliveryId/, "the host gateway must forward sender metadata to the runtime");
    assert.match(gatewayApiSource, /eventName: args\.eventName/);
  } finally { await loaded.dispose(); }
});

test("getAutomationWebhookCredential resolves url+key, honors the port override, and returns null when not applicable", async () => {
  const loaded = await load("automation-runtime", path.join(root, "source/host/extensions/transcript/automation-runtime.ts"));
  const credentialLayer = await load("webhook-credentials-rt", path.join(root, "source/host/automations/webhook-credentials.ts"));
  const sandRoot = await mkdtemp(path.join(root, "node_modules", ".cache", "webhook-rt-"));
  try {
    const key = credentialLayer.module.generateWebhookKey();
    const routineFolder = path.join(sandRoot, "agents", "agent-a", "automations", "wake-me");
    await credentialLayer.module.writeWebhookCredential(routineFolder, key, 1234);
    await writeFile(path.join(sandRoot, "settings.json"), JSON.stringify({ version: 1, webhookListenerPort: 12345 }));
    const automation = { id: "wake-me", name: "Wake me", prompt: "Do the thing", trigger: { type: "webhook" }, isEnabled: true, filePath: path.join(routineFolder, "automation.json") };
    const tm = {
      sessions: { activeSession: { id: "agent-a", automations: { get: (id) => id === "wake-me" ? automation : null } } },
      sessionStore: { listAgentAutomations: async (agentId) => agentId === "agent-a" ? [automation] : [] },
    };
    const runtime = new loaded.module.AutomationRuntime(tm);

    const credential = await runtime.getAutomationWebhookCredential("agent-a", "wake-me");
    assert.deepEqual(credential, { agentId: "agent-a", automationId: "wake-me", url: "http://127.0.0.1:12345/webhook/agent-a/wake-me", key });

    const inactiveTm = {
      sessions: { activeSession: null },
      sessionStore: { listAgentAutomations: async (agentId) => agentId === "agent-b" ? [automation] : [] },
    };
    const inactiveRuntime = new loaded.module.AutomationRuntime(inactiveTm);
    assert.deepEqual(await inactiveRuntime.getAutomationWebhookCredential("agent-b", "wake-me"), { agentId: "agent-b", automationId: "wake-me", url: "http://127.0.0.1:12345/webhook/agent-b/wake-me", key });

    const cronAutomation = { ...automation, trigger: { type: "cron", schedule: "0 9 * * *" } };
    const cronTm = { sessions: { activeSession: { id: "agent-a", automations: { get: () => cronAutomation } } }, sessionStore: { listAgentAutomations: async () => [] } };
    assert.equal(await new loaded.module.AutomationRuntime(cronTm).getAutomationWebhookCredential("agent-a", "wake-me"), null);

    const missingTm = { sessions: { activeSession: { id: "agent-a", automations: { get: (id) => id === "wake-me" ? automation : null } } }, sessionStore: { listAgentAutomations: async () => [] } };
    assert.equal(await new loaded.module.AutomationRuntime(missingTm).getAutomationWebhookCredential("agent-a", "no-such"), null);

    await credentialLayer.module.deleteWebhookCredential(routineFolder);
    const keylessTm = { sessions: { activeSession: { id: "agent-a", automations: { get: () => automation } } }, sessionStore: { listAgentAutomations: async () => [] } };
    assert.equal(await new loaded.module.AutomationRuntime(keylessTm).getAutomationWebhookCredential("agent-a", "wake-me"), null, "missing credential file yields null");
  } finally {
    await loaded.dispose();
    await credentialLayer.dispose();
    await rm(sandRoot, { recursive: true, force: true });
  }
});

// Wave 1: 官方 0.59 接收语义的等价修正。每条先红后绿。

/** 最小 host fixture：一个 webhook 例程 + 可控的启停/删除，可直接驱动 runAgentWebhookAutomation 与 fireAutomation。 */
async function webhookHostFixture(t, { isEnabled = true, sandRoot, key = "wave1-key" } = {}) {
  const loaded = await load("wave1-runtime", path.join(root, "source/host/extensions/transcript/automation-runtime.ts"));
  const credentialLayer = await load("wave1-credentials", path.join(root, "source/host/automations/webhook-credentials.ts"));
  const routineFolder = path.join(sandRoot, "agents", "agent-a", "automations", "wake-me");
  await mkdir(routineFolder, { recursive: true });
  await credentialLayer.module.writeWebhookCredential(routineFolder, key, 1234);
  await writeFile(path.join(sandRoot, "settings.json"), JSON.stringify({ version: 1, webhookListenerPort: 17901 }));

  const state = { isEnabled, deleted: false, drops: [], runs: [], firedEvents: [] };
  const record = () => (state.deleted
    ? null
    : { id: "wake-me", name: "Wake me", prompt: "Handle the event.", trigger: { type: "webhook" }, isEnabled: state.isEnabled, schedule: "", filePath: path.join(routineFolder, "automation.json"), createdAt: 1234, lastRunAt: null, runs: state.runs, raisedNotices: [] });
  const automations = {
    get: () => record(),
    listDefinitions: () => (record() == null ? [] : [record()]),
    recordRunDefinition: () => {},
    beginRun: () => ({ id: `run-${state.runs.length + 1}` }),
    finishRunDefinition: () => {},
    markNoticeRaised: () => {},
  };
  const session = {
    id: "agent-a",
    automations,
    db: {
      getUnreadState: () => ({ lastViewedAt: Date.now(), unreadCount: 0 }),
      getAutomationSpendGuardState: () => ({ optedOut: true, cardEntryIds: [], pausedAutomationIds: [] }),
    },
  };
  const tm = {
    execution: { canExecute: true },
    disposed: false,
    sessions: { activeSession: session, resolveBackgroundSession: async () => session },
    groupChat: { isGroupSession: () => false },
    runnerRegistry: { getRunner: () => ({ run: async (prompt) => { state.firedEvents.push(prompt); return { aborted: false, sentMessageCount: 0 }; } }) },
    runLifecycle: {
      beginSessionRun: () => {},
      endSessionRun: () => {},
      lastRequestIdBySession: new Map(),
      enqueueExclusiveRun: async (_id, fn) => { await fn(); },
      getRunQueueDiagnostics: () => [],
    },
    turnRuntime: { activeRequestSources: new Map() },
    sessionStore: { getUserTimeZone: () => "Asia/Shanghai" },
    roster: { emitAgentUpdate: async () => {} },
    telemetry: {
      reportAutomationFireDropped: (value) => state.drops.push(value.reason),
      reportAutomationRun: () => {},
      reportAgentError: () => {},
    },
    shouldEmitAutomations: () => false,
  };
  const runtime = new loaded.module.AutomationRuntime(tm);
  tm.automationRuntime = runtime;
  runtime.enqueueAutomationLifecycleMutation = async ({ mutation }) => { await mutation(); };
  runtime.recordAutomationChangeEvents = () => {};
  runtime.recordInactiveAutomationChanges = () => {};
  t.after(async () => { await loaded.dispose(); await credentialLayer.dispose(); });
  return { runtime, state, key };
}

async function withSandRoot(t, prefix) {
  const sandRoot = await mkdtemp(path.join(root, "node_modules", ".cache", prefix));
  t.after(async () => { await rm(sandRoot, { recursive: true, force: true }); });
  return sandRoot;
}

test("a paused webhook routine answers 409 and never queues the wake", async (t) => {
  const sandRoot = await withSandRoot(t, "wave1-paused-");
  const { runtime, state } = await webhookHostFixture(t, { isEnabled: false, sandRoot });

  const outcome = await runtime.runAgentWebhookAutomation({
    agentId: "agent-a",
    automationId: "wake-me",
    key: "wave1-key",
    payload: { content: "hello while paused" },
  });

  assert.deepEqual(outcome, { ok: false, status: 409, message: "routine is paused" });
  assert.equal(runtime.pendingEventFireBatches.size, 0, "a paused routine must not queue the event");
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.deepEqual(state.firedEvents, [], "the agent must never be woken while paused");
});

test("a paused webhook routine still answers 401 to a caller without the key", async (t) => {
  const sandRoot = await withSandRoot(t, "wave1-paused-badkey-");
  const { runtime } = await webhookHostFixture(t, { isEnabled: false, sandRoot });

  const outcome = await runtime.runAgentWebhookAutomation({
    agentId: "agent-a",
    automationId: "wake-me",
    key: "not-the-key",
    payload: { content: "probe" },
  });

  assert.deepEqual(outcome, { ok: false, status: 401, message: "invalid webhook key" }, "pause state must not be observable without the key");
});

test("webhook data keeps every field the sender posted", async (t) => {
  const sandRoot = await withSandRoot(t, "wave1-data-");
  const { runtime, state } = await webhookHostFixture(t, { sandRoot });

  const outcome = await runtime.runAgentWebhookAutomation({
    agentId: "agent-a",
    automationId: "wake-me",
    key: "wave1-key",
    payload: { source: "feishu-p2p", content: "原文保留", message_id: "om_fixture_data", chat_id: "oc_fixture" },
  });
  assert.equal(outcome.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 900));

  assert.equal(state.firedEvents.length, 1);
  const prompt = state.firedEvents[0];
  const block = prompt.slice(prompt.indexOf("<webhook_event>") + "<webhook_event>".length, prompt.indexOf("</webhook_event>"));
  const event = JSON.parse(block.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  assert.equal(event.source, "webhook");
  assert.deepEqual(event.data, { source: "feishu-p2p", content: "原文保留", message_id: "om_fixture_data", chat_id: "oc_fixture" });
});

test("a wake queued before a pause or delete is dropped at execution time, not run", async (t) => {
  const sandRoot = await withSandRoot(t, "wave1-race-");
  const { runtime, state } = await webhookHostFixture(t, { sandRoot });

  const accepted = await runtime.runAgentWebhookAutomation({
    agentId: "agent-a",
    automationId: "wake-me",
    key: "wave1-key",
    payload: { content: "first" },
  });
  assert.equal(accepted.status, 202);
  state.isEnabled = false;
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.deepEqual(state.firedEvents, [], "a routine paused while the event was queued must not run");
  assert.ok(state.drops.includes("routine_paused_before_run"), `expected a paused-before-run drop, saw ${JSON.stringify(state.drops)}`);

  const deleteRoot = await withSandRoot(t, "wave1-race-delete-");
  const deleted = await webhookHostFixture(t, { sandRoot: deleteRoot });
  assert.equal((await deleted.runtime.runAgentWebhookAutomation({ agentId: "agent-a", automationId: "wake-me", key: "wave1-key", payload: { content: "first" } })).status, 202);
  deleted.state.deleted = true;
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.deepEqual(deleted.state.firedEvents, [], "a routine deleted while the event was queued must not run");
  assert.ok(deleted.state.drops.includes("automation_deleted_before_run"), `expected a deleted-before-run drop, saw ${JSON.stringify(deleted.state.drops)}`);
  void runtime;
});

test("the enqueue guard refuses a disabled routine even when called directly", async (t) => {
  const sandRoot = await withSandRoot(t, "wave1-enqueue-guard-");
  const { runtime, state } = await webhookHostFixture(t, { isEnabled: false, sandRoot });
  const disabled = state.isEnabled ? null : { id: "wake-me", name: "Wake me", prompt: "p", trigger: { type: "webhook" }, isEnabled: false, schedule: "", filePath: path.join(sandRoot, "agents", "agent-a", "automations", "wake-me", "automation.json"), createdAt: 1234, lastRunAt: null, runs: [], raisedNotices: [] };

  const outcome = await runtime.runAutomationForEvent("agent-a", disabled, { source: "webhook", text: "bypassing the 409 path" });
  assert.equal(outcome, undefined, "a direct enqueue of a disabled routine must not resolve a run");
  assert.equal(runtime.pendingEventFireBatches.size, 0, "and must not leave a queued batch behind");
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.deepEqual(state.firedEvents, []);
  assert.ok(state.drops.includes("routine_paused"), `expected a routine_paused drop, saw ${JSON.stringify(state.drops)}`);
});

test("webhook payload normalization pins source and recovers the message body", async (t) => {
  const sandRoot = await withSandRoot(t, "wave1-payload-");
  const { runtime, state } = await webhookHostFixture(t, { sandRoot });

  const outcome = await runtime.runAgentWebhookAutomation({
    agentId: "agent-a",
    automationId: "wake-me",
    key: "wave1-key",
    // The Mac bridge sends its own `source` and puts the body under `content`; neither may be lost.
    payload: { source: "feishu-p2p", content: "今天下午三点开会", message_id: "om_fixture_1", chat_id: "oc_fixture" },
  });
  assert.equal(outcome.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 900));

  assert.equal(state.firedEvents.length, 1);
  const prompt = state.firedEvents[0];
  assert.match(prompt, /<webhook_event>/, "the event must be rendered in the webhook block");
  assert.match(prompt, /今天下午三点开会/, "the message body must reach the agent prompt");
  assert.match(prompt, /om_fixture_1/, "the idempotency key must survive normalization");
  assert.doesNotMatch(prompt, /"source":s*"feishu-p2p"s*}s*$/m);
});

test("credentials are resolved per agent, never by a global routine-id lookup", async (t) => {
  const sandRoot = await withSandRoot(t, "wave1-credentials-");
  const loaded = await load("wave1-runtime-creds", path.join(root, "source/host/extensions/transcript/automation-runtime.ts"));
  const credentialLayer = await load("wave1-credentials-layer", path.join(root, "source/host/automations/webhook-credentials.ts"));
  t.after(async () => { await loaded.dispose(); await credentialLayer.dispose(); });

  const folders = {};
  for (const agentId of ["agent-a", "agent-b"]) {
    folders[agentId] = path.join(sandRoot, "agents", agentId, "automations", "same-routine");
    await mkdir(folders[agentId], { recursive: true });
    await credentialLayer.module.writeWebhookCredential(folders[agentId], `key-${agentId}`, 1234);
  }
  await writeFile(path.join(sandRoot, "settings.json"), JSON.stringify({ version: 1, webhookListenerPort: 17901 }));
  const automation = (agentId) => ({ id: "same-routine", name: "Same", prompt: "p", trigger: { type: "webhook" }, isEnabled: true, schedule: "", filePath: path.join(folders[agentId], "automation.json"), createdAt: 1234, lastRunAt: null, runs: [], raisedNotices: [] });

  function makeTm(activeAgentId) {
    return {
      sessions: {
        activeSession: activeAgentId == null ? null : { id: activeAgentId, automations: { get: (id) => (id === "same-routine" ? automation(activeAgentId) : null) } },
      },
      sessionStore: {
        listAgentAutomations: async (agentId) => [automation(agentId)],
        listAllAutomations: async () => [{ agentId: "agent-a", automation: automation("agent-a") }, { agentId: "agent-b", automation: automation("agent-b") }],
      },
    };
  }

  // An explicitly-scoped lookup returns that agent's own credential, not the first global match.
  assert.deepEqual(await new loaded.module.AutomationRuntime(makeTm("agent-a")).getAutomationWebhookCredential("agent-a", "same-routine"), {
    agentId: "agent-a",
    automationId: "same-routine",
    url: "http://127.0.0.1:17901/webhook/agent-a/same-routine",
    key: "key-agent-a",
  });
  assert.deepEqual(await new loaded.module.AutomationRuntime(makeTm(null)).getAutomationWebhookCredential("agent-b", "same-routine"), {
    agentId: "agent-b",
    automationId: "same-routine",
    url: "http://127.0.0.1:17901/webhook/agent-b/same-routine",
    key: "key-agent-b",
  });
  // The unscoped legacy shape must not silently answer with an arbitrary agent's secret.
  assert.equal(await new loaded.module.AutomationRuntime(makeTm(null)).getAutomationWebhookCredential("same-routine"), null, "an unscoped lookup must refuse instead of guessing");
});

test("a repeated webhook idempotency key does not wake the agent twice", async (t) => {
  const sandRoot = await withSandRoot(t, "wave1-idempotency-");
  const { runtime, state } = await webhookHostFixture(t, { sandRoot });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await runtime.runAgentWebhookAutomation({
      agentId: "agent-a",
      automationId: "wake-me",
      key: "wave1-key",
      payload: { content: "same message", message_id: "om_fixture_dup" },
    });
    assert.equal(outcome.status, 202);
  }
  // The first delivery is already committed; a later redelivery must not wake the agent again.
  await new Promise((resolve) => setTimeout(resolve, 900));
  const afterFirst = state.firedEvents.length;
  assert.equal(afterFirst, 1, "the first delivery wakes the agent once");

  const second = await runtime.runAgentWebhookAutomation({
    agentId: "agent-a",
    automationId: "wake-me",
    key: "wave1-key",
    payload: { content: "same message", message_id: "om_fixture_dup" },
  });
  assert.equal(second.status, 202, "a duplicate delivery is still accepted so the sender does not retry");
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(state.firedEvents.length, afterFirst, "the duplicate delivery must not wake the agent a second time");
});
test("receiver metadata rides into the wake and the header delivery id wins over the body", async (t) => {
  const sandRoot = await withSandRoot(t, "wave5-meta-");
  const { runtime, state } = await webhookHostFixture(t, { sandRoot });

  const outcome = await runtime.runAgentWebhookAutomation({
    agentId: "agent-a",
    automationId: "wake-me",
    key: "wave1-key",
    payload: { content: "deploy finished", message_id: "body-id" },
    deliveryId: "header-id",
    eventName: "deploy.completed",
    contentType: "application/json",
    userAgent: "ci-runner/1.0",
  });
  assert.equal(outcome.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 900));

  assert.equal(state.firedEvents.length, 1);
  const prompt = state.firedEvents[0];
  assert.match(prompt, /deploy finished/, "the message body still reaches the agent");
  assert.match(prompt, /"idempotencyKey": "header-id"/, "the header delivery id outranks the body message_id");
  assert.match(prompt, /"eventName": "deploy.completed"/);
  assert.match(prompt, /"contentType": "application\/json"/);
  assert.match(prompt, /"userAgent": "ci-runner\/1.0"/);
  assert.match(prompt, /"receivedAt":/);
});

test("oversized trigger event payloads are truncated with an explicit marker", async () => {
  const loaded = await load("automation-trigger-trunc", path.join(root, "source/host/automations/automation-trigger.ts"));
  try {
    const block = loaded.module.buildTriggerEventContextBlock({ source: "webhook", text: "x".repeat(60_000) });
    assert.match(block, /\[Payload truncated by Grok Node\]/);
    assert.ok(block.length < 60_000, "the block must stay bounded");
    assert.equal(loaded.module.MAX_TRIGGER_EVENT_CONTEXT_CHARS, 48_000);
  } finally {
    await loaded.dispose();
  }
});

test("webhook idempotency receipts survive a host restart", async (t) => {
  const loaded = await load("event-fires-receipts", path.join(root, "source/host/extensions/transcript/automation-event-fires.ts"));
  const sandRoot = await withSandRoot(t, "wave5-receipts-");
  const routineFolder = path.join(sandRoot, "agents", "agent-a", "automations", "wake-me");
  await mkdir(routineFolder, { recursive: true });
  const automation = {
    id: "wake-me", name: "Wake me", prompt: "p", trigger: { type: "webhook" }, isEnabled: true,
    schedule: "", triggerDescription: "", nextRunAt: null, runs: [], raisedNotices: [],
    createdAt: 1, lastRunAt: null, filePath: path.join(routineFolder, "automation.json"),
  };
  const makeTm = () => ({
    execution: { canExecute: true },
    disposed: false,
    automationRuntime: { fireAutomation: async () => "ok" },
    telemetry: { reportAutomationFireDropped: () => {} },
  });
  try {
    const first = new loaded.module.AutomationEventFires(makeTm());
    const initialRun = first.enqueueEventAutomationFire({ agentId: "agent-a", automation, event: { source: "webhook", text: "hi", idempotencyKey: "mid-restart" } });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const receiptsPath = path.join(routineFolder, "webhook-receipts.json");
    const persisted = JSON.parse(await readFile(receiptsPath, "utf8"));
    assert.equal(persisted.version, 1);
    assert.deepEqual(persisted.receipts.map((entry) => entry.key), ["mid-restart"]);

    const second = new loaded.module.AutomationEventFires(makeTm());
    const duplicate = await second.enqueueEventAutomationFire({ agentId: "agent-a", automation, event: { source: "webhook", text: "hi again", idempotencyKey: "mid-restart" } });
    assert.equal(duplicate, "ok", "a redelivery after restart is accepted without re-waking");
    assert.equal(second.pendingEventFireBatches.size, 0, "no new run may be queued for a remembered delivery");

    assert.equal(await initialRun, "ok");
  } finally {
    await loaded.dispose();
    await rm(sandRoot, { recursive: true, force: true });
  }
});
