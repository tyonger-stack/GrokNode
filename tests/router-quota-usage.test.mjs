import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { COMPONENT_SOURCE } from "../scripts/lib/router-renderer-patch.mjs";

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

  // A later success recovers the current quota status without losing usage.
  store.recordInferenceUsage("openrouter", { inputTokens: 1 });
  const again = store.getInferenceRouterUsage().providers.openrouter;
  assert.equal(again.requests, 2);
  assert.equal(again.quotaExhaustedAt, null);
  assert.equal(again.quotaExhaustedModel, null);
});

test("legacy quota warnings older than the latest success are cleared on load", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "quota-recovered-"));
  const file = path.join(dir, "settings.json");
  const usage = emptySandInferenceRouterUsage();
  usage.providers.openrouter = {
    ...usage.providers.openrouter, requests: 5767, inputTokens: 1407012000,
    lastUsedAt: "2026-10-16T21:34:02.828Z",
    quotaExhaustedAt: "2026-10-06T14:08:52.543Z", quotaExhaustedModel: "old-model",
  };
  await writeFile(file, JSON.stringify({ version: 1, inferenceRouterUsage: usage }));

  const current = new SandSettingsStore(file).getInferenceRouterUsage().providers.openrouter;

  assert.equal(current.quotaExhaustedAt, null);
  assert.equal(current.quotaExhaustedModel, null);
  assert.equal(current.requests, 5767);
  assert.equal(current.inputTokens, 1407012000);
});

test("changing the endpoint resets its quota warning but resaving the same endpoint does not", async () => {
  const store = await makeStore();
  store.setOpenRouterBaseUrl("https://old.example/v1");
  store.recordQuotaExhausted("openrouter", "old-model");
  store.setOpenRouterBaseUrl("https://old.example/v1/");
  assert.equal(store.getInferenceRouterUsage().providers.openrouter.quotaExhaustedModel, "old-model");

  store.setOpenRouterBaseUrl("https://new.example/v1");

  assert.equal(store.getInferenceRouterUsage().providers.openrouter.quotaExhaustedAt, null);
  assert.equal(store.getInferenceRouterUsage().providers.openrouter.quotaExhaustedModel, null);
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

function mountRouterState(read) {
  const window = new EventTarget();
  window.desktop = { agent: { getInferenceRouter: read } };
  let state;
  let effect;
  let poll;
  let cleared = false;
  const updates = [];
  const de = {
    useState(initial) {
      state = initial;
      return [state, (next) => {
        state = typeof next === "function" ? next(state) : next;
        for (const resolve of updates.splice(0)) resolve(state);
      }];
    },
    useEffect(callback) { effect = callback; },
  };
  const hook = new Function("de", "window", "document", "setInterval", "clearInterval", COMPONENT_SOURCE + ";return RRouterState;")(
    de, window, { visibilityState: "visible" },
    (callback) => { poll = callback; return 1; },
    () => { cleared = true; },
  );
  hook();
  const stop = effect();
  return { window, stop, poll: () => poll(), next: () => new Promise((resolve) => updates.push(resolve)), get state() { return state; }, get cleared() { return cleared; } };
}

test("an open router panel refreshes recovered quota and stops polling after unmount", { timeout: 1000 }, async () => {
  let calls = 0;
  const runtime = mountRouterState(async () => ({ provider: "openrouter", usage: { quotaExhaustedAt: calls++ === 0 ? "old-warning" : null } }));
  try {
    await runtime.next();
    assert.equal(runtime.state.usage.quotaExhaustedAt, "old-warning");

    const refreshed = runtime.next();
    runtime.poll();
    await refreshed;

    assert.equal(runtime.state.usage.quotaExhaustedAt, null);
  } finally { runtime.stop(); }
  assert.equal(runtime.cleared, true);
  const beforeFocus = calls;
  runtime.window.dispatchEvent(new Event("focus"));
  assert.equal(calls, beforeFocus);
});

test("a stale usage response cannot restore an alarm after a newer refresh", { timeout: 1000 }, async () => {
  let resolveOld;
  const old = new Promise((resolve) => { resolveOld = resolve; });
  let calls = 0;
  const runtime = mountRouterState(() => ++calls === 1 ? old : Promise.resolve({ provider: "openrouter", usage: { quotaExhaustedAt: null } }));
  try {
    const refreshed = runtime.next();
    runtime.window.dispatchEvent(new Event("focus"));
    await refreshed;

    resolveOld({ provider: "openrouter", usage: { quotaExhaustedAt: "old-warning" } });
    await old;

    assert.equal(runtime.state.usage.quotaExhaustedAt, null);
  } finally { runtime.stop(); }
});
