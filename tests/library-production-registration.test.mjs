import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(repoRoot, "node_modules/.cache"), { recursive: true });
const temporary = await mkdtemp(path.join(repoRoot, "node_modules/.cache/library-registration-production-"));
test.after(() => rm(temporary, { recursive: true, force: true }));

async function load(entry, name, externalPackages = false) {
  const output = path.join(temporary, `${name}.mjs`);
  await build({
    stdin: entry.startsWith("export ") ? { contents: entry, resolveDir: repoRoot } : undefined,
    entryPoints: entry.startsWith("export ") ? undefined : [path.join(repoRoot, entry)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node26",
    ...(externalPackages
      ? { packages: "external", banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } }
      : { external: ["electron", "undici"] }),
    logLevel: "silent",
  });
  return import(pathToFileURL(output).href);
}

const extension = await load(`export { createLibraryHostService, LIBRARY_MAIN_STORE } from "./source/host/extensions/library/extension.ts";
export { notifyLibraryMcpResult } from "./source/shared/library/mcp-result-hook.ts";`, "extension");
const edge = await load('export { createMainEdgeHandlers } from "./source/electron-main/main-edge.ts";', "edge", true);

const signal = () => AbortSignal.timeout(5000);
function notionRaw() {
  return {
    result: {
      case: "success",
      value: {
        content: [],
        structuredContent: { url: "https://www.notion.so/1234567890abcdef1234567890abcdef" },
      },
    },
  };
}

test("a successful MCP result is registered and retained across restart", async () => {
  const dataRoot = path.join(temporary, "mcp");
  const first = extension.createLibraryHostService({ dataRoot });
  const credential = first.mainCredential();
  first.catalog.identity.assignAgent({ ...first.catalog.identity.resolveCredential(credential, signal()).principal, agentId: "agent-notion" }, true);
  first.runMcpExecution({ credential, agentId: "agent-notion", storeId: extension.LIBRARY_MAIN_STORE, toolCallId: "mcp-call-1", connectorAccount: "notion-owner" }, signal(), () => extension.notifyLibraryMcpResult({
    providerIdentifier: "Notion:notion",
    toolName: "notion-create-pages",
    toolCallId: "mcp-call-1",
    agentId: "agent-notion",
    displayName: "Notion",
    args: { page_id: "1234567890abcdef1234567890abcdef" },
    raw: notionRaw(),
  }));
  extension.notifyLibraryMcpResult({
    providerIdentifier: "Notion:notion",
    toolName: "notion-create-pages",
    toolCallId: "mcp-call-1",
    displayName: "Notion",
    args: { page_id: "1234567890abcdef1234567890abcdef" },
    raw: notionRaw(),
  });
  extension.notifyLibraryMcpResult({
    providerIdentifier: "Notion:notion",
    toolName: "notion-create-pages",
    toolCallId: "mcp-failed",
    agentId: "agent-notion",
    displayName: "Notion",
    args: {},
    raw: { result: { case: "error", value: { error: "failed" } } },
  });
  const listed = await first.listLibraryDocs({ credential, agentId: "agent-notion" }, signal());
  assert.equal(listed.docs.length, 1);
  assert.equal(listed.docs[0].url, "https://www.notion.so/1234567890abcdef1234567890abcdef");
  first.dispose();
  const restarted = extension.createLibraryHostService({ dataRoot });
  const again = await restarted.listLibraryDocs({ credential: restarted.mainCredential(), agentId: "agent-notion" }, signal());
  assert.equal(again.docs.length, 1);
  restarted.dispose();
});

test("the desktop bridge injects the host credential and decodes binary fields", async () => {
  const seen = [];
  const handlers = edge.createMainEdgeHandlers({
    callLibrary: async (method, args) => {
      seen.push({ method, args });
      return { bytes: { $b64: Buffer.from("png").toString("base64") } };
    },
  });
  const result = await handlers.getDocument({
    locator: { storeId: "node-local-store", documentId: "doc-1" },
    credential: "forged",
    principal: { accountId: "other" },
    providerOrigin: "https://evil.example",
  });
  assert.deepEqual(seen, [{
    method: "getDocument",
    args: { locator: { storeId: "node-local-store", documentId: "doc-1" } },
  }]);
  assert.ok(result.bytes instanceof Uint8Array);
  assert.equal(Buffer.from(result.bytes).toString(), "png");
  const closed = edge.createMainEdgeHandlers({});
  await assert.rejects(() => closed.listLibraryPages({ agentId: "a" }), /Library service is not connected/);
});

test("production seams register the native tool and the MCP hook", () => {
  const toolsetSource = readFileSync(path.join(repoRoot, "source/host/runner/tools/turn-toolset.ts"), "utf8");
  assert.match(toolsetSource, /nativeArtifacts: createTurnNativeArtifactToolFactory\(input\.nativeArtifacts\)/);
  assert.match(toolsetSource, /if \(!host\.isSubagentRunner\) \{[\s\S]*?const nativeArtifacts = factories\.nativeArtifacts\?\.\(\);[\s\S]*?tools\.push\(nativeArtifacts\);/);
  const discovery = readFileSync(path.join(repoRoot, "source/shared/node/mcp/tools-discovery.ts"), "utf8");
  const notifyAt = discovery.indexOf("notifyLibraryMcpResult(");
  const instructionsAt = discovery.indexOf("applyCustomInstructionsToMcpResult(");
  assert.ok(notifyAt > 0 && instructionsAt > notifyAt);
  const runner = readFileSync(path.join(repoRoot, "source/host/host-runner-composition.ts"), "utf8");
  assert.match(runner, /createNativeArtifactToolInputs:/);
  const extensions = readFileSync(path.join(repoRoot, "source/host/host-production-extensions.ts"), "utf8");
  assert.match(extensions, /\[HostExtensions\.Library\]:\s*bind\(libraryExtension\)/);
  const orderLine = readFileSync(path.join(repoRoot, "source/host/extensions/registry.ts"), "utf8")
    .split("\n")
    .find((line) => line.includes("HOST_EXTENSION_ORDER"));
  const orderIds = [...orderLine.matchAll(/HostExtensions\.(\w+)/g)].map((match) => match[1]);
  const boundIds = [...extensions.matchAll(/\[HostExtensions\.(\w+)\]:/g)].map((match) => match[1]);
  assert.deepEqual([...orderIds].sort(), [...boundIds].sort());
  assert.equal(new Set(orderIds).size, orderIds.length);
  assert.ok(orderIds.includes("Library"));
  const gateway = readFileSync(path.join(repoRoot, "source/host/host-gateway-api.ts"), "utf8");
  assert.match(gateway, /encodeLibraryJson\(await target/);
  const preload = readFileSync(path.join(repoRoot, "source/electron-preload/preload.ts"), "utf8");
  assert.match(preload, /library:\s*\{[\s\S]*resolveLibraryPages:/);
  assert.doesNotMatch(preload, /library:[\s\S]{0,800}credential/);
});
