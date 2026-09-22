import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

async function bundle(entryPoint, temporary, name) {
  const outfile = path.join(temporary, name + ".cjs");
  await build({ entryPoints: [path.join(root, entryPoint)], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
  return createRequire(import.meta.url)(outfile);
}

test("local MCP settings retain valid server configs and discard invalid entries", async () => {
  const temporary = await mkdtemp(path.join(root, "node_modules", ".cache", "local-mcp-settings-"));
  try {
    const { SandSettingsStore } = await bundle("source/shared/node/settings/sand-settings-store.ts", temporary, "settings");
    await writeFile(path.join(temporary, "settings.json"), JSON.stringify({
      version: 1,
      localMcpServers: {
        filesystem: { command: " npx ", args: ["-y", "@modelcontextprotocol/server-filesystem"], env: { ROOT: "/workspace" } },
        invalid: { command: 42 },
        "bad/name": { command: "echo" },
      },
    }));
    const store = new SandSettingsStore(path.join(temporary, "settings.json"));
    assert.deepEqual(store.getLocalMcpServers(), {
      filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], env: { ROOT: "/workspace" } },
    });
  } finally { await rm(temporary, { recursive: true }); }
});

test("local plugin Add imports public MCP configuration without a Cursor account writer", async () => {
  const temporary = await mkdtemp(path.join(root, "node_modules", ".cache", "local-mcp-plugin-"));
  const previousFetch = globalThis.fetch;
  try {
    const { SandSettingsStore } = await bundle("source/shared/node/settings/sand-settings-store.ts", temporary, "settings");
    const { SandMcpCatalogFlow } = await bundle("source/shared/node/mcp/mcp-catalog-flow.ts", temporary, "catalog");
    const store = new SandSettingsStore(path.join(temporary, "settings.json"));
    globalThis.fetch = async () => new Response(JSON.stringify({ mcpServers: { local: { command: "echo", args: ["\${TOKEN}"] } } }), { status: 200 });
    const flow = new SandMcpCatalogFlow({
      localOnly: true,
      getMachineId: async () => "local-test",
      requireAccountWriter: () => { throw new Error("Cursor writer must not be used"); },
      getLocalMcpServers: () => store.getLocalMcpServers(),
      setLocalMcpServers: (servers) => store.setLocalMcpServers(servers),
      reloadServers: async () => store.getLocalMcpServers(),
      fetchMarketplace: async () => ({ includesPrivateMarketplaces: false, plugins: [{ pluginId: "1", name: "local", displayName: "Local Test", description: "", category: "MCP", logoUrl: undefined, homepage: undefined, sourceUrls: ["https://github.com/example/repo/blob/main/mcp.json"], connectors: [], skills: [], variableFields: [{ key: "TOKEN", label: "Token", placeholder: "TOKEN", isRequired: false, isSecret: true }] }] }),
    });
    await flow.getCatalog(null);
    await flow.installEntry({ entryId: "1", values: { TOKEN: "fixture" } }, null);
    assert.deepEqual(store.getLocalMcpServers(), { "Local Test:local": { command: "echo", args: ["fixture"] } });
  } finally { globalThis.fetch = previousFetch; await rm(temporary, { recursive: true }); }
});

test("local MCP manager reads, adds, and removes servers without an account writer", async () => {
  const temporary = await mkdtemp(path.join(root, "node_modules", ".cache", "local-mcp-manager-"));
  try {
    const { SandSettingsStore } = await bundle("source/shared/node/settings/sand-settings-store.ts", temporary, "settings");
    const { SandMcpManager } = await bundle("source/shared/node/mcp/mcp-manager.ts", temporary, "manager");
    const store = new SandSettingsStore(path.join(temporary, "settings.json"));
    store.setLocalMcpServers({ filesystem: { command: "echo" } });
    const manager = new SandMcpManager({
      localOnly: true,
      settingsStore: store,
      backendMcpExec: { listTools: async () => [], executeTool: async () => ({}) },
      getMachineId: async () => "local-test",
    });
    const initial = await manager.listServers();
    assert.equal(initial.servers.length, 1);
    assert.equal(initial.servers[0].name, "filesystem");
    const added = await manager.addServer({ name: "memory", configJson: JSON.stringify({ command: "echo" }) });
    assert.equal(added.servers.length, 2);
    const removed = await manager.removeServer("1");
    assert.equal(removed.removed, true);
    assert.deepEqual(Object.keys(store.getLocalMcpServers()), ["memory"]);
    await manager.dispose();
  } finally { await rm(temporary, { recursive: true }); }
});
