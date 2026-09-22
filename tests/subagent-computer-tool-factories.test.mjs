import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundleAndImport(outfileName) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", outfileName);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, "source/host/runner-production-bridge.ts")],
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

const baseToolHost = {
  isSubagentRunner: true,
  isSharedRoomRunner: false,
  isBoxScopedSubagent: false,
  isSystemPromptOverridden: false,
  remoteBoxHasDesktop: true,
  getConversationId: () => "subagent-1",
  getRemoteBoxAvailable: () => true,
  cloudAgentsDisabledByTeam: () => false,
  spotlightEnabled: () => false,
};

test("subagent tool hosts expose computer, screenshot and browser factories", async () => {
  const mod = await bundleAndImport("subagent-computer-tool-factories.mjs");
  const host = mod.createProductionTurnToolsetHost({
    ...baseToolHost,
    turn: { autoReviewModes: { computer: "off" }, subagentConfigs: [] },
    props: { resourceAccessor: { get: () => undefined } },
    factoryProvider: {
      createComputerToolInputs: () => ({ dependencies: {} }),
      createScreenshotToolInputs: () => ({ dependencies: {} }),
      createBrowserToolInputs: () => ({ dependencies: {} }),
    },
    isComputerUseSubagent: true,
    isBrowserUseSubagent: false,
  });
  assert.equal(typeof host.factories.computer, "function");
  assert.equal(typeof host.factories.screenshot, "function");
  assert.equal(typeof host.factories.browser, "function");
  assert.equal(host.isComputerUseSubagent, true);
});

test("desktop factories reach the subagent host regardless of the computer flag", async () => {
  const mod = await bundleAndImport("subagent-computer-tool-factories.mjs");
  const host = mod.createProductionTurnToolsetHost({
    ...baseToolHost,
    turn: { autoReviewModes: { computer: "off" }, subagentConfigs: [] },
    props: { resourceAccessor: { get: () => undefined } },
    factoryProvider: {
      createComputerToolInputs: () => ({ dependencies: {} }),
      createScreenshotToolInputs: () => ({ dependencies: {} }),
    },
    isComputerUseSubagent: false,
    isBrowserUseSubagent: false,
  });
  assert.equal(typeof host.factories.computer, "function");
  assert.equal(typeof host.factories.screenshot, "function");
  assert.equal(host.isComputerUseSubagent, false);
});


test("a lazy subagent tool host still yields computer factories through the per-turn projection", async () => {
  const bridge = await bundleAndImport("subagent-computer-tool-factories.mjs");
  const toolset = await bundleToolset("subagent-toolset-factories.mjs");
  const factoryProvider = {
    createComputerToolInputs: () => ({ dependencies: { marker: "computer" } }),
    createScreenshotToolInputs: () => ({ dependencies: { marker: "screenshot" } }),
    createBrowserToolInputs: () => ({ dependencies: { marker: "browser" } }),
  };
  const lazyHost = bridge.createProductionTurnToolsetHost({
    ...baseToolHost,
    turn: { autoReviewModes: { computer: "off" }, subagentConfigs: [] },
    factoryProvider,
    isComputerUseSubagent: true,
    isBrowserUseSubagent: false,
  });
  assert.deepEqual(lazyHost.factories, {}, "the lazy host carries the provider, not eager factories");
  const props = { resourceAccessor: { get: () => undefined } };
  const factories = toolset.createTurnToolsetFactoriesForTurn(
    lazyHost.factoryProvider,
    { autoReviewModes: { computer: "off" }, subagentConfigs: [] },
    props,
  );
  assert.equal(typeof factories.computer, "function");
  assert.equal(typeof factories.screenshot, "function");
  assert.equal(typeof factories.browser, "function");
  assert.equal(typeof factories.computer, "function", "the computer inputs become a tool factory");
});


async function bundleToolset(outfileName) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", outfileName);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, "source/host/runner/tools/turn-toolset.ts")],
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

