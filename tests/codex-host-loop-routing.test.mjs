import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-codex-host-loop-"));
  const output = path.join(temporary, "inference-router.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(pathToFileURL(output).href + "?" + Date.now());
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

async function routerFor(module, provider) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "grok-codex-route-" + provider + "-"));
  await writeFile(path.join(dataDir, "settings.json"), JSON.stringify({ version: 1, inferenceProvider: provider }));
  const router = module.createCoordinatorInferenceRouter({
    dataDir,
    postEvent: () => {},
    dispatchRemote: async () => ({}),
  });
  return { router, dataDir, dispose: () => rm(dataDir, { recursive: true, force: true }) };
}

async function waitForSettled(dataDir) {
  const target = path.join(dataDir, "inference-router-transcript.json");
  for (let i = 0; i < 100 && !existsSync(target); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
}

test("codex sendPrompt is not intercepted so turns run on the host agent loop", async () => {
  const loaded = await loadModule();
  try {
    const ctx = await routerFor(loaded.module, "codex");
    try {
      const routed = await ctx.router.dispatch("sendPrompt", { agentId: "agent", prompt: "hi", clientNonce: "nonce" });
      assert.deepEqual(routed, { handled: false });
    } finally {
      await ctx.dispose();
    }
  } finally {
    await loaded.dispose();
  }
});

test("legacy cursor settings migrate to the OpenRouter host gateway", async () => {
  const loaded = await loadModule();
  try {
    const ctx = await routerFor(loaded.module, "cursor");
    try {
      const routed = await ctx.router.dispatch("sendPrompt", { agentId: "agent", prompt: "hi", clientNonce: "nonce" });
      assert.deepEqual(routed, { handled: false });
    } finally {
      await ctx.dispose();
    }
  } finally {
    await loaded.dispose();
  }
});

test("openrouter sendPrompt is not intercepted so turns run on the host agent loop", async () => {
  const loaded = await loadModule();
  try {
    const ctx = await routerFor(loaded.module, "openrouter");
    try {
      const routed = await ctx.router.dispatch("sendPrompt", { agentId: "agent", prompt: "hi", clientNonce: "nonce" });
      assert.deepEqual(routed, { handled: false });
    } finally {
      await ctx.dispose();
    }
  } finally {
    await loaded.dispose();
  }
});

test("legacy claude-code settings migrate to the OpenRouter host loop", async () => {
  const loaded = await loadModule();
  try {
    const ctx = await routerFor(loaded.module, "claude-code");
    try {
      const routed = await ctx.router.dispatch("sendPrompt", { agentId: "agent", prompt: "hi", clientNonce: "nonce" });
      assert.deepEqual(routed, { handled: false });
    } finally {
      await ctx.dispose();
    }
  } finally {
    await loaded.dispose();
  }
});
