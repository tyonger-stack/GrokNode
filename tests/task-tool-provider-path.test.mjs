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

function providerWithTaskInputs(turnInputs) {
  return {
    ...(turnInputs === undefined
      ? {}
      : {
          createTaskToolInputs: turn => ({
            resourceAccessor: turnInputs.resourceAccessor,
            stateHandler: turnInputs.stateHandler,
            parentModelInfo: turnInputs.parentModelInfo,
            getTaskToolConfig: async () => ({
              agentConfig: { toolsGenerator: () => ({}) },
              promptSession: turnInputs.toolSession,
              summarizationHandler: turnInputs.summarizationHandler,
            }),
            subagentConfigs: turn.subagentConfigs ?? [],
            options: { subagentModels: turnInputs.subagentModels },
          }),
        }),
  };
}

test("the turn toolset provider supplies a Task factory that offers computerUse and browserUse", async () => {
  const { createTurnToolsetFactoriesForTurn } = await bundleAndImport([toolsetModule], "task-toolset-probe.mjs");
  const { builtinSubagentConfigs } = await bundleAndImport([subagentModule], "subagent-configs-probe.mjs");
  const turnInputs = {
    resourceAccessor: {},
    stateHandler: {},
    parentModelInfo: {},
    toolSession: {},
    config: {},
    summarizationHandler: {},
    subagentModels: [],
  };
  const turn = { autoReviewModes, subagentConfigs: builtinSubagentConfigs(true) };
  const factories = createTurnToolsetFactoriesForTurn(providerWithTaskInputs(turnInputs), turn, turnInputs);
  assert.ok(factories.task !== undefined, "provider must supply a Task factory");
  const tool = factories.task();
  assert.equal(tool.name, "Task");
  const schema = JSON.stringify(tool.parameters ?? tool.inputSchema ?? {});
  assert.ok(schema.includes("computerUse"), "Task schema must offer computerUse");
  assert.ok(schema.includes("browserUse"), "Task schema must offer browserUse");
});

test("a provider without Task inputs yields no Task factory (regression guard)", async () => {
  const { createTurnToolsetFactoriesForTurn } = await bundleAndImport([toolsetModule], "task-toolset-probe.mjs");
  const turn = { autoReviewModes, subagentConfigs: [] };
  const factories = createTurnToolsetFactoriesForTurn(providerWithTaskInputs(undefined), turn, {});
  assert.equal(factories.task, undefined);
});

