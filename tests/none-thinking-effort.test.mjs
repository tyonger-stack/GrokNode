import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// 共享层经 esbuild 打包加载(openrouter-proxy 引用编译产物路径,不能直接 import .ts)
const proxyMod = await bundle("source/shared/node/openrouter-proxy.ts", "proxy");
const { effortSupportedByModel, normalizeOpenRouterReasoningEffort, noneThinkingStrategy, openRouterEffortOptionsFor, withDisabledThinkingFetch } = proxyMod;
import { COMPONENT_SOURCE as ROUTER_SOURCE } from "../scripts/lib/router-renderer-patch.mjs";
import { COMPONENT_SOURCE as AGENT_SOURCE } from "../scripts/lib/agent-model-renderer-patch.mjs";
import { readFile } from "node:fs/promises";

// 「无(不思考)」档（2026-10-03 用户拍板）。effort 阶梯加 "none"，按模型分流：
// Flash 系→发 low（实测 low 即不思考）；M3 系→thinking:{type:"disabled"}（fetch 包装注入，
// chat settings 表达不了）；其余→不发（端点不支持关闭）。两个强度下拉（全局 Router 面板 +
// 各 Bot 属性面板）都加「无(不思考)」，preload 探测对 none 用同款分流载荷。


// —— 共享层 ——
test("noneThinkingStrategy: flash→low, M3 line→thinking-disabled, others/empty→unsupported", () => {
  assert.equal(noneThinkingStrategy("MiniMax-M3.1-Flash-Preview"), "effort-low");
  assert.equal(noneThinkingStrategy("minimax-m2.7-highspeed"), "unsupported");
  assert.equal(noneThinkingStrategy("MiniMax-M3"), "thinking-disabled");
  assert.equal(noneThinkingStrategy("MiniMax-M3.2"), "thinking-disabled");
  assert.equal(noneThinkingStrategy("zai/glm-5.3-flash"), "effort-low"); // 非 minimax 的 flash 也走 low（低强度即少思考，不会被 400）
  assert.equal(noneThinkingStrategy("MiniMax-M2.5"), "unsupported");
  assert.equal(noneThinkingStrategy(""), "unsupported");
  assert.equal(noneThinkingStrategy(null), "unsupported");
  assert.equal(noneThinkingStrategy(undefined), "unsupported");
});

test("normalize accepts none; the clamp and option list always keep it", () => {
  assert.equal(normalizeOpenRouterReasoningEffort("none"), "none");
  assert.equal(normalizeOpenRouterReasoningEffort(" NONE "), "none");
  assert.equal(normalizeOpenRouterReasoningEffort("off"), null);
  assert.equal(effortSupportedByModel("none", "zai/glm-5.3-flash"), "none", "目录认识的模型也放行 none（由策略分流）");
  const options = openRouterEffortOptionsFor("MiniMax-M3");
  assert.equal(options[0].value, "none");
  assert.ok(options.some((entry) => entry.value === "low"));
});

