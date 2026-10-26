// Google Calendar local connector: own-client OAuth requirement, official scopes, and the
// account-label lifecycle (添加其他账户 / 重命名 / 移除) on top of the single storage slot.
//
// Evidence anchors:
// - Official 0.75.8 electron-main main-app.cjs hosted-Google map: calendarmcp.googleapis.com
//   carries scopes [calendar.events, calendar.calendarlist.readonly, calendar.events.readonly,
//   calendar.events.freebusy] and authorizationParams {access_type:"offline", prompt:"select_account consent"}.
// - Official renderer 添加其他账户 wiring: onAddAccount: u => authenticate(u.serverId, u.label)
//   (0.18 view chunk, plugins-detail__add-account block).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { startLocalHttpMcpFixture } from "./fixtures/local-http-mcp-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(root, "node_modules", ".cache", "http-mcp-calendar-"));
test.after(() => rm(temporary, { recursive: true }));
async function load(entry, name) {
  const outfile = path.join(temporary, name + ".cjs");
  await build({ entryPoints: [path.join(root, entry)], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
  return createRequire(import.meta.url)(outfile);
}

test("Google Calendar pins the official connector scopes", async () => {
  const { CALENDAR_MCP_URL, CALENDAR_MCP_SCOPES } = await load("source/shared/node/mcp/local-http-calendar.ts", "calendar-const");
  assert.equal(CALENDAR_MCP_URL, "https://calendarmcp.googleapis.com/mcp/v1");
  assert.deepEqual(CALENDAR_MCP_SCOPES, [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
    "https://www.googleapis.com/auth/calendar.events.freebusy",
  ]);
});

test("Google Calendar Add requests the user's own OAuth client and configures it locally", async () => {
  const { SandMcpCatalogFlow } = await load("source/shared/node/mcp/mcp-catalog-flow.ts", "calendar-catalog");
  const oldFetch = globalThis.fetch;
  let servers = {}, configured;
  const calendarUrl = "https://calendarmcp.googleapis.com/mcp/v1";
  const plugin = { pluginId: "7", name: "google-calendar", displayName: "Google Calendar", description: "Calendar", category: "MCP", sourceUrls: ["https://github.com/example/repo/blob/main/mcp.json"], connectors: [], skills: [], variableFields: [] };
  const flow = new SandMcpCatalogFlow({ localOnly: true, getMachineId: () => "test", requireAccountWriter() { throw new Error("No Cursor account allowed"); }, getLocalMcpServers: () => servers, setLocalMcpServers: value => { servers = value; }, configureLocalOAuth: async value => { configured = value; }, reloadServers: async () => servers, fetchMarketplace: async () => ({ plugins: [plugin], includesPrivateMarketplaces: false }) });
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ mcpServers: { "google-calendar": { url: calendarUrl, type: "http" } } }));
    const view = (await flow.getCatalog(null)).find(candidate => candidate.id === "7");
    assert.ok(view, "the google-calendar view is in the catalog");
    assert.equal(view.name, "google-calendar");
    assert.deepEqual(view.fields.map(field => [field.key, field.isSecret, field.isRequired]), [["GOOGLE_CLIENT_ID", false, true], ["GOOGLE_CLIENT_SECRET", true, true]]);
    await assert.rejects(() => flow.installEntry({ entryId: "7" }, null), /needs a value/);
    await flow.installEntry({ entryId: "7", values: { GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret" } }, null);
    assert.deepEqual(servers, { "Google Calendar:google-calendar": { url: calendarUrl, type: "http" } });
    assert.deepEqual(configured, { serverUrl: calendarUrl, clientId: "fixture-client", clientSecret: "fixture-secret" });
  } finally { globalThis.fetch = oldFetch; }
});

test("account labels ride the single slot: connect as label, rename, and remove resets to default", async () => {
  const { LocalHttpMcpExec } = await load("source/shared/node/mcp/local-http-exec.ts", "calendar-exec");
  const fixture = await startLocalHttpMcpFixture();
  const runtime = new LocalHttpMcpExec({ getServers: () => ({ Fixture: { url: fixture.url } }), credentialDirectory: path.join(temporary, "labels") });
  try {
    // 添加其他账户 = authenticate(serverId, label): the label is stored before OAuth runs.
    const pending = await runtime.checkAuthStatus({ serverId: "1", accountKey: "生活" });
    assert.equal(pending.requiresAuth, true);
    const approved = await fetch(pending.authUrl, { redirect: "manual" });
    const callback = new URL(approved.headers.get("location"));
    await runtime.completeOAuth({ stateId: callback.searchParams.get("state"), code: callback.searchParams.get("code") });
    const [connected] = await runtime.listTools(["Fixture"]);
    assert.equal(connected.accountLabel, "生活");
    assert.equal(connected.status, "connected");

    // The label is display-only: any account key resolves the same stored token.
    assert.equal((await runtime.validateTokens([{ serverUrl: fixture.url, accountKey: "生活" }]))[0].hasValidToken, true);

    // 重命名 only rewrites the label.
    await runtime.renameAccount({ serverId: "1", accountKey: "生活", newAccountKey: "工作" });
    assert.equal((await runtime.listTools(["Fixture"]))[0].accountLabel, "工作");
    assert.equal((await runtime.validateTokens([{ serverUrl: fixture.url, accountKey: "工作" }]))[0].hasValidToken, true);

    // 移除 <account> 账户 clears both tokens and label: the row falls back to the default slot.
    await runtime.deleteAccount({ serverId: "1", accountKey: "工作" });
    const [removed] = await runtime.listTools(["Fixture"]);
    assert.equal(removed.accountLabel, "default");
    assert.equal(removed.status, "needsAuth");

    // The desktop proxy path forwards rename through the same control surface.
    await runtime.control({ operation: "rename", serverId: "1", accountKey: "default", newAccountKey: "proxy-label" });
    assert.equal((await runtime.listTools(["Fixture"]))[0].accountLabel, "proxy-label");
  } finally { await runtime.dispose(); await fixture.close(); }
});

test("configure accepts the Google Calendar URL and rejects unlisted servers", async () => {
  const { LocalHttpMcpExec } = await load("source/shared/node/mcp/local-http-exec.ts", "calendar-exec-configure");
  const runtime = new LocalHttpMcpExec({ getServers: () => ({ "Google Calendar:google-calendar": { url: "https://calendarmcp.googleapis.com/mcp/v1", type: "http" } }), credentialDirectory: path.join(temporary, "configure") });
  try {
    await runtime.control({ operation: "configure", serverUrl: "https://calendarmcp.googleapis.com/mcp/v1", clientId: "id.apps.googleusercontent.com", clientSecret: "GOCSPX-x" });
    await assert.rejects(() => runtime.control({ operation: "configure", serverUrl: "https://example.com/mcp", clientId: "id", clientSecret: "secret" }), /Invalid/);
    // The calendar OAuth provider reports the missing-client error with its own connector name.
    const { LocalHttpOAuth } = await load("source/shared/node/mcp/local-http-oauth.ts", "calendar-oauth");
    const { LocalHttpCredentials } = await load("source/shared/node/mcp/local-http-credentials.ts", "calendar-credentials");
    const credentials = new LocalHttpCredentials(path.join(temporary, "configure-empty"));
    const provider = new LocalHttpOAuth({ serverUrl: "https://calendarmcp.googleapis.com/mcp/v1", credentials, interactive: true });
    await assert.rejects(() => provider.clientInformation(), /Google Calendar requires your registered Google OAuth client/);
  } finally { await runtime.dispose(); }
});

test("Google hosted MCP 403-with-valid-result responses are surfaced as 200", async () => {
  const { localMcpFetch } = await load("source/shared/node/mcp/local-http-client.ts", "client-shim");
  const makeResponse = (status, body) => new Response(body, { status, headers: { "Content-Type": "application/json" } });
  // 403 whose body is a JSON-RPC result → repaired to 200 (Google calendarmcp behavior, 2026-10-25).
  const repaired = await localMcpFetch(new Request("https://calendarmcp.googleapis.com/mcp/v1", { method: "POST" }), { method: "POST" });
  void makeResponse;
  // Drive the shim through real Response objects by stubbing global fetch.
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => makeResponse(403, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }));
    const ok = await localMcpFetch(new Request("https://calendarmcp.googleapis.com/mcp/v1", { method: "POST" }), { method: "POST" });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).result.tools.length, 0);
    // A JSON-RPC ERROR body keeps its 403.
    globalThis.fetch = async () => makeResponse(403, JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "denied" } }));
    const kept = await localMcpFetch(new Request("https://calendarmcp.googleapis.com/mcp/v1", { method: "POST" }), { method: "POST" });
    assert.equal(kept.status, 403);
    // Non-googleapis hosts are never rewritten.
    globalThis.fetch = async () => makeResponse(403, JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    const untouched = await localMcpFetch(new Request("https://mcp.example.com/mcp", { method: "POST" }), { method: "POST" });
    assert.equal(untouched.status, 403);
    // Malformed 403 bodies pass through.
    globalThis.fetch = async () => makeResponse(403, "not-json");
    const malformed = await localMcpFetch(new Request("https://calendarmcp.googleapis.com/mcp/v1", { method: "POST" }), { method: "POST" });
    assert.equal(malformed.status, 403);
  } finally { globalThis.fetch = originalFetch; }
  void repaired;
});
