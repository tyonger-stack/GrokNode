import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadExperimentService() {
  const directory = await mkdtemp(path.join(tmpdir(), "exp-unknown-cfg-"));
  after(() => rm(directory, { recursive: true, force: true }));
  const stub = path.join(directory, "statsig-stub.mjs");
  await writeFile(
    stub,
    'export const LogEventCompressionMode = { Forced: "Forced" };\nexport class StatsigClient {}\n',
  );
  const outfile = path.join(directory, "cursor-experiments.mjs");
  await build({
    entryPoints: [path.join(root, "source/shared/node/experiments/cursor-experiments.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    alias: { "@statsig/js-client": stub },
  });
  return import(pathToFileURL(outfile).href);
}

test("getDynamicConfig returns {} for names missing from DYNAMIC_CONFIGS", async () => {
  const mod = await loadExperimentService();
  const cache = await mkdtemp(path.join(tmpdir(), "exp-cache-"));
  after(() => rm(cache, { recursive: true, force: true }));
  const service = new mod.SandExperimentService({
    getAccessToken: async () => "",
    getMachineId: async () => "test-machine",
    getCacheDir: () => cache,
    isDevBuild: true,
  });
  const value = service.getDynamicConfig("grok_bot_loop_detection");
  assert.deepEqual(value, {});
  assert.equal(value.mode, undefined);
});

test("getExperiment returns {} for names missing from EXPERIMENTS", async () => {
  const mod = await loadExperimentService();
  const cache = await mkdtemp(path.join(tmpdir(), "exp-cache-"));
  after(() => rm(cache, { recursive: true, force: true }));
  const service = new mod.SandExperimentService({
    getAccessToken: async () => "",
    getMachineId: async () => "test-machine",
    getCacheDir: () => cache,
    isDevBuild: true,
  });
  assert.deepEqual(service.getExperiment("definitely_not_a_real_experiment"), {});
});

test("unknown dynamic config no longer throws the production TypeError shape", async () => {
  const mod = await loadExperimentService();
  const cache = await mkdtemp(path.join(tmpdir(), "exp-cache-"));
  after(() => rm(cache, { recursive: true, force: true }));
  const service = new mod.SandExperimentService({
    getAccessToken: async () => "",
    getMachineId: async () => "test-machine",
    getCacheDir: () => cache,
    isDevBuild: true,
  });
  assert.doesNotThrow(() => service.getDynamicConfig("grok_bot_loop_detection"));
});