test("withDisabledThinkingFetch injects thinking:{type:\"disabled\"} into JSON chat bodies only", async () => {
  const seen = [];
  const fake = async (input, init) => { seen.push(init?.body); return new Response("{}", { status: 200 }); };
  const wrapped = withDisabledThinkingFetch(fake);
  await wrapped("https://x/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "MiniMax-M3", messages: [] }) });
  await wrapped("https://x/v1/chat/completions", { method: "POST", body: "not-json" });
  await wrapped("https://x/v1/models", { method: "GET" });
  await wrapped("https://x/v1/chat/completions", { method: "POST", body: JSON.stringify({ thinking: { type: "enabled" } }) });
  const first = JSON.parse(seen[0]);
  assert.deepEqual(first.thinking, { type: "disabled" }, "chat body 必须被注入");
  assert.equal(seen[1], "not-json", "非 JSON 原样透传");
  assert.equal(seen[2], undefined, "GET 无 body 不动");
  assert.deepEqual(JSON.parse(seen[3]).thinking, { type: "enabled" }, "已有 thinking 不覆盖");
});

// —— host:provider-session 按 none 分流 ——
async function bundle(entry, name, plugins = []) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", `none-${name}.cjs`);
  await build({ entryPoints: [path.join(repoRoot, entry)], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error", external: ["node:*"], plugins });
  return require(outfile);
}

const captured = { createOpenAIOptions: [], chatCalls: [] };
globalThis.__noneCapture = captured;
const stubOpenAI = {
  name: "stub-ai-sdk-openai-none",
  setup(b) {
    b.onResolve({ filter: /^@ai-sdk\/openai$/ }, () => ({ path: "stub-openai", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "exports.createOpenAI = (opts) => { globalThis.__noneCapture.createOpenAIOptions.push(opts); return { chat(id, settings) { globalThis.__noneCapture.chatCalls.push({ id, settings }); throw new Error('stub chat'); } }; };",
      loader: "js",
    }));
  },
};

const session = await bundle("source/host/extensions/inference/provider-session.ts", "session", [stubOpenAI]);
const storeMod = await bundle("source/shared/node/settings/sand-settings-store.ts", "store");
const home = mkdtempSync(path.join(tmpdir(), "none-effort-home-"));
const dataRoot = mkdtempSync(path.join(tmpdir(), "none-effort-"));
process.env.HOME = home;
process.env.SAND_DATA_ROOT = dataRoot;
process.env.OPENROUTER_API_KEY = "test-key";
delete process.env.SAND_OPENROUTER_EFFORT;
delete process.env.SAND_OPENROUTER_MODEL;
delete process.env.OPENROUTER_BASE_URL;
const { SandSettingsStore } = storeMod;

function seedModel(modelId) {
  const store = new SandSettingsStore(path.join(dataRoot, "settings.json"));
  store.setOpenRouterModel(modelId);
}

function turnWith(modelId) {
  seedModel(modelId);
  captured.createOpenAIOptions.length = 0;
  captured.chatCalls.length = 0;
  const s = session.createProviderPromptSession("openrouter", { agentId: "bot-a" });
  assert.throws(() => s.getExecutor().stream(undefined), /stub chat/);
  assert.equal(captured.chatCalls[0].id, modelId, "模型确实来自 settings");
}

test("none + Flash family sends reasoning_effort=low and no fetch wrapper", () => {
  process.env.SAND_OPENROUTER_EFFORT = "none";
  try {
    turnWith("MiniMax-M3.1-Flash-Preview");
    assert.deepEqual(captured.chatCalls[0].settings, { reasoningEffort: "low" });
    assert.equal(captured.createOpenAIOptions[0].fetch, undefined);
  } finally { delete process.env.SAND_OPENROUTER_EFFORT; }
});

test("none + M3 family drops chat settings and wraps fetch with thinking:disabled", () => {
  process.env.SAND_OPENROUTER_EFFORT = "none";
  try {
    turnWith("MiniMax-M3");
    assert.equal(captured.chatCalls[0].settings, undefined, "thinking 参数走 fetch 注入,不经 settings");
    assert.equal(typeof captured.createOpenAIOptions[0].fetch, "function");
  } finally { delete process.env.SAND_OPENROUTER_EFFORT; }
});

test("none + unsupported models send no settings and no wrapper (model default)", () => {
  process.env.SAND_OPENROUTER_EFFORT = "none";
  try {
    turnWith("MiniMax-M2.5");
    assert.equal(captured.chatCalls[0].settings, undefined);
    assert.equal(captured.createOpenAIOptions[0].fetch, undefined);
  } finally { delete process.env.SAND_OPENROUTER_EFFORT; }
});

test("a normal effort is unchanged by the none branch", () => {
  process.env.SAND_OPENROUTER_EFFORT = "low";
  try {
    turnWith("MiniMax-M3");
    assert.deepEqual(captured.chatCalls[0].settings, { reasoningEffort: "low" });
    assert.equal(captured.createOpenAIOptions[0].fetch, undefined);
  } finally { delete process.env.SAND_OPENROUTER_EFFORT; }
});

// —— 渲染层与 preload ——
test("both effort ladders offer 无(不思考) first, and the preload probe branches for none", async () => {
  assert.match(ROUTER_SOURCE, /\{value:"none",label:RRouterLoc\("None","无\(不思考\)"\)\}/);
  const agentPatch = await readFile(path.join(repoRoot, "scripts/lib/agent-model-renderer-patch.mjs"), "utf8");
  assert.match(agentPatch, /\{value:"none",label:RLocT\("None","无\(不思考\)"\)\}/);
  const preload = await readFile(path.join(repoRoot, "source/electron-preload/preload.ts"), "utf8");
  assert.match(preload, /value === "none"/, "probe 对 none 分流");
  assert.match(preload, /thinking: \{ type: "disabled" \}/, "M3 系探测带 thinking:disabled");
  assert.ok(!ROUTER_SOURCE.includes("`") && !AGENT_SOURCE.includes("`"), "注入源不得含反引号");
});
