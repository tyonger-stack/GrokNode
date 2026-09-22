import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(root, "node_modules", ".cache", "http-mcp-turn-"));
test.after(() => rm(temporary, { recursive: true }));
async function load(entry, name) {
  const outfile = path.join(temporary, name + ".cjs");
  await build({ entryPoints: [path.join(root, entry)], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
  return createRequire(import.meta.url)(outfile);
}

const NOTION_TOOLS = [{ name: "mcp_local_abc123_notion-search", toolName: "notion-search", providerIdentifier: "Notion:notion", clientKey: "Notion:notion", description: "search Notion", inputSchema: { type: "object" } }];
function fakeCore(backendMcpExec) {
  const servers = { "Notion:notion": { url: "https://mcp.notion.com/mcp", type: "http" } };
  return {
    localOnly: true,
    backendMcpExec,
    definitionSource: {
      peekLocalServerNames: () => Object.keys(servers),
      getUserServerConfigs: async () => ({ ...servers }),
      getStdioServerConfigs: async () => ({}),
      getServerUrlForIdentifier: async (id) => servers[id]?.url,
    },
    settingsStore: () => ({ getMcpDisabledToolsByServerId: () => ({}) }),
    lastAccountDisplayConfig: () => null,
  };
}
function connectedBackend(delayMs = 20) {
  return {
    listTools: async (ids) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return ids.map((id) => ({ serverIdentifier: id, rowServerIdentifier: id, accountLabel: "default", status: "connected", tools: id === "Notion:notion" ? NOTION_TOOLS : [] }));
    },
    executeTool: async () => { throw new Error("not under test"); },
  };
}

test("turn start snapshot is empty on a cold cache while the awaited turn path resolves tools", async () => {
  const { createMcpToolsDiscovery } = await load("source/shared/node/mcp/tools-discovery.ts", "turn-discovery");
  const discovery = createMcpToolsDiscovery(fakeCore(connectedBackend()), {});
  const snapshot = await discovery.getToolsForTurnStart(undefined);
  assert.deepEqual(snapshot, []);
  const tools = await discovery.getToolsForTurn(undefined);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].toolName, "notion-search");
  const warmed = await discovery.getToolsForTurnStart(undefined);
  assert.equal(warmed.length, 1);
});

test("awaited turn path degrades instead of hanging when discovery stalls", async () => {
  const { createMcpToolsDiscovery } = await load("source/shared/node/mcp/tools-discovery.ts", "turn-discovery-hang");
  const hanging = { listTools: () => new Promise(() => {}), executeTool: async () => { throw new Error("not under test"); } };
  const discovery = createMcpToolsDiscovery(fakeCore(hanging), {});
  const startedAt = Date.now();
  const tools = await discovery.getToolsForTurn(undefined, 50);
  assert.deepEqual(tools, []);
  assert.ok(Date.now() - startedAt < 5000, "turn discovery must stay bounded");
});

test("awaited turn path degrades instead of throwing when discovery fails", async () => {
  const { createMcpToolsDiscovery } = await load("source/shared/node/mcp/tools-discovery.ts", "turn-discovery-fail");
  const discovery = createMcpToolsDiscovery(fakeCore({ listTools: async () => { throw new Error("connector down"); }, executeTool: async () => { throw new Error("not under test"); } }), {});
  const tools = await discovery.getToolsForTurn(undefined, 50);
  assert.deepEqual(tools, []);
});
