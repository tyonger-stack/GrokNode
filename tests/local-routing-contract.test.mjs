import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry, prefix) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), prefix));
  const output = path.join(temporary, "module.mjs");
  await build({ entryPoints: [path.join(repoRoot, entry)], outfile: output, bundle: true, format: "esm", platform: "node", target: "node22" });
  const module = await import(pathToFileURL(output).href + "?" + Date.now());
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("settings migrate legacy provider and remote runtime to OpenRouter and local Docker", async () => {
  const loaded = await bundle("source/shared/node/settings/sand-settings-store.ts", "grok-local-settings-");
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "grok-local-settings-data-"));
  const settingsPath = path.join(dataDir, "settings.json");
  try {
    await writeFile(settingsPath, JSON.stringify({ version: 1, inferenceProvider: "cursor", boxRuntime: "remote", mcpBoxServers: ["demo"], settingsMigrations: [] }));
    const store = new loaded.module.SandSettingsStore(settingsPath);
    assert.equal(store.getInferenceProvider(), "openrouter");
    assert.equal(store.getBoxRuntime(), "local-docker");
    assert.deepEqual(store.getMcpBoxServers(), ["demo"]);

    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(persisted.inferenceProvider, "openrouter");
    assert.equal(persisted.boxRuntime, "local-docker");
    assert.ok(persisted.settingsMigrations.includes("local-only-routing-v1"));

    await writeFile(settingsPath, JSON.stringify({ version: 1, inferenceProvider: "codex", boxRuntime: "remote", settingsMigrations: [] }));
    const codexStore = new loaded.module.SandSettingsStore(settingsPath);
    assert.equal(codexStore.getInferenceProvider(), "codex");
    assert.equal(codexStore.getBoxRuntime(), "local-docker");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await loaded.dispose();
  }
});

test("the production box contract is local Docker only", async () => {
  const connector = await readFile(path.join(repoRoot, "source/electron-main/box/local-docker-host-connector.ts"), "utf8");
  const gateway = await readFile(path.join(repoRoot, "source/electron-main/adapters/coordinator-gateway.ts"), "utf8");
  const runtime = await readFile(path.join(repoRoot, "source/shared/box-runtime.ts"), "utf8");
  assert.match(runtime, /SandBoxRuntime = "local-docker"/);
  assert.doesNotMatch(connector, /SandRemoteHostConnector|issueInferenceCredential|.claude/);
  assert.doesNotMatch(gateway, /createRemoteHostConnector|BrokeredHostConnector|backendUrl/);
  assert.match(connector, /LOCAL_DOCKER_BOX_CONTAINER/);
  assert.match(connector, /SAND_USE_EXISTING_BOX_EXEC_DAEMON=1/);
});
