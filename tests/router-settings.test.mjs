import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routerSourcePath = path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/router.ts");

async function loadRouterModule() {
  const source = await readFile(routerSourcePath, "utf8");
  const { code: output } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("router provider preference defaults to OpenRouter and round-trips both local providers", async () => {
  const router = await loadRouterModule();
  assert.deepEqual(router.ROUTER_PROVIDERS.map(({ id }) => id), ["codex", "openrouter"]);
  assert.equal(router.parseRouterProviderPreference(null), "openrouter");
  assert.equal(router.parseRouterProviderPreference("not-json"), "openrouter");
  assert.equal(router.parseRouterProviderPreference(JSON.stringify({ schemaVersion: 1, provider: "unknown" })), "openrouter");

  let stored = null;
  const persistence = {
    async read(key) {
      assert.equal(key, router.ROUTER_PROVIDER_PERSISTENCE_KEY);
      return stored;
    },
    async write(key, value) {
      assert.equal(key, router.ROUTER_PROVIDER_PERSISTENCE_KEY);
      stored = value;
    }
  };
  for (const provider of router.ROUTER_PROVIDERS) {
    await router.saveRouterProvider(persistence, provider.id);
    assert.equal(await router.loadRouterProvider(persistence), provider.id);
  }
});

test("settings registry exposes Router with the native settings icon contract", async () => {
  const source = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/view.tsx"), "utf8");
  assert.match(source, /\{ id: "router", label: "Router", icon: "git-branch" \}/);
});

test("Router settings display TokenHub while retaining the OpenRouter-compatible provider id", async () => {
  const router = await loadRouterModule();
  const tokenHub = router.ROUTER_PROVIDERS.find(({ id }) => id === "openrouter");
  assert.equal(tokenHub?.label, "TokenHub");
  assert.match(tokenHub?.description ?? "", /TokenHub/);
  assert.doesNotMatch(tokenHub?.description ?? "", /OpenRouter/);
});

test("router provider syncs through the app backend edge", async () => {
  const router = await loadRouterModule();
  let lastSet = null;
  const agent = {
    async getInferenceRouter() { return { provider: "codex", usage: null, local: null }; },
    async setInferenceRouter(provider) { lastSet = provider; return { provider }; }
  };
  assert.equal(await router.loadBackendRouterProvider(agent), "codex");
  assert.equal(await router.saveBackendRouterProvider(agent, "openrouter"), "openrouter");
  assert.equal(lastSet, "openrouter");

  assert.equal(await router.loadBackendRouterProvider({ async getInferenceRouter() { throw new Error("offline"); } }), null);
  assert.equal(await router.loadBackendRouterProvider({ async getInferenceRouter() { return { provider: "unknown" }; } }), null);
  await assert.rejects(() => router.saveBackendRouterProvider({ async setInferenceRouter() { return {}; } }, "codex"), /not confirmed/);
});
