// Contract guard for the private-skills (agent workflow) desktop bridge.
//
// The renderer-side marketplace port already codes against `window.desktop.skills`, so this
// guard protects the three ways that bridge can rot without anything else noticing:
//
//   * a channel that exists on one side only. `createProductionIpcAdapter` throws on a double
//     registration but not on a missing one, and Electron only fails a channel at its first
//     invoke — so a preload method with no handler is a runtime throw, and a handler with no
//     preload method is dead code that still looks wired.
//   * a gateway method or argument shape drifting away from `host-gateway-api.ts`. The names
//     are long and the args are positional, so a rename is silent until the panel is empty.
//   * the failure envelope collapsing. An unreachable host MUST NOT be able to look like "this
//     account has no skills", so the union is checked behaviourally and not just by shape: the
//     unreachable cases are asserted to never reach the network and to never return `records`.
//
// The bearer token is asserted to travel in the Authorization header and to be absent from every
// message the bridge can return, including one the gateway itself echoes back.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const BRIDGE = path.join(root, "source/electron-main/skills/skills-desktop.ts");
const PRELOAD = path.join(root, "source/electron-preload/preload.ts");
const CONTRACT = path.join(root, "source/electron-main/production-ipc-contract.ts");

const read = file => readFile(file, "utf8");
const temporary = await mkdtemp(path.join(root, "node_modules", ".cache", "skills-bridge-"));
test.after(() => rm(temporary, { recursive: true, force: true }));

const outfile = path.join(temporary, "skills-desktop.cjs");
await build({ entryPoints: [BRIDGE], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
const { parseSkillsGatewayConnection, registerSkillsDesktopIpc } = createRequire(import.meta.url)(outfile);

/** Balanced `{ ... }` slice starting at `open`, so formatting changes cannot truncate a block. */
function block(source, open) {
  const start = source.indexOf(open);
  assert.ok(start >= 0, `could not find ${open}`);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") { depth -= 1; if (depth === 0) return source.slice(start, index + 1); }
  }
  throw new Error(`unbalanced block for ${open}`);
}

const bridge = await read(BRIDGE);
const preload = await read(PRELOAD);
const contract = await read(CONTRACT);

const handledChannels = [...bridge.matchAll(/deps\.ipc\.handle\("(sand:skills-[\w-]+)"/g)].map(match => match[1]).sort();
const preloadSkills = block(preload, "\n    skills: {");
const exposedChannels = [...preloadSkills.matchAll(/ipc\.invoke\("(sand:skills-[\w-]+)"/g)].map(match => match[1]).sort();
const declaredChannels = [...block(contract, "ELECTRON_MAIN_INVOKE_IPC_CHANNELS = [")
  .matchAll(/"(sand:skills-[\w-]+)"/g)].map(match => match[1]).sort();

test("every skills channel is declared, handled and exposed, with no one-sided channel", () => {
  assert.deepEqual(handledChannels, ["sand:skills-list", "sand:skills-remove", "sand:skills-update"]);
  assert.deepEqual(exposedChannels, handledChannels,
    "a preload method with no ipcMain handler throws only on its first invoke; a handler with no preload method is dead code");
  assert.deepEqual(declaredChannels, handledChannels,
    "a channel missing from ELECTRON_MAIN_INVOKE_IPC_CHANNELS is registered but not accounted for in the production contract");
});

test("the preload exposes exactly list, update and remove under skills", () => {
  const methods = [...preloadSkills.matchAll(/^\s{6}([A-Za-z][\w]*):/gm)].map(match => match[1]).sort();
  assert.deepEqual(methods, ["list", "remove", "update"]);
});

test("the gateway paths and argument shapes are the host gateway's, asserted literally", () => {
  // Pinned against source/host/host-gateway-api.ts: getAgentWorkflows(id),
  // updateAgentWorkflow(id, workflowId, spec), deleteAgentWorkflow(id, workflowId).
  for (const call of [
    'send(deps, "/api/getAgentWorkflows", { id: agentId }',
    'send(deps, "/api/updateAgentWorkflow", { id: agentId, workflowId, spec }',
    'send(deps, "/api/deleteAgentWorkflow", { id: agentId, workflowId }',
  ]) assert.ok(bridge.includes(call), `the bridge no longer issues \`${call}\``);
});

test("the connection filename comes from the shared constant, never a literal", async () => {
  const { LOCAL_EXEC_DAEMON_CONNECTION_FILENAME } = await read(path.join(root, "source/shared/local-exec-daemon.ts"))
    .then(source => ({ LOCAL_EXEC_DAEMON_CONNECTION_FILENAME: /LOCAL_EXEC_DAEMON_CONNECTION_FILENAME = "([^"]+)"/.exec(source)[1] }));
  assert.equal(LOCAL_EXEC_DAEMON_CONNECTION_FILENAME, "local-exec-daemon-connection.json");
  assert.ok(!bridge.includes(LOCAL_EXEC_DAEMON_CONNECTION_FILENAME),
    "the bridge must read the connection file through LOCAL_EXEC_DAEMON_CONNECTION_FILENAME so a rename cannot silently miss");
  assert.ok(bridge.includes("LOCAL_EXEC_DAEMON_CONNECTION_FILENAME"));
});

test("the bearer token is sent in the header and never reaches a message", () => {
  assert.ok(bridge.includes("redactSandAutoReviewInlineSecrets"), "gateway error bodies are redacted before they are echoed back");
  assert.ok(bridge.includes("redactGatewayDetail"), "the detail redactor is the single place a gateway body becomes a message");
  for (const [, message] of bridge.matchAll(/message: ([^\n]*)/g)) {
    assert.ok(!/token/i.test(message), `a returned message interpolates the token: ${message}`);
  }
  // The one string the token may be spliced into is the Authorization header.
  for (const line of bridge.split("\n")) {
    if (!/`[^`]*\$\{[^}]*token[^}]*\}/.test(line)) continue;
    assert.ok(/authorization/i.test(line), `the token is spliced into a string outside the Authorization header: ${line.trim()}`);
  }
  assert.ok(/authorization: `Bearer \$\{connection\.token\}`/.test(bridge), "the token must travel in the Authorization header");
});

test("the bridge does not filter by source; the record filter belongs to the renderer", () => {
  for (const kind of ['"managed"', '"workflow"', '"automation"']) {
    assert.ok(!bridge.includes(kind), `the bridge must not filter on ${kind}; the renderer owns that filter`);
  }
  assert.ok(!/\.filter\(/.test(bridge), "the bridge must not drop records from the gateway list");
  assert.ok(!/\.source\b/.test(bridge), "the bridge must not read a record's source at all");
});

/** Injected deps with a recording fetch; returns the handler map and the call log. */
function harness(overrides = {}) {
  const handlers = new Map();
  const calls = [];
  const connection = { baseUrl: "http://127.0.0.1:1340", token: "a".repeat(64) };
  const respond = payload => async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, statusText: "OK", text: async () => "", json: async () => payload };
  };
  const deps = {
    ipc: { handle: (channel, handler) => handlers.set(channel, handler) },
    resolveConnection: async () => connection,
    fetch: respond([{ id: "w1", name: "Skill", source: "managed" }, { id: "w2", name: "Auto", source: "automation" }]),
    ...overrides,
  };
  registerSkillsDesktopIpc(deps);
  const invoke = (channel, request) => handlers.get(channel)({}, request);
  return { invoke, calls, connection, handlers };
}

