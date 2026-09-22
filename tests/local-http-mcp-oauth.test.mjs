import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { startLocalHttpMcpFixture } from "./fixtures/local-http-mcp-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(root, "node_modules", ".cache", "http-mcp-oauth-"));
test.after(() => rm(temporary, { recursive: true }));
const outfile = path.join(temporary, "exec.cjs");
await build({ entryPoints: [path.join(root, "source/shared/node/mcp/local-http-exec.ts")], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
const { LocalHttpMcpExec } = createRequire(import.meta.url)(outfile);

async function load(entry, name) {
  const file = path.join(temporary, name + ".cjs");
  await build({ entryPoints: [path.join(root, entry)], outfile: file, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
  return createRequire(import.meta.url)(file);
}

test("HTTP MCP completes PKCE OAuth, discovers all pages, executes and refreshes without Cursor", async () => {
  const fixture = await startLocalHttpMcpFixture();
  const credentialDirectory = path.join(temporary, "credentials");
  const options = { getServers: () => ({ Fixture: { url: fixture.url } }), credentialDirectory };
  let runtime = new LocalHttpMcpExec(options);
  try {
    const [initial] = await runtime.listTools(["Fixture"]);
    assert.equal(initial.status, "needsAuth");
    assert.equal(fixture.counts.registrations, 0, "listing must not register an OAuth client");
    const pending = await runtime.checkAuthStatus({ serverId: "1", accountKey: "default" });
    assert.equal(pending.requiresAuth, true);
    const authorization = new URL(pending.authUrl);
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    const approved = await fetch(authorization, { redirect: "manual" });
    const callback = new URL(approved.headers.get("location"));
    await assert.rejects(() => runtime.completeOAuth({ stateId: "wrong-state", code: callback.searchParams.get("code") }), /unknown/);
    await runtime.completeOAuth({ stateId: callback.searchParams.get("state"), code: callback.searchParams.get("code") });
    await assert.rejects(() => runtime.completeOAuth({ stateId: callback.searchParams.get("state"), code: callback.searchParams.get("code") }), /already completed/);
    const [connected] = await runtime.listTools(["Fixture"]);
    assert.equal(connected.status, "connected");
    assert.deepEqual(connected.tools.map(tool => tool.toolName), ["read_first", "read_second"]);
    const result = await runtime.executeTool({ serverIdentifier: "Fixture", toolName: "read_first", args: {} });
    assert.equal(result.result.value.content[0].content.value.text, "local HTTP executed read_first");
    assert.deepEqual(result.result.value.structuredContent.toJson(), { ok: true });
    assert.equal(fixture.counts.calls, 1);
    await runtime.dispose(); runtime = new LocalHttpMcpExec(options);
    fixture.expire();
    assert.equal((await runtime.listTools(["Fixture"]))[0].status, "connected");
    assert.equal(fixture.counts.refreshes, 1, "restarting preserves the refresh token");
    assert.equal((await stat(credentialDirectory)).mode & 0o777, 0o700);
    for (const name of await readdir(credentialDirectory)) assert.equal((await stat(path.join(credentialDirectory, name))).mode & 0o777, 0o600);
    await runtime.logoutAccount({ serverUrl: fixture.url, accountKey: "default" });
    assert.equal((await runtime.listTools(["Fixture"]))[0].status, "needsAuth");
  } finally { await runtime.dispose(); await fixture.close(); }
});

test("changing the server URL invalidates an in-flight OAuth callback", async () => {
  const fixture = await startLocalHttpMcpFixture();
  let servers = { Fixture: { url: fixture.url } };
  const runtime = new LocalHttpMcpExec({ getServers: () => servers, credentialDirectory: path.join(temporary, "changed-server") });
  try {
    const pending = await runtime.checkAuthStatus({ serverId: "1", accountKey: "default" });
    const approved = await fetch(pending.authUrl, { redirect: "manual" }), callback = new URL(approved.headers.get("location"));
    servers = { Fixture: { url: fixture.url + "-different" } };
    await assert.rejects(() => runtime.completeOAuth({ stateId: callback.searchParams.get("state"), code: callback.searchParams.get("code") }), /connector changed/);
    assert.equal(fixture.counts.exchanges, 0);
  } finally { await runtime.dispose(); await fixture.close(); }
});

test("Plugins Authenticate uses the desktop callback and local VM tool execution", async () => {
  const { SandSettingsStore } = await load("source/shared/node/settings/sand-settings-store.ts", "desktop-settings");
  const { createSandDesktopMcpManager } = await load("source/electron-main/mcp/desktop-mcp-manager.ts", "desktop-manager");
  const { registerMcpDesktopIpc } = await load("source/electron-main/mcp/mcp-desktop.ts", "desktop-ipc");
  const { createSandMcpOAuthLoopback } = await load("source/shared/node/mcp/mcp-oauth-loopback.ts", "loopback");
  const fixture = await startLocalHttpMcpFixture();
  const settings = new SandSettingsStore(path.join(temporary, "desktop-settings.json"));
  settings.setLocalMcpServers({ Fixture: { url: fixture.url } });
  const runtime = new LocalHttpMcpExec({ getServers: () => settings.getLocalMcpServers(), credentialDirectory: path.join(temporary, "desktop-credentials") });
  const manager = await createSandDesktopMcpManager({ settingsStore: settings, localHttpRequest: request => runtime.control(request), onAccountScopeApplied() {}, getAccessToken() { throw new Error("No Cursor account allowed"); }, getMachineId: () => "test", listBoxMcpServers: async () => [], onConnectorAuth() {} });
  const callbacks = new Map();
  const loopback = createSandMcpOAuthLoopback({ completeOAuth: args => runtime.completeOAuth(args), log() {} });
  const ipc = registerMcpDesktopIpc({ ipc: { handle: (name, handler) => callbacks.set(name, handler) }, shell: { openExternal: async () => {} }, parseAllowedExternalUrl: value => value, createOAuthLoopback: async () => loopback, getManager: async () => ({ ...manager, getCatalog: async () => [] }), peekAccessToken: async () => null, fetchTeamPopularity: async () => new Map(), refreshMcp: async () => {}, syncHostSettings: async () => ({}), settings, wait: async () => {}, onEdgeFailure: failure => assert.fail(JSON.stringify(failure)) });
  try {
    assert.equal((await callbacks.get("sand:mcp-list")()).servers[0].status, "needsAuth");
    const auth = await callbacks.get("sand:mcp-auth")({}, { serverId: "1", accountKey: "default", trigger: "connector_card" });
    assert.equal(auth.status, "started");
    const response = await fetch(auth.authorizationUrl);
    assert.equal(response.status, 200, "the browser must reach the desktop OAuth success page");
    await response.text();
    assert.equal((await callbacks.get("sand:mcp-list")()).servers[0].status, "connected");
    const tools = await manager.listRoutedTools();
    assert.equal(tools.length, 2);
    const result = await manager.executeRoutedTool({ ...tools[0], args: {}, toolCallId: "local-http-ui-test" });
    assert.equal(result.result.value.content[0].content.value.text, "local HTTP executed read_first");
    assert.equal(fixture.counts.calls, 1);
    await manager.toggleMcpToolDisabled({ serverId: "1", toolName: "read_first" });
    const blocked = await manager.executeRoutedTool({ ...tools[0], args: {}, toolCallId: "blocked-local-http-ui-test" });
    assert.equal(blocked.result.case, "error");
    assert.equal(fixture.counts.calls, 1, "disabled tools must never reach the HTTP service");
    await manager.removeServer("1");
    assert.equal((await runtime.credentials.read(fixture.url, "default")).tokens, undefined, "removing a connector must clear its account token");
  } finally { ipc.disposeLoopback(); await loopback.dispose(); await manager.dispose(); await runtime.dispose(); await fixture.close(); }
});
