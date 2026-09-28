import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry) {
  const out = path.join(
    repoRoot, "node_modules", ".cache",
    `quota-usage-${path.basename(entry, ".ts")}.cjs`,
  );
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true, platform: "node", format: "cjs", outfile: out,
    logLevel: "error",
    external: ["node:*"],
  });
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)(out);
}

const settingsModule = await bundle("source/shared/node/settings/sand-settings-store.ts");
const { SandSettingsStore } = settingsModule;
const routerModule = await bundle("source/shared/inference-router.ts");
const { emptySandInferenceRouterUsage } = routerModule;

function freshStore() {
  return { dir: null };
}

async function makeStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "quota-usage-"));
  const store = new SandSettingsStore(path.join(dir, "settings.json"));
  return store;
}

test("quota event stamps time and model without touching counters", async () => {
  const store = await makeStore();
  store.recordInferenceUsage("openrouter", { inputTokens: 10, outputTokens: 5 });
  store.recordQuotaExhausted("openrouter", "zai/glm-5.3-flash");

  const usage = store.getInferenceRouterUsage().providers.openrouter;
  assert.equal(usage.requests, 1, "quota event must not inflate request counts");
  assert.equal(usage.inputTokens, 10);
  assert.ok(typeof usage.quotaExhaustedAt === "string" && usage.quotaExhaustedAt.length > 0);
  assert.equal(usage.quotaExhaustedModel, "zai/glm-5.3-flash");

  // A later success keeps the counters moving but preserves the stamp until
  // the next quota event overwrites it.
  store.recordInferenceUsage("openrouter", { inputTokens: 1 });
  const again = store.getInferenceRouterUsage().providers.openrouter;
  assert.equal(again.requests, 2);
  assert.equal(again.quotaExhaustedModel, "zai/glm-5.3-flash");
});

test("quota fields survive a settings reload (parse whitelist)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "quota-usage-"));
  const file = path.join(dir, "settings.json");
  const store = new SandSettingsStore(file);
  store.recordQuotaExhausted("codex", "gpt-5.2-codex");

  const reloaded = new SandSettingsStore(file).getInferenceRouterUsage().providers.codex;
  assert.ok(typeof reloaded.quotaExhaustedAt === "string");
  assert.equal(reloaded.quotaExhaustedModel, "gpt-5.2-codex");
});

test("empty usage carries null quota fields", () => {
  const usage = emptySandInferenceRouterUsage();
  for (const provider of ["codex", "openrouter"]) {
    assert.equal(usage.providers[provider].quotaExhaustedAt, null);
    assert.equal(usage.providers[provider].quotaExhaustedModel, null);
  }
});

test("renderer patch renders the quota status row and lists quota-hit providers", async () => {
  const patch = await readFile(
    path.join(repoRoot, "scripts", "lib", "router-renderer-patch.mjs"), "utf8",
  );
  assert.match(patch, /quotaExhaustedAt/, "patch must read the quota timestamp");
  assert.match(patch, /quotaExhaustedModel/, "patch must read the quota model");
  assert.match(patch, /配额已耗尽/, "patch must render the Chinese quota label");
  assert.match(patch, /color:"red"/, "quota row must render in red");
  assert.match(
    patch,
    /quotaExhaustedAt!/,
    "usage list must include providers with a quota event but zero requests",
  );
});

test("quota model is clamped and blank models become null", async () => {
  const store = await makeStore();
  store.recordQuotaExhausted("openrouter", "   ");
  assert.equal(store.getInferenceRouterUsage().providers.openrouter.quotaExhaustedModel, null);
  store.recordQuotaExhausted("openrouter", "x".repeat(500));
  assert.equal(store.getInferenceRouterUsage().providers.openrouter.quotaExhaustedModel?.length, 256);
});