test("records come back raw and unfiltered, and nothing is cached between calls", async () => {
  const { invoke, calls } = harness();
  const first = await invoke("sand:skills-list", { agentId: "agent-1" });
  assert.equal(first.ok, true);
  assert.deepEqual(first.records.map(record => record.source), ["managed", "automation"],
    "every record kind must survive the bridge; the renderer filters");
  assert.equal(calls[0].url, "http://127.0.0.1:1340/api/getAgentWorkflows");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers["content-type"], "application/json");
  assert.equal(calls[0].headers.authorization, `Bearer ${"a".repeat(64)}`);
  assert.deepEqual(calls[0].body, { id: "agent-1" });

  await invoke("sand:skills-list", { agentId: "agent-1" });
  assert.equal(calls.length, 2, "responses must not be cached");
});

test("update and remove send the host gateway's argument shapes", async () => {
  const { invoke, calls } = harness();
  const spec = { name: "Renamed", description: "d", body: "b", trigger: { schedule: "0 9 * * *", isEnabled: true } };
  assert.equal((await invoke("sand:skills-update", { agentId: "agent-1", workflowId: "w1", spec })).ok, true);
  assert.equal(calls[0].url, "http://127.0.0.1:1340/api/updateAgentWorkflow");
  assert.deepEqual(calls[0].body, { id: "agent-1", workflowId: "w1", spec });

  assert.equal((await invoke("sand:skills-remove", { agentId: "agent-1", workflowId: "w1" })).ok, true);
  assert.equal(calls[1].url, "http://127.0.0.1:1340/api/deleteAgentWorkflow");
  assert.deepEqual(calls[1].body, { id: "agent-1", workflowId: "w1" });

  const nullTrigger = { name: "No trigger", description: "", body: "b", trigger: null };
  assert.equal((await invoke("sand:skills-update", { agentId: "a", workflowId: "w1", spec: nullTrigger })).ok, true);
  assert.deepEqual(calls[2].body, { id: "a", workflowId: "w1", spec: nullTrigger });
});

test("an unresolvable host is gateway-unreachable and never reaches the network", async () => {
  for (const [label, resolveConnection] of [
    ["null connection", async () => null],
    ["resolver throws", async () => { throw new Error("no such file"); }],
  ]) {
    let reached = 0;
    const { invoke } = harness({ resolveConnection, fetch: async () => { reached += 1; throw new Error("must not be called"); } });
    const result = await invoke("sand:skills-list", { agentId: "agent-1" });
    assert.equal(result.ok, false, `${label} must not look like an empty skill list`);
    assert.equal(result.error.code, "gateway-unreachable", label);
    assert.equal("records" in result, false, `${label} must not carry records`);
    assert.equal(reached, 0, label);
  }
});

