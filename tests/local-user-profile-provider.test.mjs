import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bundleServerPort } from "./server-port-bundle.mjs";

const m = await bundleServerPort(["host/extensions/memory/production", "host/extensions/memory/extension", "host/extensions/memory/local-user-profile", "host/extensions/inference/inference-service", "host/extensions/session/agent-db", "shared/node/settings/sand-settings-store", "host/runner/memory-context", "host/runner/system-prompt-assembly", "host/host-diagnostics"]);

test("production local profile uses configured HTTP inference with no Cursor credentials and is injected after restart", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "profile-provider-"));
  const keys = ["SAND_DATA_ROOT", "SAND_OPENROUTER_MODEL", "OPENROUTER_API_KEY", "SAND_AGENT_MOCK_RESPONSE"];
  const environment = new Map(keys.map(key => [key, process.env[key]]));
  const nativeFetch = globalThis.fetch;
  const requests = [];
  const reports = [];
  const stops = [];
  const preference = "Always run focused tests before announcing that my task is complete.";
  const server = createServer(async (request, reply) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      requests.push(payload);
      const evidence = JSON.parse(payload.messages.find(message => message.role === "user").content);
      const result = evidence.claims === undefined
        ? { claims: [{ section: "workstyle", text: "The user requires focused tests before completion reports.", sources: evidence.conversations.map(conversation => ({ conversationId: conversation.id, messageId: "u1", quote: preference })) }] }
        : { verdicts: evidence.claims.map(claim => ({ id: claim.id, decision: "accept", basis: "explicit_instruction", supportedSources: [0, 1, 2, 3], lastingScope: { sourceIndex: 0, quote: preference }, reason: "Each full user message directly states the lasting instruction." })) };
      reply.writeHead(200, { "content-type": "text/event-stream" });
      reply.write(`data: ${JSON.stringify({ id: "profile-response", object: "chat.completion.chunk", created: 1, model: payload.model, choices: [{ index: 0, delta: { role: "assistant", content: JSON.stringify(result) }, finish_reason: null }] })}\n\n`);
      reply.write(`data: ${JSON.stringify({ id: "profile-response", object: "chat.completion.chunk", created: 1, model: payload.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } })}\n\n`);
      reply.end("data: [DONE]\n\n");
    } catch (error) {
      reply.writeHead(500);
      reply.end(String(error));
    }
  });
  t.after(async () => {
    stops.forEach(stop => stop());
    m.pinHostDiagnosticsReporter(null);
    globalThis.fetch = nativeFetch;
    for (const [key, value] of environment) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.ok(url.startsWith(origin + "/"), `unexpected network destination: ${new URL(url).origin}`);
    return nativeFetch(input, init);
  };
  process.env.SAND_DATA_ROOT = dir;
  process.env.SAND_OPENROUTER_MODEL = "local-profile-fixture";
  process.env.OPENROUTER_API_KEY = "fixture-only";
  delete process.env.SAND_AGENT_MOCK_RESPONSE;
  const settings = new m.SandSettingsStore(path.join(dir, "settings.json"));
  settings.setInferenceProvider("openrouter");
  settings.setOpenRouterBaseUrl(origin + "/v1");
  for (let index = 0; index < 4; index++) {
    const db = new m.SandAgentDb(path.join(dir, "agents", `human-${index}`, "store.db"));
    db.appendTranscriptEntry({ id: "u1", kind: "message", role: "user", content: preference, timestampMs: 100 + index });
    db.close();
  }
  const forbiddenCloud = new Proxy({}, { get(_target, key) { throw new Error(`Cursor dependency accessed: ${String(key)}`); } });
  const inference = m.createHostInference({ auth: forbiddenCloud, experiments: forbiddenCloud, settings, onModelExperimentApplied() {} });
  m.pinHostDiagnosticsReporter(event => reports.push(event));
  const deps = { inference: { port: inference }, experiments: { pinGateOnAuthenticatedBootstrap() {} }, telemetry: forbiddenCloud };
  const extras = m.createMemoryProductionExtras({ deps });
  const userProfile = extras.createUserProfile();
  m.memoryExtension.start({ ...extras, deps, createUserProfile: () => userProfile, onStop: callback => stops.push(callback) });
  assert.equal(await userProfile.refresh(), "updated");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, "local-profile-fixture");
  assert.ok(requests[0].messages.some(message => message.content.includes("GROK_NODE_LOCAL_USER_PROFILE")));
  assert.ok(!requests[0].tools?.length);
  assert.ok(requests[1].messages.some(message => message.content.includes('LOCAL_USER_PROFILE_VERIFY')));
  assert.ok(!requests[1].tools?.length);
  const saved = await readFile(m.localUserProfilePath(dir), "utf8");
  assert.match(saved, /focused tests/);
  const memory = m.createRunnerMemoryContext({ agentId: "fresh-bot", dbPath: path.join(dir, "agents", "fresh-bot", "store.db"), sandRoot: dir, store: null, snapshots: null, resolveAgentName: id => id });
  const assembly = m.createSystemPromptAssembly({ ...memory, basePrompt: "base", isSubagentRunner: false, isSharedRoomRunner: false, isSystemPromptOverridden: false,
    agentProfileProvider: () => null, agentStore: () => null, compactionEpoch: () => 0, isBoxScopedSubagent: () => false,
    requestContext: { resolve: () => ({ timeZone: "UTC" }) }, automationStore: () => null, workflowStore: () => null, channelStore: () => null,
    connectorManifests: [], mcpManagement: () => null, mcpCustomInstructionsSection: () => null, mcpDiscoveryStatusSection: () => null,
    remoteBoxSection: () => "", computerSection: () => null, isSpotlightEnabled: () => false,
  });
  assert.match(assembly.getSystemPrompt(), /<user_profile>[\s\S]*focused tests/);
  const restarted = extras.createUserProfile();
  stops.push(() => restarted.dispose());
  assert.equal(await restarted.refresh(), "unchanged");
  assert.equal(requests.length, 2);
  assert.ok(reports.some(event => event.kind === "local_user_profile" && event.outcome === "updated"));
});
