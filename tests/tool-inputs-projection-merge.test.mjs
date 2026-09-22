import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridgeModule = path.join(repoRoot, "source/host/runner-production-bridge.ts");

async function loadBridge() {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "projection-merge-probe.mjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [bridgeModule],
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

test("tool input projections merge the turn toolset factory provider into props", async () => {
  const { createProductionTurnToolInputs } = await loadBridge();
  const provider = {
    createTaskToolInputs: turn => ({
      resourceAccessor: {},
      stateHandler: {},
      parentModelInfo: {},
      getTaskToolConfig: async () => ({ agentConfig: {}, promptSession: undefined, summarizationHandler: undefined }),
      subagentConfigs: turn.subagentConfigs ?? [],
      options: {},
    }),
  };
  const input = {
    resourceAccessor: {},
    stateHandler: {},
    parentModelInfo: {},
    toolSession: {},
    config: {},
    summarizationHandler: {},
    subagentModels: [],
  };
  const props = createProductionTurnToolInputs(input, { turnToolsetFactoryProvider: provider });
  assert.ok(props.turnToolsetFactoryProvider !== undefined, "props must carry the turn toolset factory provider");
  assert.equal(typeof props.turnToolsetFactoryProvider.createTaskToolInputs, "function");
  const taskInputs = props.turnToolsetFactoryProvider.createTaskToolInputs({ subagentConfigs: ["computerUse", "browserUse"] });
  assert.deepEqual(taskInputs.subagentConfigs, ["computerUse", "browserUse"]);
});

