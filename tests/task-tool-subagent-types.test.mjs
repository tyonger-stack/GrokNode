import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const toolsetModule = path.join(repoRoot, "source/host/runner/tools/turn-toolset.ts");
const subagentModule = path.join(repoRoot, "source/host/runner/tools/sand-computer-use-subagent.ts");

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

const autoReviewModes = {
  hostShell: "off",
  boxShell: "off",
  mcp: "off",
  computer: "off",
  automationWrite: "off",
  cloudAgent: "off",
  subagentLaunch: "off"
};

const host = {
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
  factories: {}
};

const props = {
  resourceAccessor: {},
  stateHandler: {},
  parentModelInfo: {},
  toolSession: {},
  config: {},
  summarizationHandler: {}
};

test("Task tool exposes computerUse and browserUse dispatch types when the box is available", async () => {
  const { buildTurnTools } = await bundleAndImport([toolsetModule], "task-toolset-probe.mjs");
  const { builtinSubagentConfigs } = await bundleAndImport([subagentModule], "subagent-configs-probe.mjs");
  const tools = buildTurnTools(host, { autoReviewModes, subagentConfigs: builtinSubagentConfigs(true) }, props).getAllTools();
  const task = tools.find((tool) => tool.name === "Task");
  assert.ok(task !== undefined, "Task tool must be registered");
  const schema = JSON.stringify(task.parameters ?? task.inputSchema ?? {});
  assert.ok(schema.includes("computerUse"), "Task schema must offer computerUse");
  assert.ok(schema.includes("browserUse"), "Task schema must offer browserUse");
});

test("an empty subagent config list leaves Task without computerUse (regression guard)", async () => {
  const { buildTurnTools } = await bundleAndImport([toolsetModule], "task-toolset-probe.mjs");
  const tools = buildTurnTools(host, { autoReviewModes, subagentConfigs: [] }, props).getAllTools();
  const task = tools.find((tool) => tool.name === "Task");
  assert.ok(task !== undefined, "Task tool must still be registered");
  const schema = JSON.stringify(task.parameters ?? task.inputSchema ?? {});
  assert.equal(schema.includes("computerUse"), false);
});


test("a computerUse subagent toolset offers Computer when the host supplies the factory", async () => {
  const { buildTurnTools } = await bundleAndImport([toolsetModule], "task-toolset-probe.mjs");
  const { builtinSubagentConfigs } = await bundleAndImport([subagentModule], "subagent-configs-probe.mjs");
  const desktopHost = {
    ...host,
    isSubagentRunner: true,
    isComputerUseSubagent: true,
    factories: {
      computer: () => ({ name: "Computer", description: "drive the box desktop", parameters: { type: "object" }, execute: async () => ({}) }),
      screenshot: () => ({ name: "Screenshot", description: "capture the box desktop", parameters: { type: "object" }, execute: async () => ({}) }),
    },
  };
  const tools = buildTurnTools(desktopHost, { autoReviewModes, subagentConfigs: builtinSubagentConfigs(true) }, props).getAllTools();
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes("Computer"), "computerUse subagent must receive the Computer tool");
  assert.equal(names.includes("Screenshot"), false, "the standalone Screenshot tool stays with the main agent");
});

test("a browserUse subagent toolset offers the browser tools when the host supplies the factory", async () => {
  const { buildTurnTools } = await bundleAndImport([toolsetModule], "task-toolset-probe.mjs");
  const { builtinSubagentConfigs } = await bundleAndImport([subagentModule], "subagent-configs-probe.mjs");
  const desktopHost = {
    ...host,
    isSubagentRunner: true,
    isComputerUseSubagent: false,
    isBrowserUseSubagent: true,
    factories: {
      browser: () => [{ name: "BrowserNavigate", description: "navigate", parameters: { type: "object" }, execute: async () => ({}) }],
    },
  };
  const tools = buildTurnTools(desktopHost, { autoReviewModes, subagentConfigs: builtinSubagentConfigs(true) }, props).getAllTools();
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes("BrowserNavigate"), "browserUse subagent must receive the browser tools");
  assert.equal(names.includes("Computer"), false, "Computer stays reserved for computerUse subagents");
});

test("the main agent toolset offers the standalone Screenshot tool when the host supplies the factory", async () => {
  const { buildTurnTools } = await bundleAndImport([toolsetModule], "task-toolset-probe.mjs");
  const desktopHost = {
    ...host,
    isSubagentRunner: false,
    factories: {
      computer: () => ({ name: "Computer", description: "drive the box desktop", parameters: { type: "object" }, execute: async () => ({}) }),
      screenshot: () => ({ name: "Screenshot", description: "capture the box desktop", parameters: { type: "object" }, execute: async () => ({}) }),
    },
  };
  const tools = buildTurnTools(desktopHost, { autoReviewModes, subagentConfigs: [] }, props).getAllTools();
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes("Screenshot"), "the main agent must receive the standalone Screenshot tool");
  assert.equal(names.includes("Computer"), false, "Computer stays reserved for computerUse subagents");
});

test("a non-computer subagent toolset stays without the Computer tool (regression guard)", async () => {
  const { buildTurnTools } = await bundleAndImport([toolsetModule], "task-toolset-probe.mjs");
  const { builtinSubagentConfigs } = await bundleAndImport([subagentModule], "subagent-configs-probe.mjs");
  const desktopHost = {
    ...host,
    isSubagentRunner: true,
    isComputerUseSubagent: false,
    factories: {
      computer: () => ({ name: "Computer", description: "drive the box desktop", parameters: { type: "object" }, execute: async () => ({}) }),
      screenshot: () => ({ name: "Screenshot", description: "capture the box desktop", parameters: { type: "object" }, execute: async () => ({}) }),
    },
  };
  const tools = buildTurnTools(desktopHost, { autoReviewModes, subagentConfigs: builtinSubagentConfigs(true) }, props).getAllTools();
  const names = tools.map((tool) => tool.name);
  assert.equal(names.includes("Computer"), false);
  assert.equal(names.includes("Screenshot"), false);
});

