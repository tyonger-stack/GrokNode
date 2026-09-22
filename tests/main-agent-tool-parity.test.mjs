import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundleAndImport(entryPoints, outfileName) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", outfileName);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints,
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    packages: "external",
    banner: { js: "import { createRequire as __cr } from \"node:module\"; const require = __cr(import.meta.url);" },
    plugins: [{
      name: "js-to-ts",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
          const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
          if (!candidate.startsWith(repoRoot + "/source")) return null;
          return existsSync(candidate) ? { path: candidate } : null;
        });
      }
    }]
  });
  return import(pathToFileURL(outfile).href);
}

const CURSOR_ROUTE_TOOLS = [
  "SendMessage",
  "ReactToMessage",
  "update_state",
  "Shell",
  "Read",
  "ExternalShell",
  "ExternalRead",
  "Task",
  "TodoWrite",
  "SendToAgent",
  "CreateAgent",
  "UpdateAgent",
  "AwaitShell",
  "ExternalAwaitShell",
  "WebSearch",
  "WebFetch",
  "SearchPlugins",
  "GetPlugin",
  "InstallPlugin",
  "AddMcpServer",
  "UninstallMcpServer",
  "UninstallPlugin",
  "GetMcpServerStatus",
  "SetMcpInstructions",
  "RestartMcpServers",
  "AuthenticateMcpServer",
  "RemoveMcpAccount",
  "RenameMcpAccount",
];

const autoReviewModes = {
  hostShell: "off",
  boxShell: "off",
  mcp: "off",
  computer: "off",
  automationWrite: "off",
  cloudAgent: "off",
  subagentLaunch: "off",
};

const noop = async () => ({});
const stubTool = (name) => ({ name, description: name, parameters: { type: "object" }, execute: noop });

function mainAgentHost(factories) {
  return {
    isSubagentRunner: false,
    isSharedRoomRunner: false,
    isBoxScopedSubagent: false,
    isComputerUseSubagent: false,
    isBrowserUseSubagent: false,
    isSystemPromptOverridden: false,
    remoteBoxHasDesktop: true,
    getConversationId: () => "agent-test",
    getRemoteBoxAvailable: () => true,
    cloudAgentsDisabledByTeam: () => false,
    spotlightEnabled: () => false,
    isMultitaskEnabled: () => true,
    factories,
  };
}

test("the main agent toolset matches the cursor route tool list on every inference provider", async () => {
  const { buildTurnTools } = await bundleAndImport(
    [path.join(repoRoot, "source/host/runner/tools/turn-toolset.ts")],
    "main-agent-tool-parity.mjs",
  );
  const { builtinSubagentConfigs } = await bundleAndImport(
    [path.join(repoRoot, "source/host/runner/tools/sand-computer-use-subagent.ts")],
    "main-agent-tool-parity-subagents.mjs",
  );
  const factories = {
    sendMessage: () => stubTool("SendMessage"),
    sendToAgent: () => stubTool("SendToAgent"),
    reaction: () => stubTool("ReactToMessage"),
    createAgent: () => stubTool("CreateAgent"),
    updateAgent: () => stubTool("UpdateAgent"),
    updateState: () => stubTool("update_state"),
    externalShell: () => stubTool("ExternalShell"),
    externalRead: () => stubTool("ExternalRead"),
    externalAwait: () => stubTool("ExternalAwaitShell"),
    webSearch: () => stubTool("WebSearch"),
    webFetch: () => stubTool("WebFetch"),
    boxShell: () => stubTool("Shell"),
    boxRead: () => stubTool("Read"),
    boxAwait: () => stubTool("AwaitShell"),
    multitask: () => stubTool("TodoWrite"),
    mcpMeta: () => [
      "SearchPlugins", "GetPlugin", "InstallPlugin", "AddMcpServer", "UninstallMcpServer",
      "UninstallPlugin", "GetMcpServerStatus", "SetMcpInstructions", "RestartMcpServers",
      "AuthenticateMcpServer", "RemoveMcpAccount", "RenameMcpAccount",
    ].map(stubTool),
  };
  const props = {
    resourceAccessor: { get: () => undefined },
    stateHandler: {},
    parentModelInfo: {},
    toolSession: {},
    config: {},
    summarizationHandler: {},
    subagentModels: [],
    mcp: {},
  };
  const tools = buildTurnTools(
    mainAgentHost(factories),
    { autoReviewModes, subagentConfigs: builtinSubagentConfigs(true) },
    props,
  ).getAllTools();
  const names = tools.map((tool) => tool.name).sort();
  const expected = [...CURSOR_ROUTE_TOOLS].sort();
  assert.deepEqual(names, expected);
});

test("a desktop-capable main agent also offers Screenshot, which the cursor route gates on the box desktop", async () => {
  const { buildTurnTools } = await bundleAndImport(
    [path.join(repoRoot, "source/host/runner/tools/turn-toolset.ts")],
    "main-agent-tool-parity.mjs",
  );
  const factories = {
    sendMessage: () => stubTool("SendMessage"),
    screenshot: () => stubTool("Screenshot"),
  };
  const tools = buildTurnTools(mainAgentHost(factories), { autoReviewModes }, { resourceAccessor: { get: () => undefined } }).getAllTools();
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes("Screenshot"));
});

