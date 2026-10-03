import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { COMPONENT_SOURCE } from "../scripts/lib/agent-model-renderer-patch.mjs";

// 修复背景（2026-10-03 v4）：各 Bot 属性面板的模型下拉走 getAgentOpenRouterModel →
// 主进程 listOpenRouterProxyModels（硬编码 Bearer local-proxy）→ 对真实端点 401 →
// 静默回退 opencodex 目录——换 API 后下拉仍是旧目录内容。修法镜像 Router 面板：
// handler 响应补 baseUrl，渲染层经 preload fetchEndpointModels 让端点真实列表胜出；
// 强度选择同 v2：落盘前 1-token 探测，被拒不落盘并显示可用档位。

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function loadCard(bindings) {
  return new Function(
    "RLocT", "S", "p", "re", "vt", "so", "window",
    `${COMPONENT_SOURCE}\nreturn { RAgentModelCard, RAgentModelDefault };`,
  )(bindings.RLocT, bindings.S, bindings.p, bindings.re, bindings.vt, bindings.so, bindings.window);
}

let runtimeSoType = null;

function makeRuntime({ desktop, agent = { id: "bot-a", isGroup: false } }) {
  const states = [];
  let cursor = 0;
  let effects = [];
  let idc = 0;
  const S = {
    useState(init) {
      const slot = cursor;
      if (states[slot] === undefined) states[slot] = typeof init === "function" ? init() : init;
      cursor += 1;
      return [states[slot], (updater) => { states[slot] = typeof updater === "function" ? updater(states[slot]) : updater; }];
    },
    useEffect(fn) { effects.push(fn); },
    useId() { idc += 1; return `id-${idc}`; },
  };
  const p = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const re = (...parts) => parts.filter(Boolean).join(" ");
  const vt = (props) => ({ type: "vt", props });
  const so = (props) => ({ type: "so", props });
  const card = loadCard({ RLocT: (en, zh) => zh ?? en, S, p, re, vt, so, window: { desktop } });
  runtimeSoType = so;
  const render = () => { cursor = 0; effects = []; return card.RAgentModelCard({ agent }); };
  const runEffects = async () => { await effects[0](); await effects[1](); };
  return {
    render,
    get modelState() { return states[0]; },
    get effortState() { return states[1]; },
    mount: async () => { render(); await runEffects(); },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeDesktop(overrides = {}) {
  const calls = [];
  const desktop = {
    fetchEndpointModels: async (base) => { calls.push(["fetchEndpointModels", base]); return { models: ["MiniMax-M3", "MiniMax-M2.7"], error: null }; },
    probeEffortSupport: async (base, model, effort) => { calls.push(["probe", base, model, effort]); return { ok: true, error: null, allowed: null }; },
    agent: {
      getAgentOpenRouterModel: async (id) => { calls.push(["getAgentOpenRouterModel", id]); return {
        agentId: id, baseUrl: "https://api.minimax.cn/v1",
        selected: null, defaultModel: "MiniMax-M3", provider: "openrouter",
        models: ["AICodeMirrorCodex/gpt-6-astra", "zai/glm-5.3-flash"], error: null,
      }; },
      setAgentOpenRouterModel: async (id, model) => { calls.push(["setAgentOpenRouterModel", id, model]); return { selected: model }; },
      getAgentOpenRouterEffort: async (id) => ({ selected: null, defaultEffort: null, modelDefault: null, options: [], error: null }),
      setAgentOpenRouterEffort: async (id, effort) => { calls.push(["setAgentOpenRouterEffort", id, effort]); return { effort }; },
    },
    ...overrides,
  };
  return { desktop, calls };
}

function findRow(tree, ariaLabel) {
  const stack = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node == null || typeof node !== "object") continue;
    if (node.type === runtimeSoType && node.props?.["aria-label"] === ariaLabel) return node.props;
    const children = node.props?.children;
    if (Array.isArray(children)) stack.push(...children);
    else if (children != null) stack.push(children);
  }
  return null;
}

test("endpoint model list wins over the opencodex catalog fallback, order kept", async () => {
  const { desktop, calls } = makeDesktop();
  const runtime = makeRuntime({ desktop });
  await runtime.mount();
  assert.deepEqual(runtime.modelState.models, ["MiniMax-M3", "MiniMax-M2.7"], "真实端点列表应原序胜出");
  assert.equal(runtime.modelState.baseUrl, "https://api.minimax.cn/v1");
  assert.deepEqual(calls[0], ["getAgentOpenRouterModel", "bot-a"]);
  assert.ok(calls.some((entry) => entry[0] === "fetchEndpointModels"));
});

test("endpoint probe failure keeps the bridge catalog and never blanks the dropdown", async () => {
  const { desktop } = makeDesktop({ fetchEndpointModels: async () => ({ models: [], error: "HTTP 401" }) });
  const runtime = makeRuntime({ desktop });
  await runtime.mount();
  assert.deepEqual(runtime.modelState.models, ["AICodeMirrorCodex/gpt-6-astra", "zai/glm-5.3-flash"], "端点失败回退桥接（目录）列表");
});

test("old preload without the bridge still renders the bridge list (no regression)", async () => {
  const { desktop } = makeDesktop();
  delete desktop.fetchEndpointModels;
  const runtime = makeRuntime({ desktop });
  await runtime.mount();
  assert.deepEqual(runtime.modelState.models, ["AICodeMirrorCodex/gpt-6-astra", "zai/glm-5.3-flash"]);
});

