import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(entry, out) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", out);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, entry)],
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
  subagentLaunch: "off",
};

const stub = (name) => ({ name, description: name, parameters: { type: "object" }, execute: async () => ({}) });

test("a browserUse subagent receives the browser tools through the per-turn projection", async () => {
  const toolset = await load("source/host/runner/tools/turn-toolset.ts", "browser-chain-toolset.mjs");
  const sub = await load("source/host/runner/tools/sand-browser-use-subagent.ts", "browser-chain-sub.mjs");
  assert.equal(sub.isBrowserUseSubagentType("browserUse"), true);
  const factoryProvider = {
    createBrowserToolInputs: () => ({
      dependencies: {
        resourceAccessor: {},
        getWindowIndex: async () => 1,
        getBoxId: () => "subagent-1",
        getDefaultViewId: () => "subagent-1",
        executeShell: { execute: async () => ({}) },
      },
    }),
    createWebSearchToolInputs: () => ({ dependencies: {} }),
    createWebFetchToolInputs: () => ({ dependencies: {} }),
  };
  const host = {
    isSubagentRunner: true,
    isSharedRoomRunner: false,
    isBoxScopedSubagent: false,
    isComputerUseSubagent: false,
    isBrowserUseSubagent: true,
    isSystemPromptOverridden: false,
    remoteBoxHasDesktop: true,
    getConversationId: () => "subagent-1",
    getRemoteBoxAvailable: () => true,
    cloudAgentsDisabledByTeam: () => false,
    spotlightEnabled: () => false,
    isMultitaskEnabled: () => false,
    factoryProvider,
    factories: {},
  };
  const props = { resourceAccessor: { get: () => undefined } };
  const turn = { autoReviewModes, subagentConfigs: [] };
  const factories = toolset.createTurnToolsetFactoriesForTurn(host.factoryProvider, turn, props);
  console.log("factory keys:", Object.keys(factories));
  assert.equal(typeof factories.browser, "function", "the provider must yield a browser factory");
  const projected = { ...host, factories: { ...host.factories, ...factories } };
  const tools = toolset.buildTurnTools(projected, turn, props).getAllTools();
  const names = tools.map((t) => t.name);
  console.log("offered:", names);
  assert.ok(names.includes("browser_navigate"), "browserUse subagent must receive browser_navigate");
});

