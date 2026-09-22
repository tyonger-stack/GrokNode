import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(out) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", out);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, "source/host/runner/agent-adapters.ts")],
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

function makeAdapter(allocated) {
  const sessions = new Map();
  const dispatcher = {
    isRunning: () => false,
    allocateComputerUseWindow: (id) => { allocated.push(id); return { index: 1 }; },
    freeComputerUseWindow: () => {},
    dispatch: () => {},
  };
  return new (class {})() && { sessions, dispatcher };
}

test("browserUse subagents are allocated a desktop window like computerUse", async () => {
  const mod = await load("subagent-window-allocation.mjs");
  const allocated = [];
  const adapter = new mod.SandSubagentHostAdapter(
    new Map(),
    (id) => ({ run: async () => ({ text: "", aborted: false }) }),
    {
      isRunning: () => false,
      allocateComputerUseWindow: (id) => { allocated.push(id); return { index: 1 }; },
      freeComputerUseWindow: () => {},
      dispatch: () => {},
    },
  );
  await adapter.createOrResumeSession({}, { subagentType: "browserUse", toolCallId: "c1", prompt: "open example.com" });
  assert.equal(allocated.length, 1, "browserUse must allocate a window");
  assert.ok(allocated[0].startsWith("subagent-"), "the window is keyed by the subagent id");
});

test("computerUse subagents still allocate a window", async () => {
  const mod = await load("subagent-window-allocation.mjs");
  const allocated = [];
  const adapter = new mod.SandSubagentHostAdapter(
    new Map(),
    (id) => ({ run: async () => ({ text: "", aborted: false }) }),
    {
      isRunning: () => false,
      allocateComputerUseWindow: (id) => { allocated.push(id); return { index: 1 }; },
      freeComputerUseWindow: () => {},
      dispatch: () => {},
    },
  );
  await adapter.createOrResumeSession({}, { subagentType: "computerUse", toolCallId: "c2", prompt: "click" });
  assert.equal(allocated.length, 1, "computerUse must allocate a window");
});

test("general subagents do not allocate a desktop window", async () => {
  const mod = await load("subagent-window-allocation.mjs");
  const allocated = [];
  const adapter = new mod.SandSubagentHostAdapter(
    new Map(),
    (id) => ({ run: async () => ({ text: "", aborted: false }) }),
    {
      isRunning: () => false,
      allocateComputerUseWindow: (id) => { allocated.push(id); return { index: 1 }; },
      freeComputerUseWindow: () => {},
      dispatch: () => {},
    },
  );
  await adapter.createOrResumeSession({}, { subagentType: "generalPurpose", toolCallId: "c3", prompt: "research" });
  assert.equal(allocated.length, 0, "a plain subagent must not take a desktop window");
});

