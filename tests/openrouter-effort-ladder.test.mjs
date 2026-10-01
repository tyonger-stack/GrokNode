import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const codexHome = mkdtempSync(path.join(tmpdir(), "effort-ladder-codex-"));
const dataRoot = mkdtempSync(path.join(tmpdir(), "effort-ladder-root-"));
process.env.CODEX_HOME = codexHome;
process.env.HOME = mkdtempSync(path.join(tmpdir(), "effort-ladder-home-"));
process.env.SAND_DATA_ROOT = dataRoot;
process.env.OPENROUTER_API_KEY = "test-key";
delete process.env.SAND_OPENROUTER_EFFORT;
delete process.env.SAND_OPENROUTER_MODEL;

const catalogPath = path.join(codexHome, "opencodex-catalog.json");
const level = (effort) => ({ effort, description: effort });
let catalogTick = 1_700_000_000;
function writeCatalog(models) {
  writeFileSync(catalogPath, JSON.stringify({ models }));
  catalogTick += 10;
  utimesSync(catalogPath, catalogTick, catalogTick);
}
writeCatalog([
  { slug: "zai/glm-5.3-flash", default_reasoning_level: "max", supported_reasoning_levels: ["ultra", "low", "max", "high"].map(level) },
  { slug: "opencode-go/muse-spark-1.3-contributor", default_reasoning_level: "high", supported_reasoning_levels: ["low", "medium", "high", "xhigh"].map(level) },
  { slug: "weird/model", default_reasoning_level: "nonsense", supported_reasoning_levels: [level("minimal"), level("bogus")] },
]);

