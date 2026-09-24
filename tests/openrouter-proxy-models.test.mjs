import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedSourcePath = path.join(repoRoot, "source", "shared", "node", "openrouter-proxy.ts");

const CLOUD = "https://openrouter.ai/api/v1";

async function loadModule() {
  const result = await build({
    entryPoints: [sharedSourcePath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022"
  });
  const output = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

function withTempCodexHome(body, env, fn) {
  const home = mkdtempSync(path.join(tmpdir(), "openrouter-codex-home-"));
  if (body) writeFileSync(path.join(home, "config.toml"), body);
  const previous = { codexHome: process.env.CODEX_HOME, openrouterBaseUrl: process.env.OPENROUTER_BASE_URL };
  process.env.CODEX_HOME = home;
  if (env.OPENROUTER_BASE_URL === undefined) delete process.env.OPENROUTER_BASE_URL;
  else process.env.OPENROUTER_BASE_URL = env.OPENROUTER_BASE_URL;
  try { return fn(); } finally {
    process.env.CODEX_HOME = previous.codexHome;
    if (previous.openrouterBaseUrl === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = previous.openrouterBaseUrl;
  }
}

test("base URL prefers env var over codex config over cloud", async () => {
  const mod = await loadModule();
  withTempCodexHome('openai_base_url = "http://proxy.local/v1"', {}, () => {
    assert.equal(mod.resolveOpenRouterBaseUrl(), "http://proxy.local/v1");
    assert.equal(mod.isOpenRouterProxyMode(), true);
  });
  withTempCodexHome('openai_base_url = "http://proxy.local/v1"', { OPENROUTER_BASE_URL: "http://override.local/v1" }, () => {
    assert.equal(mod.resolveOpenRouterBaseUrl(), "http://override.local/v1");
  });
  withTempCodexHome("", {}, () => {
    assert.equal(mod.resolveOpenRouterBaseUrl(), CLOUD);
    assert.equal(mod.isOpenRouterProxyMode(), false);
  });
});

test("readCodexConfigValue reads top-level quoted keys", async () => {
  const mod = await loadModule();
  withTempCodexHome('openai_base_url = "http://proxy.local/v1"\nopenrouter_model = "volcengine-agent-plan/ark-code-latest"\n', {}, () => {
    assert.equal(mod.readCodexConfigValue("openrouter_model"), "volcengine-agent-plan/ark-code-latest");
    assert.equal(mod.readCodexConfigValue("missing_key"), null);
  });
});

test("listOpenRouterProxyModels parses /v1/models and sorts unique ids", async () => {
  const mod = await loadModule();
  const server = createServer((request, response) => {
    if (request.url !== "/v1/models") { response.writeHead(404).end(); return; }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "gpt-6-astra" }, { id: "volcengine-agent-plan/ark-code-latest" }, { id: "gpt-6-astra" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const models = withTempCodexHome("", { OPENROUTER_BASE_URL: `http://127.0.0.1:${port}/v1` }, () => mod.listOpenRouterProxyModels(2000));
    assert.deepEqual(await models, ["gpt-6-astra", "volcengine-agent-plan/ark-code-latest"]);
  } finally {
    server.close();
  }
});

test("listOpenRouterProxyModels falls back to catalog slugs when proxy is unreachable", async () => {
  const mod = await loadModule();
  const home = mkdtempSync(path.join(tmpdir(), "openrouter-catalog-home-"));
  writeFileSync(path.join(home, "opencodex-catalog.json"), JSON.stringify({ models: [{ slug: "gpt-5.6-sol" }, { slug: "volcengine-agent-plan/ark-code-latest" }] }));
  const previous = { codexHome: process.env.CODEX_HOME, openrouterBaseUrl: process.env.OPENROUTER_BASE_URL };
  process.env.CODEX_HOME = home;
  process.env.OPENROUTER_BASE_URL = "http://127.0.0.1:1/v1";
  try {
    const models = await mod.listOpenRouterProxyModels(500);
    assert.deepEqual(models, ["gpt-5.6-sol", "volcengine-agent-plan/ark-code-latest"]);
  } finally {
    process.env.CODEX_HOME = previous.codexHome;
    if (previous.openrouterBaseUrl === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = previous.openrouterBaseUrl;
  }
});

test("the persisted endpoint wins over env and codex config", async () => {
  const mod = await loadModule();
  withTempCodexHome("openai_base_url = \"http://proxy.local/v1\"", { OPENROUTER_BASE_URL: "http://override.local/v1" }, () => {
    assert.equal(mod.resolveOpenRouterBaseUrl("http://from-settings.local/v1"), "http://from-settings.local/v1");
    assert.equal(mod.isOpenRouterProxyMode("http://from-settings.local/v1"), true);
    assert.equal(mod.resolveOpenRouterTransport("http://from-settings.local/v1").baseUrl, "http://from-settings.local/v1");
    assert.equal(mod.resolveOpenRouterBaseUrl("  http://padded.local/v1  "), "http://padded.local/v1");
  });
  withTempCodexHome("openai_base_url = \"http://proxy.local/v1\"", {}, () => {
    assert.equal(mod.resolveOpenRouterBaseUrl(null), "http://proxy.local/v1");
    assert.equal(mod.resolveOpenRouterBaseUrl("   "), "http://proxy.local/v1");
    assert.equal(mod.isOpenRouterProxyMode(null), true);
  });
});

test("rewrites the Mac forwarder to the container relay inside Docker", async () => {
  const mod = await loadModule();
  assert.deepEqual(mod.resolveOpenRouterTransport("http://127.0.0.1:11010/v1", false), {
    baseUrl: "http://127.0.0.1:11010/v1",
  });
  assert.deepEqual(mod.resolveOpenRouterTransport("http://127.0.0.1:11010/v1", true), {
    baseUrl: "http://127.0.0.1:10100/v1",
  });
  assert.deepEqual(mod.resolveOpenRouterTransport("http://localhost:11010/v1", true), {
    baseUrl: "http://localhost:10100/v1",
  });
  assert.deepEqual(mod.resolveOpenRouterTransport("http://127.0.0.1:10080/v1", true), {
    baseUrl: "http://host.docker.internal:10080/v1",
    hostHeader: "127.0.0.1:10080",
  });
});