test("a dead port is gateway-unreachable too, and still not an empty list", async () => {
  const { invoke } = harness({
    fetch: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); },
  });
  const result = await invoke("sand:skills-list", { agentId: "agent-1" });
  assert.equal(result.ok, false, "an unreachable host must not look like an empty skill list");
  assert.equal(result.error.code, "gateway-unreachable");
  assert.equal("records" in result, false);
  assert.ok(!result.error.message.includes("ECONNREFUSED"), "the transport detail is not part of the product contract");
});

test("a hanging gateway times out as gateway-unreachable", async () => {
  const { invoke } = harness({
    timeoutMs: 5,
    fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
  });
  const result = await invoke("sand:skills-list", { agentId: "agent-1" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "gateway-unreachable");
  assert.match(result.error.message, /did not answer/);
});

test("blank identifiers and a malformed spec are bad-request with no network call", async () => {
  let reached = 0;
  const { invoke } = harness({ fetch: async () => { reached += 1; throw new Error("must not be called"); } });
  const bad = [
    ["sand:skills-list", { agentId: "" }],
    ["sand:skills-list", { agentId: "   " }],
    ["sand:skills-list", {}],
    ["sand:skills-update", { agentId: "a", workflowId: "", spec: { name: "n", description: "", body: "b", trigger: null } }],
    ["sand:skills-remove", { agentId: "", workflowId: "w1" }],
    ["sand:skills-remove", { agentId: "a" }],
    ["sand:skills-update", { agentId: "a", workflowId: "w1", spec: { name: "n" } }],
    ["sand:skills-update", { agentId: "a", workflowId: "w1", spec: { name: "n", description: "", body: "b", trigger: { schedule: 5 } } }],
  ];
  for (const [channel, request] of bad) {
    const result = await invoke(channel, request);
    assert.equal(result.ok, false, `${channel} ${JSON.stringify(request)}`);
    assert.equal(result.error.code, "bad-request", `${channel} ${JSON.stringify(request)}`);
  }
  assert.equal(reached, 0, "bad-request must be decided before any socket is opened");
});

test("a refused command, a 5xx and a broken payload are distinguished from an empty list", async () => {
  const failing = status => async () => ({ ok: false, status, statusText: "Boom", text: async () => "denied", json: async () => { throw new Error("unused"); } });
  for (const [status, code] of [[400, "gateway-command-failed"], [404, "gateway-command-failed"], [500, "gateway-unreachable"], [503, "gateway-unreachable"]]) {
    const { invoke } = harness({ fetch: failing(status) });
    const result = await invoke("sand:skills-remove", { agentId: "a", workflowId: "w1" });
    assert.equal(result.error.code, code, `HTTP ${status}`);
    assert.equal("records" in result, false);
  }

  const notAList = harness({ fetch: async () => ({ ok: true, status: 200, statusText: "OK", text: async () => "", json: async () => ({ error: "nope" }) }) });
  const broken = await notAList.invoke("sand:skills-list", { agentId: "a" });
  assert.equal(broken.ok, false, "a non-array payload is a broken command, not zero skills");
  assert.equal(broken.error.code, "gateway-command-failed");
});

test("a token echoed back by the gateway is redacted out of the message", async () => {
  const token = "b".repeat(64);
  const { invoke } = harness({
    resolveConnection: async () => ({ baseUrl: "http://127.0.0.1:1340", token }),
    fetch: async () => ({ ok: false, status: 400, statusText: "Bad", text: async () => `rejected: authorization: Bearer ${token}`, json: async () => ({}) }),
  });
  const result = await invoke("sand:skills-list", { agentId: "a" });
  assert.equal(result.error.code, "gateway-command-failed");
  assert.ok(!result.error.message.includes(token), `the token leaked into the message: ${result.error.message}`);
});

test("the connection file shape is validated, and the token never survives parsing into a message", () => {
  assert.deepEqual(parseSkillsGatewayConnection(JSON.stringify({ baseUrl: "http://127.0.0.1:1340/", token: "t0ken" })),
    { baseUrl: "http://127.0.0.1:1340", token: "t0ken" });
  for (const raw of [
    "not json",
    JSON.stringify({ token: "t" }),
    JSON.stringify({ baseUrl: "http://127.0.0.1:1340" }),
    JSON.stringify({ baseUrl: "http://127.0.0.1:1340", token: "" }),
    JSON.stringify({ baseUrl: "127.0.0.1:1340", token: "t" }),
    JSON.stringify({ data: "sealed", sandSealedFile: true }),
  ]) assert.equal(parseSkillsGatewayConnection(raw), null, raw);
});