async function bundle(entry, name, plugins = []) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", `effort-ladder-${name}.cjs`);
  await build({ entryPoints: [path.join(repoRoot, entry)], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error", external: ["node:*"], plugins });
  return require(outfile);
}

const chatCalls = [];
globalThis.__effortLadderChatCalls = chatCalls;
const stubOpenAI = {
  name: "stub-ai-sdk-openai",
  setup(b) {
    b.onResolve({ filter: /^@ai-sdk\/openai$/ }, () => ({ path: "stub-openai", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "exports.createOpenAI = () => ({ chat(id, settings) { globalThis.__effortLadderChatCalls.push({ id, settings }); throw new Error('stub chat'); } });",
      loader: "js",
    }));
  },
};

const proxy = await bundle("source/shared/node/openrouter-proxy.ts", "proxy");
const { SandSettingsStore } = await bundle("source/shared/node/settings/sand-settings-store.ts", "store");
const session = await bundle("source/host/extensions/inference/provider-session.ts", "session", [stubOpenAI]);

test("the ladder has six levels ending in Ultra", () => {
  assert.deepEqual(proxy.OPENROUTER_REASONING_EFFORTS.map((entry) => entry.value), ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.equal(proxy.OPENROUTER_REASONING_EFFORTS.at(-1).label, "Ultra");
  assert.equal(proxy.normalizeOpenRouterReasoningEffort(" ULTRA "), "ultra");
});

test("a model's options are its catalog levels, in ladder order", () => {
  assert.deepEqual(proxy.openRouterEffortOptionsFor("zai/glm-5.3-flash").map((o) => o.value), ["low", "high", "max", "ultra"]);
  assert.deepEqual(proxy.openRouterEffortOptionsFor("opencode-go/muse-spark-1.3-contributor").map((o) => o.value), ["low", "medium", "high", "xhigh"]);
  assert.equal(proxy.readOpenRouterModelReasoning("zai/glm-5.3-flash").defaultLevel, "max");
});

test("unknown models, unusable entries and a missing catalog fall back to the full ladder", () => {
  assert.equal(proxy.openRouterEffortOptionsFor("not/in-catalog").length, 6);
  assert.equal(proxy.openRouterEffortOptionsFor(null).length, 6);
  assert.equal(proxy.readOpenRouterModelReasoning("weird/model"), null, "no ladder level survives normalization");
  assert.equal(proxy.openRouterEffortOptionsFor("weird/model").length, 6);
});

test("effortSupportedByModel keeps supported efforts and drops the rest", () => {
  assert.equal(proxy.effortSupportedByModel("max", "zai/glm-5.3-flash"), "max");
  assert.equal(proxy.effortSupportedByModel("medium", "zai/glm-5.3-flash"), null);
  assert.equal(proxy.effortSupportedByModel("medium", "not/in-catalog"), "medium");
  assert.equal(proxy.effortSupportedByModel(null, "zai/glm-5.3-flash"), null);
});

test("a rewritten catalog is picked up (the parse cache keys on mtime)", () => {
  writeCatalog([{ slug: "zai/glm-5.3-flash", default_reasoning_level: "low", supported_reasoning_levels: ["low", "high"].map(level) }]);
  try {
    assert.deepEqual(proxy.openRouterEffortOptionsFor("zai/glm-5.3-flash").map((o) => o.value), ["low", "high"]);
  } finally {
    writeCatalog([
      { slug: "zai/glm-5.3-flash", default_reasoning_level: "max", supported_reasoning_levels: ["ultra", "low", "max", "high"].map(level) },
      { slug: "opencode-go/muse-spark-1.3-contributor", default_reasoning_level: "high", supported_reasoning_levels: ["low", "medium", "high", "xhigh"].map(level) },
    ]);
  }
});

function settings(values) {
  const file = path.join(dataRoot, "settings.json");
  writeFileSync(file, "{}");
  const store = new SandSettingsStore(file);
  if (values.model) store.setOpenRouterModel(values.model);
  if (values.effort) store.setOpenRouterEffort(values.effort);
  if (values.agentModels) store.setOpenRouterAgentModels(values.agentModels);
  if (values.agentEfforts) store.setOpenRouterAgentEfforts(values.agentEfforts);
  return store;
}

function sentFor(agentId) {
  chatCalls.length = 0;
  const started = session.createProviderPromptSession("openrouter", agentId ? { agentId } : undefined);
  assert.throws(() => started.getExecutor().stream(undefined), /stub chat/);
  return chatCalls[0];
}

test("the host sends a supported effort, and ultra survives settings round-trips", () => {
  settings({ model: "zai/glm-5.3-flash", effort: "ultra" });
  assert.deepEqual(sentFor().settings, { reasoningEffort: "ultra" });
});

test("an effort the bot's model rejects is omitted, while another bot still sends it", () => {
  settings({ model: "opencode-go/muse-spark-1.3-contributor", effort: "medium", agentModels: { glm: "zai/glm-5.3-flash" } });
  const glm = sentFor("glm");
  assert.equal(glm.id, "zai/glm-5.3-flash");
  assert.equal(glm.settings, undefined, "glm has no medium level, so no reasoning_effort is sent");
  assert.deepEqual(sentFor("other").settings, { reasoningEffort: "medium" });
});

test("the env override is a debug knob and is sent as is", () => {
  settings({ model: "zai/glm-5.3-flash", effort: "high" });
  process.env.SAND_OPENROUTER_EFFORT = "medium";
  try {
    assert.deepEqual(sentFor().settings, { reasoningEffort: "medium" });
  } finally {
    delete process.env.SAND_OPENROUTER_EFFORT;
  }
});

test("the Router panel refetches efforts when the model changes and offers Ultra in its fallback", async () => {
  const patch = await readFile(path.join(repoRoot, "scripts/lib/router-renderer-patch.mjs"), "utf8");
  assert.match(patch, /RRouterOpenRouterEffort\(s\.provider,m\.selected\)/);
  assert.match(patch, /\},\[provider,model\]\);/);
  assert.match(patch, /\{value:"ultra",label:RRouterLoc\("Ultra","极致"\)\}/);
  assert.match(patch, /s\.options\.map\(o=>L\.find\(x=>x\.value===o\.value\)\?\?o\)/, "catalog options get the localized labels too");
  assert.match(patch, /RRouterLoc\("Model default","模型默认"\)\+\(d\?" \("\+d\.label\+"\)":""\)/);
  const edge = await readFile(path.join(repoRoot, "source/electron-main/main-edge.ts"), "utf8");
  assert.match(edge, /options: openRouterEffortOptionsFor\(model\)/);
  assert.match(edge, /effort: effortSupportedByModel\(stored, model\)/);
});

