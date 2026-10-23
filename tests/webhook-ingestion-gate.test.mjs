import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const cacheDir = path.join(root, "node_modules", ".cache");
await mkdir(cacheDir, { recursive: true });

const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };

const listenerOut = path.join(cacheDir, "webhook-ingestion-gate-listener.cjs");
await build({ entryPoints: [path.join(root, "source/electron-main/webhook-automation-listener.ts")], bundle: true, platform: "node", format: "cjs", outfile: listenerOut, logLevel: "error", plugins: [jsToTs] });
const listener = createRequire(import.meta.url)(listenerOut);

const hubOut = path.join(cacheDir, "webhook-ingestion-gate-hub.cjs");
await build({ entryPoints: [path.join(root, "source/host/extensions/automations/sand-trigger-hub.ts")], bundle: true, platform: "node", format: "cjs", outfile: hubOut, logLevel: "error", plugins: [jsToTs] });
const hubModule = createRequire(import.meta.url)(hubOut);

const GITHUB_BODY = JSON.stringify({ action: "opened", repository: { full_name: "acme/app" }, sender: { login: "alice" }, pull_request: { title: "Fix", html_url: "u", user: { login: "bob" } } });

function makeForwarder(outcome) {
  const calls = { wake: [], ingest: [] };
  return {
    calls,
    runAgentWebhookAutomation: async (args) => { calls.wake.push(args); return outcome; },
    ingestListenerEvent: async (args) => { calls.ingest.push(args); return { accepted: true }; },
  };
}

async function drive({ url, headers = {}, body = "", method = "POST" }, deps) {
  const rateLimiter = listener.createWebhookRateLimiter();
  const req = new EventEmitter();
  req.url = url; req.method = method; req.headers = headers;
  const captured = { status: undefined, body: undefined, headers: undefined };
  const res = {
    writeHead(status, responseHeaders) { captured.status = status; captured.headers = responseHeaders; return res; },
    end(value) { captured.body = value; return res; },
    destroy() { captured.status = "destroyed"; },
  };
  listener.handleWebhookAutomationRequest(req, res, deps, rateLimiter);
  req.emit("data", Buffer.from(body));
  req.emit("end");
  await new Promise((resolve) => setTimeout(resolve, 10));
  return captured;
}

const githubDelivery = (deliveryId) => ({
  url: "/webhook/agent-a/routine-r/key123",
  headers: { "x-github-event": "pull_request", "x-github-delivery": deliveryId, "content-type": "application/json" },
  body: GITHUB_BODY,
});

test("forward outcome 202 ingests the event, scoped to the route's agentId", async () => {
  listener.resetListenerDeliveryDedupe();
  const forwarder = makeForwarder({ ok: true, status: 202 });
  const captured = await drive(githubDelivery("gate-202"), { forwarder, log: () => {} });
  assert.equal(captured.status, 202);
  assert.equal(forwarder.calls.ingest.length, 1);
  assert.equal(forwarder.calls.ingest[0].agentId, "agent-a", "one routine's key may only feed its own agent");
  assert.equal(forwarder.calls.ingest[0].event.kind, "pr-opened");
  assert.equal(forwarder.calls.ingest[0].deliveryId, "gate-202");
});

test("forward outcome 409 (key verified, routine paused) still ingests", async () => {
  listener.resetListenerDeliveryDedupe();
  const forwarder = makeForwarder({ ok: false, status: 409, message: "routine is paused" });
  await drive(githubDelivery("gate-409"), { forwarder });
  assert.equal(forwarder.calls.ingest.length, 1);
  assert.equal(forwarder.calls.ingest[0].agentId, "agent-a");
});

test("forward outcomes 401 and 404 never verified the key, so nothing is ingested", async () => {
  listener.resetListenerDeliveryDedupe();
  for (const status of [401, 404]) {
    const forwarder = makeForwarder({ ok: false, status, message: "no" });
    const captured = await drive(githubDelivery(`gate-${status}`), { forwarder });
    assert.equal(captured.status, status);
    assert.equal(forwarder.calls.wake.length, 1, "the webhook routine forward still happens");
    assert.equal(forwarder.calls.ingest.length, 0, `status ${status} must not reach the trigger hub`);
  }
});