test("codex provider never probes the endpoint", async () => {
  const { desktop } = makeDesktop({
    agent: {
      getAgentOpenRouterModel: async (id) => ({ agentId: id, baseUrl: "https://api.minimax.cn/v1", selected: null, defaultModel: null, provider: "codex", models: [], error: null }),
      setAgentOpenRouterModel: async (id, model) => ({ selected: model }),
      getAgentOpenRouterEffort: async () => ({ selected: null, defaultEffort: null, modelDefault: null, options: [], error: null }),
      setAgentOpenRouterEffort: async (id, effort) => ({ effort }),
    },
  });
  const runtime = makeRuntime({ desktop });
  await runtime.mount();
  assert.ok(!runtime.modelState.baseUrl || runtime.modelState.models.length === 0);
  void runtime;
});

test("an unlisted per-bot model stays visible at the top of the dropdown", async () => {
  const { desktop } = makeDesktop({
    agent: {
      getAgentOpenRouterModel: async (id) => ({ agentId: id, baseUrl: "https://api.minimax.cn/v1", selected: "My-Custom-Id", defaultModel: "MiniMax-M3", provider: "openrouter", models: ["zai/glm-5.3-flash"], error: null }),
      setAgentOpenRouterModel: async (id, model) => ({ selected: model }),
      getAgentOpenRouterEffort: async () => ({ selected: null, defaultEffort: null, modelDefault: null, options: [], error: null }),
      setAgentOpenRouterEffort: async (id, effort) => ({ effort }),
    },
  });
  const runtime = makeRuntime({ desktop });
  await runtime.mount();
  const tree = runtime.render();
  const modelRow = findRow(tree, "Bot 模型");
  assert.ok(modelRow, "模型行存在");
  const values = modelRow.options.map((option) => option.value);
  assert.equal(values[1], "My-Custom-Id", "未列出的专属模型前置显示（第一项是「使用默认」）");
  assert.ok(values.includes("MiniMax-M3") && values.includes("MiniMax-M2.7"));
});

test("effort pick probes the endpoint with the bot's effective model and persists when accepted", async () => {
  const { desktop, calls } = makeDesktop();
  const runtime = makeRuntime({ desktop });
  await runtime.mount();
  const tree = runtime.render();
  const effortRow = findRow(tree, "Bot 推理强度");
  assert.ok(effortRow, "强度行存在");
  await effortRow.onValueChange("max");
  await flush();
  assert.deepEqual(calls.find((entry) => entry[0] === "probe"), ["probe", "https://api.minimax.cn/v1", "MiniMax-M3", "max"], "探测用 baseUrl + 生效模型（无专属模型时回落全局默认）");
  assert.deepEqual(calls.find((entry) => entry[0] === "setAgentOpenRouterEffort"), ["setAgentOpenRouterEffort", "bot-a", "max"]);
});

test("a rejected effort is not persisted and surfaces the allowed list on the effort row", async () => {
  const { desktop, calls } = makeDesktop({
    probeEffortSupport: async () => ({ ok: false, error: 'invalid reasoning_effort: "ultra" (allowed: low, medium, high, xhigh, max)', allowed: ["low", "medium", "high", "xhigh", "max"] }),
  });
  const runtime = makeRuntime({ desktop });
  await runtime.mount();
  const tree = runtime.render();
  const effortRow = findRow(tree, "Bot 推理强度");
  await effortRow.onValueChange("ultra");
  await flush();
  assert.ok(!calls.some((entry) => entry[0] === "setAgentOpenRouterEffort"), "被拒档位绝不能落盘");
  assert.match(runtime.effortState.error, /端点不接受/);
  assert.match(runtime.effortState.error, /可用档位：/);
});

test("model default effort pick is never probed", async () => {
  const { desktop, calls } = makeDesktop();
  const runtime = makeRuntime({ desktop });
  await runtime.mount();
  const tree = runtime.render();
  const effortRow = findRow(tree, "Bot 推理强度");
  await effortRow.onValueChange("__r-agent-model-default__");
  await flush();
  assert.ok(!calls.some((entry) => entry[0] === "probe"));
  assert.deepEqual(calls.find((entry) => entry[0] === "setAgentOpenRouterEffort"), ["setAgentOpenRouterEffort", "bot-a", null]);
});

test("the agent model handler response carries the resolved baseUrl", async () => {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "agent-merge-main-edge.cjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/electron-main/main-edge.ts")],
    bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
    external: ["electron", "node:*"],
  });
  const mainEdge = require(outfile);
  const dir = mkdtempSync(path.join(tmpdir(), "agent-merge-"));
  const settingsFile = path.join(dir, "settings.json");
  writeFileSync(settingsFile, "{}\n");
  const storeOutfile = path.join(repoRoot, "node_modules", ".cache", "agent-merge-store.cjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/shared/node/settings/sand-settings-store.ts")],
    bundle: true, platform: "node", format: "cjs", outfile: storeOutfile, logLevel: "error",
    external: ["node:*"],
  });
  const { SandSettingsStore } = require(storeOutfile);
  const store = new SandSettingsStore(settingsFile);
  store.setOpenRouterBaseUrl("https://api.minimax.cn/v1");
  const handlers = mainEdge.createMainEdgeHandlers({ settingsStore: store, syncHostSettingsToBox: async () => null, delay: async () => {} });
  const result = await handlers.getAgentOpenRouterModel({ agentId: "bot-a" });
  assert.equal(result.baseUrl, "https://api.minimax.cn/v1", "渲染层要靠它探测端点");
  assert.equal(result.agentId, "bot-a");
});

test("spliced source stays backtick-free and wires both bridges", () => {
  assert.ok(!COMPONENT_SOURCE.includes("`"), "注入源不得含反引号");
  assert.ok(COMPONENT_SOURCE.includes("fetchEndpointModels"));
  assert.ok(COMPONENT_SOURCE.includes("probeEffortSupport"));
});
