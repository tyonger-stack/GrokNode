import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let cached;

async function loadModule() {
  if (cached != null) return cached;
  const dir = await mkdtemp(path.join(tmpdir(), "grok-subagent-"));
  const outfile = path.join(dir, "subagent.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/host/runner/tools/sand-computer-use-subagent.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    plugins: [{ name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\..*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return existsSync(candidate) ? { path: candidate } : null; }); } }]
  });
  cached = await import(pathToFileURL(outfile).href);
  return cached;
}

function subagentTypeName(config) {
  return config.subagent_type.type.value.name;
}

test("builtin subagent configs offer computerUse and browserUse when the box is available", async () => {
  const { builtinSubagentConfigs } = await loadModule();
  const configs = builtinSubagentConfigs(true);
  assert.deepEqual(configs.map(subagentTypeName), ["computerUse", "browserUse"]);
  for (const config of configs) {
    assert.equal(config.subagentSource, "builtin");
    assert.equal(config.preserveTaskTool, false);
    assert.ok(config.description.length > 0);
  }
});

test("builtin subagent configs are empty when the box is unavailable", async () => {
  const { builtinSubagentConfigs } = await loadModule();
  assert.deepEqual(builtinSubagentConfigs(false), []);
});

test("computerUse subagent type normalizes to the dispatch name the runner matches", async () => {
  const { builtinSubagentConfigs, isComputerUseSubagentType } = await loadModule();
  const [computerUse] = builtinSubagentConfigs(true);
  assert.equal(isComputerUseSubagentType(subagentTypeName(computerUse)), true);
  assert.equal(isComputerUseSubagentType("computer-use"), true);
  assert.equal(isComputerUseSubagentType("computer_use"), true);
  assert.equal(isComputerUseSubagentType("browserUse"), false);
});