test("an ok-but-unexpected status (200) does not ingest — the gate is explicit 202/409, not truthiness", async () => {
  listener.resetListenerDeliveryDedupe();
  const forwarder = makeForwarder({ ok: true, status: 200 });
  await drive(githubDelivery("gate-200"), { forwarder });
  assert.equal(forwarder.calls.ingest.length, 0);
});

test("a retried delivery id ingests once even when the platform re-sends it", async () => {
  listener.resetListenerDeliveryDedupe();
  const forwarder = makeForwarder({ ok: true, status: 202 });
  await drive(githubDelivery("dup-1"), { forwarder });
  await drive(githubDelivery("dup-1"), { forwarder });
  assert.equal(forwarder.calls.wake.length, 2);
  assert.equal(forwarder.calls.ingest.length, 1);
});

test("Slack url_verification answers the challenge without waking or ingesting", async () => {
  listener.resetListenerDeliveryDedupe();
  const forwarder = makeForwarder({ ok: true, status: 202 });
  const captured = await drive({
    url: "/webhook/agent-a/routine-r/key123",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "url_verification", challenge: "abc123" }),
  }, { forwarder });
  assert.equal(captured.status, 200);
  assert.deepEqual(JSON.parse(captured.body), { ok: true, challenge: "abc123" });
  assert.equal(forwarder.calls.wake.length, 0);
  assert.equal(forwarder.calls.ingest.length, 0);
});

test("a non-platform payload (no platform shape) never ingests", async () => {
  listener.resetListenerDeliveryDedupe();
  const forwarder = makeForwarder({ ok: true, status: 202 });
  await drive({
    url: "/webhook/agent-a/routine-r/key123",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
  }, { forwarder });
  assert.equal(forwarder.calls.ingest.length, 0);
});

test("the listener binds loopback only and answers /health there", async () => {
  const source = readFileSync(path.join(root, "source/electron-main/webhook-automation-listener.ts"), "utf8");
  assert.match(source, /server\.listen\(port, "127\.0\.0\.1"\)/, "explicit loopback bind is load-bearing");
  const forwarder = makeForwarder({ ok: true, status: 202 });
  const service = listener.startWebhookAutomationListener({ forwarder, port: 0, onBindError: () => {}, log: () => {} });
  try {
    await service.whenReady();
    const port = await service.boundPort();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).service, "grok-node-webhook-automation");
  } finally { service.dispose(); }
});

test("hub.acceptEventForAgent fires only the authenticated agent's automations", async () => {
  const fired = [];
  const hub = new hubModule.SandTriggerHub({
    polling: { start: () => ({ dispose() {} }) },
    sources: [],
    listAutomations: async () => [
      { agentId: "a1", automation: { id: "r1", isEnabled: true, trigger: { type: "github", repo: "acme/app", events: ["pr-opened"] } } },
      { agentId: "a2", automation: { id: "r2", isEnabled: true, trigger: { type: "github", repo: "acme/app", events: ["pr-opened"] } } },
    ],
    fire: async (agentId) => { fired.push(agentId); },
    isReady: () => true,
  });
  const event = { source: "github", repo: "acme/app", kind: "pr-opened", title: "T", actor: "x", timestampMs: 1 };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(hub.acceptEventForAgent("a1", event), true);
  await settle();
  assert.deepEqual(fired, ["a1"], "the other agent's identical trigger must stay asleep");
  assert.equal(hub.acceptEventForAgent("", event), false, "empty agent scope is refused");
  assert.equal(hub.acceptEvent(event), true);
  await settle();
  assert.deepEqual(fired, ["a1", "a1", "a2"], "the global relay path (acceptEvent) still reaches every agent");
});
