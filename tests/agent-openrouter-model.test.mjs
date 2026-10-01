import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// Isolate every path the resolver reads: the sand settings file and ~/.codex/config.toml.
const home = mkdtempSync(path.join(tmpdir(), "agent-model-home-"));
const dataRoot = mkdtempSync(path.join(tmpdir(), "agent-model-root-"));
process.env.HOME = home;
process.env.SAND_DATA_ROOT = dataRoot;
delete process.env.SAND_OPENROUTER_MODEL;
delete process.env.OPENROUTER_BASE_URL;
const settingsFile = path.join(dataRoot, "settings.json");

async function bundle(entry, name, plugins = []) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", `agent-model-${name}.cjs`);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
    external: ["node:*"], plugins,
  });
  return require(outfile);
}

// Records the model id handed to createOpenAI(...).chat(id) and stops the turn there.
const chatIds = [];
globalThis.__agentModelChatIds = chatIds;
const stubOpenAI = {
  name: "stub-ai-sdk-openai",
  setup(b) {
    b.onResolve({ filter: /^@ai-sdk\/openai$/ }, () => ({ path: "stub-openai", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "exports.createOpenAI = () => ({ chat(id) { globalThis.__agentModelChatIds.push(id); throw new Error('stub chat'); } });",
      loader: "js",
    }));
  },
};

const { SandSettingsStore, normalizeOpenRouterAgentModels } = await bundle("source/shared/node/settings/sand-settings-store.ts", "store");
const session = await bundle("source/host/extensions/inference/provider-session.ts", "session", [stubOpenAI]);

process.env.OPENROUTER_API_KEY = "test-key";

function writeSettings({ openRouterModel, openRouterAgentModels = {} }) {
  writeFileSync(settingsFile, "{}");
  const store = new SandSettingsStore(settingsFile);
  if (openRouterModel !== undefined) store.setOpenRouterModel(openRouterModel);
  store.setOpenRouterAgentModels(openRouterAgentModels);
}

test("the store keeps per-bot models and null/blank clears one", () => {
  writeSettings({});
  const store = new SandSettingsStore(settingsFile);
  store.setOpenRouterAgentModel("bot-a", "  zai/glm-5.3-flash ");
  store.setOpenRouterAgentModel("bot-b", "qianwen/qwen3.8-max");
  assert.equal(new SandSettingsStore(settingsFile).getOpenRouterAgentModel("bot-a"), "zai/glm-5.3-flash");
  store.setOpenRouterAgentModel("bot-a", null);
  store.setOpenRouterAgentModel("bot-b", "   ");
  assert.deepEqual(new SandSettingsStore(settingsFile).getOpenRouterAgentModels(), {});
});

test("normalizeOpenRouterAgentModels drops malformed entries", () => {
  assert.deepEqual(normalizeOpenRouterAgentModels({ a: " m/x ", b: "", c: 3, "": "m/y" }), { a: "m/x" });
  assert.deepEqual(normalizeOpenRouterAgentModels(["m/x"]), {});
  assert.deepEqual(normalizeOpenRouterAgentModels(null), {});
});

test("a bot's own model beats the Router default; other bots keep the default", () => {
  writeSettings({ openRouterModel: "zai/glm-5.3-flash", openRouterAgentModels: { "bot-a": "qianwen/qwen3.8-max" } });
  assert.equal(session.resolveOpenRouterModel("bot-a"), "qianwen/qwen3.8-max");
  assert.equal(session.resolveOpenRouterModel("bot-b"), "zai/glm-5.3-flash");
  assert.equal(session.resolveOpenRouterModel(), "zai/glm-5.3-flash");
});

test("SAND_OPENROUTER_MODEL still overrides both", () => {
  writeSettings({ openRouterModel: "zai/glm-5.3-flash", openRouterAgentModels: { "bot-a": "qianwen/qwen3.8-max" } });
  process.env.SAND_OPENROUTER_MODEL = "env/model";
  try {
    assert.equal(session.resolveOpenRouterModel("bot-a"), "env/model");
  } finally {
    delete process.env.SAND_OPENROUTER_MODEL;
  }
});

test("with nothing configured the built-in default applies", () => {
  writeSettings({});
  assert.equal(session.resolveOpenRouterModel("bot-a"), "openai/gpt-5.2");
});

test("the prompt session sends the bot's own model to the endpoint", () => {
  writeSettings({ openRouterModel: "zai/glm-5.3-flash", openRouterAgentModels: { "bot-a": "qianwen/qwen3.8-max" } });
  chatIds.length = 0;
  const own = session.createProviderPromptSession("openrouter", { agentId: "bot-a" });
  assert.equal(own.getModelId(), "qianwen/qwen3.8-max");
  assert.throws(() => own.getExecutor().stream(undefined), /stub chat/);
  const other = session.createProviderPromptSession("openrouter", { agentId: "bot-b" });
  assert.throws(() => other.getExecutor().stream(undefined), /stub chat/);
  assert.deepEqual(chatIds, ["qianwen/qwen3.8-max", "zai/glm-5.3-flash"]);
});

test("the bridge is wired end to end: rpc contract, preload, main-edge, resync, host turn", async () => {
  const read = (file) => readFile(path.join(repoRoot, file), "utf8");
  const [rpc, preload, edge, resync, turn] = await Promise.all([
    read("source/shared/rpc/main.ts"),
    read("source/electron-preload/preload.ts"),
    read("source/electron-main/main-edge.ts"),
    read("source/electron-main/coordinator/coordinator-resync.ts"),
    read("source/host/runner/turn-run-shell.ts"),
  ]);
  for (const method of ["getAgentOpenRouterModel", "setAgentOpenRouterModel"]) {
    assert.match(rpc, new RegExp(`${method}: \\{ args: "object" \\}`));
    assert.match(preload, new RegExp(`${method}: \\(agentId: string[^)]*\\) => edge\\("${method}"`));
    assert.match(edge, new RegExp(`${method}: async \\(raw\\) =>`));
  }
  // The whole map is synced, so the box never keeps an override the Mac already cleared.
  assert.match(edge, /syncHostSettingsToBox\(\{ openRouterAgentModels: all \}\)/);
  assert.match(resync, /openRouterAgentModels/);
  assert.equal(turn.split("createProviderPromptSession(inferenceProvider, { agentId: input.conversationId })").length - 1, 2);
});

test("the model is fixed when the session starts, not re-read per request", () => {
  writeSettings({ openRouterAgentModels: { "bot-a": "first/model" } });
  chatIds.length = 0;
  const started = session.createProviderPromptSession("openrouter", { agentId: "bot-a" });
  writeSettings({ openRouterAgentModels: { "bot-a": "second/model" } });
  assert.throws(() => started.getExecutor().stream(undefined), /stub chat/);
  assert.deepEqual(chatIds, ["first/model"]);
});
