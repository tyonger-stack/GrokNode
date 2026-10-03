import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// 换 API 地址后，各 Bot 的专属模型/推理强度是旧端点的配置（glm 系 slug 对新端点是
// unknown model），应当自动恢复为跟随全局默认。全局模型/强度由用户自选，不动。
// 实现：main-edge 的 setOpenRouterBaseUrl 在「解析出的端点真正变化」时清空
// openRouterAgentModels / openRouterAgentEfforts（Mac 侧 + 经 syncHostSettingsToBox
// 同步到容器，host 侧 setHostSettings 对这两个字段是整表替换语义），响应带 resetAgents。

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

async function bundleMainEdge() {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "endpoint-reset-main-edge.cjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/electron-main/main-edge.ts")],
    bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
    external: ["electron", "node:*"],
  });
  return require(outfile);
}

function makeStore(settingsFile) {
  // 与 agent-openrouter-model.test.mjs 相同的加载方式：单独打包 settings store
  const { SandSettingsStore } = require(path.join(repoRoot, "node_modules/.cache/endpoint-reset-store.cjs"));
  return new SandSettingsStore(settingsFile);
}

const mainEdge = await bundleMainEdge();
{
  const outfile = path.join(repoRoot, "node_modules", ".cache", "endpoint-reset-store.cjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/shared/node/settings/sand-settings-store.ts")],
    bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
    external: ["node:*"],
  });
}

function setup({ seedModels = {}, seedEfforts = {}, persistedBaseUrl } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "endpoint-reset-"));
  const settingsFile = path.join(dir, "settings.json");
  writeFileSync(settingsFile, "{}\n");
  const store = makeStore(settingsFile);
  if (persistedBaseUrl !== undefined) store.setOpenRouterBaseUrl(persistedBaseUrl);
  if (Object.keys(seedModels).length > 0) store.setOpenRouterAgentModels(seedModels);
  if (Object.keys(seedEfforts).length > 0) store.setOpenRouterAgentEfforts(seedEfforts);
  const syncs = [];
  const deps = {
    settingsStore: store,
    syncHostSettingsToBox: async (patch) => { syncs.push(patch); return { ...patch }; },
    delay: async () => {},
  };
  const handlers = mainEdge.createMainEdgeHandlers(deps);
  return { store, handlers, syncs };
}

test("changing the endpoint clears every bot's pinned model/effort and syncs the empty maps", async () => {
  const { store, handlers, syncs } = setup({
    seedModels: { "bot-a": "zai/glm-5.3-flash", "bot-b": "opencode-go/muse-spark-1.3-contributor" },
    seedEfforts: { "bot-a": "ultra", "bot-c": "xhigh" },
    persistedBaseUrl: "https://api.minimax.cn/v1",
  });
  const result = await handlers.setOpenRouterBaseUrl({ baseUrl: "https://api.minimax.cn/v1/" });
  assert.equal(result.resetAgents, 3, "bot-a/b/b-c 并集为 3");
  assert.deepEqual(store.getOpenRouterAgentModels(), {}, "Mac 侧专属模型已清空");
  assert.deepEqual(store.getOpenRouterAgentEfforts(), {}, "Mac 侧专属强度已清空");
  const last = syncs.at(-1);
  // 同步补丁携带 trim 后的原始输入；去尾斜杠规范化发生在 settings-store（与既有契约一致）
  assert.equal(last.openRouterBaseUrl, "https://api.minimax.cn/v1/");
  assert.deepEqual(last.openRouterAgentModels, {}, "容器侧整表替换为空（host 语义：字段存在即替换）");
  assert.deepEqual(last.openRouterAgentEfforts, {});
});

test("saving the same endpoint leaves per-bot pins untouched and reports zero", async () => {
  const { store, handlers, syncs } = setup({
    seedModels: { "bot-a": "zai/glm-5.3-flash" },
    seedEfforts: { "bot-a": "ultra" },
    persistedBaseUrl: "https://api.minimax.cn/v1",
  });
  const result = await handlers.setOpenRouterBaseUrl({ baseUrl: "https://api.minimax.cn/v1" });
  assert.equal(result.resetAgents, 0);
  assert.deepEqual(store.getOpenRouterAgentModels(), { "bot-a": "zai/glm-5.3-flash" }, "未换端点不清配置");
  assert.deepEqual(store.getOpenRouterAgentEfforts(), { "bot-a": "ultra" });
  assert.equal(syncs.at(-1).openRouterAgentModels, undefined, "同步补丁不带 agent 字段");
  assert.equal(syncs.at(-1).openRouterAgentEfforts, undefined);
});

test("clearing the override (back to cloud default) also counts as an endpoint change", async () => {
  const { store, handlers } = setup({
    seedModels: { "bot-a": "zai/glm-5.3-flash" },
    persistedBaseUrl: "https://api.minimax.cn/v1",
  });
  const result = await handlers.setOpenRouterBaseUrl({ baseUrl: null });
  assert.equal(result.resetAgents, 1);
  assert.deepEqual(store.getOpenRouterAgentModels(), {});
  assert.equal(result.baseUrlOverride, null);
});

test("no pins: endpoint change resets nothing and the sync patch stays minimal", async () => {
  const { handlers, syncs } = setup({ persistedBaseUrl: "https://old.example/v1" });
  const result = await handlers.setOpenRouterBaseUrl({ baseUrl: "https://api.minimax.cn/v1" });
  assert.equal(result.resetAgents, 0);
  assert.deepEqual(syncs.at(-1), { openRouterBaseUrl: "https://api.minimax.cn/v1" });
});