test("the store keeps per-bot efforts; null clears one and junk is dropped", () => {
  const store = settings({ agentEfforts: { a: "HIGH", b: "nonsense", " ": "low" } });
  assert.deepEqual(store.getOpenRouterAgentEfforts(), { a: "high" });
  store.setOpenRouterAgentEffort("b", "ultra");
  assert.equal(store.getOpenRouterAgentEffort("b"), "ultra");
  store.setOpenRouterAgentEffort("a", null);
  store.setOpenRouterAgentEffort("b", null);
  assert.deepEqual(store.getOpenRouterAgentEfforts(), {});
});

test("a bot's own effort beats the Router effort; other bots keep the Router effort", () => {
  settings({ model: "zai/glm-5.3-flash", effort: "high", agentEfforts: { deep: "ultra" } });
  assert.deepEqual(sentFor("deep").settings, { reasoningEffort: "ultra" });
  assert.deepEqual(sentFor("other").settings, { reasoningEffort: "high" });
  assert.equal(session.effortForModel("zai/glm-5.3-flash", "deep"), "ultra");
});

test("a bot's own effort is still clamped by the bot's own model", () => {
  settings({ model: "opencode-go/muse-spark-1.3-contributor", effort: "high", agentModels: { glm: "zai/glm-5.3-flash" }, agentEfforts: { glm: "medium" } });
  const glm = sentFor("glm");
  assert.equal(glm.id, "zai/glm-5.3-flash");
  assert.equal(glm.settings, undefined, "glm has no medium level: the endpoint default applies rather than falling back to the Router effort");
});

test("the per-bot effort is bridged end to end and the card offers it", async () => {
  const [rpc, preload, edge, resync, aux, service, card] = await Promise.all([
    "source/shared/rpc/main.ts", "source/electron-preload/preload.ts", "source/electron-main/main-edge.ts",
    "source/electron-main/coordinator/coordinator-resync.ts", "source/electron-main/coordinator/production-root-auxiliary-provider.ts",
    "source/host/extensions/settings/settings-service.ts", "scripts/lib/agent-model-renderer-patch.mjs",
  ].map((file) => readFile(path.join(repoRoot, file), "utf8")));
  assert.match(rpc, /getAgentOpenRouterEffort: \{ args: "object" \}/);
  assert.match(rpc, /setAgentOpenRouterEffort: \{ args: "object" \}/);
  assert.match(preload, /edge\("setAgentOpenRouterEffort", \{ agentId, effort \}\)/);
  assert.match(edge, /syncHostSettingsToBox\(\{ openRouterAgentEfforts: all \}\)/);
  assert.match(edge, /defaultEffort: effortSupportedByModel\(globalEffort, model\)/);
  assert.match(resync, /openrouter_agent_efforts/);
  assert.match(aux, /getOpenRouterAgentEfforts: \(\) => settings\.getOpenRouterAgentEfforts\(\)/);
  assert.match(service, /this\.store\.setOpenRouterAgentEfforts\(update\.openRouterAgentEfforts \?\? \{\}\)/);
  assert.match(card, /RLocT\("Effort","推理强度"\)/);
  assert.match(card, /\},\[t\.id,s\.selected,s\.defaultModel\]\);/, "effort options follow the bot's model");
});

test("the bot card localizes every effort level, including catalog-provided options", async () => {
  const card = await readFile(path.join(repoRoot, "scripts/lib/agent-model-renderer-patch.mjs"), "utf8");
  for (const [en, zh] of [["Low", "低"], ["Medium", "中"], ["High", "高"], ["Extra high", "超高"], ["Max", "最高"], ["Ultra", "极致"]]) {
    assert.ok(card.includes(`RLocT("${en}","${zh}")`), en);
  }
  assert.match(card, /q\.options\.map\(o=>A\.find\(n=>n\.value===o\.value\)\?\?o\)/);
});
