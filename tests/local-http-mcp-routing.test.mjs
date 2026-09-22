import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(root, "node_modules", ".cache", "http-mcp-routing-"));
test.after(() => rm(temporary, { recursive: true }));
async function load(entry, name) {
  const outfile = path.join(temporary, name + ".cjs");
  await build({ entryPoints: [path.join(root, entry)], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
  return createRequire(import.meta.url)(outfile);
}

test("local HTTP status comes from the local HTTP executor, with authentication preserved", async () => {
  const { SandSettingsStore } = await load("source/shared/node/settings/sand-settings-store.ts", "store");
  const { SandMcpManager } = await load("source/shared/node/mcp/mcp-manager.ts", "manager");
  const store = new SandSettingsStore(path.join(temporary, "settings.json"));
  store.setLocalMcpServers({ Notion: { url: "https://mcp.notion.com/mcp" } });
  const manager = new SandMcpManager({ localOnly: true, settingsStore: store,
    backendMcpExec: { listTools: async (ids) => ids.map(id => ({ serverIdentifier: id, rowServerIdentifier: id, accountLabel: "default", status: "needsAuth", tools: [] })) },
    effectivePluginsProvider: () => { throw new Error("Cursor must not be contacted"); }
  });
  try {
    const state = await manager.listServers();
    assert.equal(state.servers[0].status, "needsAuth");
    assert.equal(state.servers[0].statusDetail, "Authentication required");
    assert.deepEqual(await manager.listEffectivePlugins(), []);
  } finally { await manager.dispose(); }
});

test("host settings retain and expose the desktop local MCP configuration", async () => {
  const { SettingsService } = await load("source/host/extensions/settings/settings-service.ts", "settings-service");
  const settings = new SettingsService(path.join(temporary, "host-settings.json"));
  const servers = { Notion: { url: "https://mcp.notion.com/mcp" } };
  settings.setHostSettings({ localMcpServers: servers });
  assert.deepEqual(settings.getLocalMcpServers(), servers);
});

test("Gmail Add requests a user-owned OAuth client and never persists its secret in settings", async () => {
  const { SandMcpCatalogFlow } = await load("source/shared/node/mcp/mcp-catalog-flow.ts", "gmail-catalog");
  const oldFetch = globalThis.fetch;
  let servers = {}, configured;
  const gmailUrl = "https://gmailmcp.googleapis.com/mcp/v1";
  const plugin = { pluginId: "1", name: "gmail", displayName: "Gmail", description: "Mail", category: "MCP", sourceUrls: ["https://github.com/example/repo/blob/main/mcp.json"], connectors: [], skills: [], variableFields: [] };
  const flow = new SandMcpCatalogFlow({ localOnly: true, getMachineId: () => "test", requireAccountWriter() { throw new Error("No Cursor account allowed"); }, getLocalMcpServers: () => servers, setLocalMcpServers: value => { servers = value; }, configureLocalOAuth: async value => { configured = value; }, reloadServers: async () => servers, fetchMarketplace: async () => ({ plugins: [plugin], includesPrivateMarketplaces: false }) });
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ mcpServers: { gmail: { url: gmailUrl } } }));
    const [view] = await flow.getCatalog(null);
    assert.deepEqual(view.fields.map(field => [field.key, field.isSecret, field.isRequired]), [["GOOGLE_CLIENT_ID", false, true], ["GOOGLE_CLIENT_SECRET", true, true]]);
    await assert.rejects(() => flow.installEntry({ entryId: "1" }, null), /needs a value/);
    await flow.installEntry({ entryId: "1", values: { GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret" } }, null);
    assert.deepEqual(servers, { "Gmail:gmail": { url: gmailUrl } });
    assert.deepEqual(configured, { serverUrl: gmailUrl, clientId: "fixture-client", clientSecret: "fixture-secret" });
  } finally { globalThis.fetch = oldFetch; }
});
