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
    assert.deepEqual(forwarded.at(-1), { agentId: "agent-a", automationId: "wake-me", key: "right-key", payload: { text: "hello", extra: 1 } });

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
    const result = loaded.module.SAND_GATEWAY_COMMANDS.runAgentWebhookAutomation(api, JSON.stringify({ agentId: "a", automationId: "b", key: "k", payload: { text: "hi" } }));
    assert.deepEqual(result, { ok: true, status: 200 });
    assert.deepEqual(calls, [{ agentId: "a", automationId: "b", key: "k", payload: { text: "hi" } }]);
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
      sessionStore: { listAllAutomations: async () => [{ agentId: "agent-a", automation }] },
    };
    const runtime = new loaded.module.AutomationRuntime(tm);

    const credential = await runtime.getAutomationWebhookCredential("wake-me");
    assert.deepEqual(credential, { agentId: "agent-a", automationId: "wake-me", url: "http://127.0.0.1:12345/webhook/agent-a/wake-me", key });

    const inactiveTm = {
      sessions: { activeSession: null },
      sessionStore: { listAllAutomations: async () => [{ agentId: "agent-b", automation }] },
    };
    const inactiveRuntime = new loaded.module.AutomationRuntime(inactiveTm);
    assert.deepEqual(await inactiveRuntime.getAutomationWebhookCredential("wake-me"), { agentId: "agent-b", automationId: "wake-me", url: "http://127.0.0.1:12345/webhook/agent-b/wake-me", key });

    const cronAutomation = { ...automation, trigger: { type: "cron", schedule: "0 9 * * *" } };
    const cronTm = { sessions: { activeSession: { id: "agent-a", automations: { get: () => cronAutomation } } }, sessionStore: { listAllAutomations: async () => [] } };
    assert.equal(await new loaded.module.AutomationRuntime(cronTm).getAutomationWebhookCredential("wake-me"), null);

    const missingTm = { sessions: { activeSession: { id: "agent-a", automations: { get: (id) => id === "wake-me" ? automation : null } } }, sessionStore: { listAllAutomations: async () => [] } };
    assert.equal(await new loaded.module.AutomationRuntime(missingTm).getAutomationWebhookCredential("no-such"), null);

    await credentialLayer.module.deleteWebhookCredential(routineFolder);
    const keylessTm = { sessions: { activeSession: { id: "agent-a", automations: { get: () => automation } } }, sessionStore: { listAllAutomations: async () => [] } };
    assert.equal(await new loaded.module.AutomationRuntime(keylessTm).getAutomationWebhookCredential("wake-me"), null, "missing credential file yields null");
  } finally {
    await loaded.dispose();
    await credentialLayer.dispose();
    await rm(sandRoot, { recursive: true, force: true });
  }
});
