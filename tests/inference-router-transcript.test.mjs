import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-inference-router-transcript-"));
  const output = path.join(temporary, "inference-router.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("routed transcript preserves structured MCP mention rich text across reload", async () => {
  const loaded = await loadModule();
  try {
    const richText = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [
        { type: "mention", attrs: { id: "mcp:3213107", label: "Gmail" } },
        { type: "text", text: " what's new?" },
      ] }],
    });
    const store = loaded.module.parseInferenceRouterTranscriptStore({
      schemaVersion: 2,
      agents: {
        agent: [{
          provider: "codex",
          role: "user",
          content: "@Gmail what's new?",
          richText,
          id: "t1u",
          clientNonce: "nonce-1",
          timestampMs: 123,
        }],
      },
    });
    const projected = loaded.module.projectInferenceRouterTranscriptEntry(store.agents.agent[0]);
    assert.equal(projected.richText, richText);
    assert.deepEqual(JSON.parse(projected.richText).content[0].content[0], {
      type: "mention",
      attrs: { id: "mcp:3213107", label: "Gmail" },
    });
  } finally {
    await loaded.dispose();
  }
});

test("routed transcript rejects malformed rich text carriers", async () => {
  const loaded = await loadModule();
  try {
    const store = loaded.module.parseInferenceRouterTranscriptStore({
      schemaVersion: 2,
      agents: {
        agent: [{ provider: "codex", role: "user", content: "@Gmail", richText: {}, id: "t1u", timestampMs: 123 }],
      },
    });
    assert.deepEqual(store.agents.agent, []);
  } finally {
    await loaded.dispose();
  }
});

test("router tail merge collapses duplicate turn ids across remote and local", async () => {
  const loaded = await loadModule();
  const dir = await mkdtemp(path.join(os.tmpdir(), "grok-router-merge-"));
  try {
    await writeFile(path.join(dir, "settings.json"), JSON.stringify({
      version: 1, mcpBoxServers: [], autoUpdateWhenIdleOptIn: false,
      egressTunnelEnabled: false, webauthnProxyEnabled: true,
      mcpCustomInstructions: {}, mcpCustomInstructionsByServerId: {},
      mcpDisabledToolsByServerId: {}, conciergeConsent: "unset",
      settingsMigrations: [], inferenceProvider: "openrouter",
    }));
    await writeFile(path.join(dir, "inference-router-transcript.json"), JSON.stringify({
      schemaVersion: 2,
      agents: { butler: [
        { provider: "openrouter", role: "user", content: "local hi", id: "t0u", timestampMs: 2 },
        { provider: "openrouter", role: "assistant", content: "local yo", id: "t0s0", timestampMs: 3 },
      ] },
    }));
    const router = loaded.module.createCoordinatorInferenceRouter({
      dataDir: dir,
      postEvent: () => {},
      dispatchRemote: async () => ({ entries: [
        { kind: "message", id: "t0u", role: "user", content: "remote hi", timestampMs: 1 },
      ] }),
    });
    const out = await router.dispatch("getAgentTranscriptTail", { id: "butler" });
    assert.equal(out.handled, true);
    assert.deepEqual(out.value.entries.map((entry) => entry.id), ["t0u", "t0s0"]);
    assert.equal(out.value.entries[0].content, "local hi");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await loaded.dispose();
  }
});

test("router tail merge keeps remote-then-local order without conflicts", async () => {
  const loaded = await loadModule();
  const dir = await mkdtemp(path.join(os.tmpdir(), "grok-router-merge-"));
  try {
    await writeFile(path.join(dir, "settings.json"), JSON.stringify({
      version: 1, mcpBoxServers: [], autoUpdateWhenIdleOptIn: false,
      egressTunnelEnabled: false, webauthnProxyEnabled: true,
      mcpCustomInstructions: {}, mcpCustomInstructionsByServerId: {},
      mcpDisabledToolsByServerId: {}, conciergeConsent: "unset",
      settingsMigrations: [], inferenceProvider: "openrouter",
    }));
    await writeFile(path.join(dir, "inference-router-transcript.json"), JSON.stringify({
      schemaVersion: 2,
      agents: { butler: [
        { provider: "openrouter", role: "user", content: "local hi", id: "t5u", timestampMs: 2 },
      ] },
    }));
    const router = loaded.module.createCoordinatorInferenceRouter({
      dataDir: dir,
      postEvent: () => {},
      dispatchRemote: async () => ({ entries: [
        { kind: "message", id: "r0", role: "user", content: "remote hi", timestampMs: 1 },
      ] }),
    });
    const out = await router.dispatch("getAgentTranscriptTail", { id: "butler" });
    assert.equal(out.handled, true);
    assert.deepEqual(out.value.entries.map((entry) => entry.id), ["r0", "t5u"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await loaded.dispose();
  }
});
