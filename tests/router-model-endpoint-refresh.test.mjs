import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMPONENT_SOURCE, patchOriginalSettingsRegistry } from "../scripts/lib/router-renderer-patch.mjs";

// 修复背景（2026-10-03）：TokenHub（OpenRouter 档）换 API 地址后模型下拉不重新拉取——
// 主进程 listOpenRouterProxyModels 硬编码 `Bearer local-proxy`，对真实端点（如
// https://api.minimax.cn/v1）401 后静默回退本地 opencodex 目录；且模型卡片是纯下拉，
// 无法手填。本补丁在渲染层走 preload 新桥 fetchEndpointModels（Node 上下文、密钥不出
// preload），加「重新拉取」按钮与「自定义模型…」输入，并在显式刷新/换端点时自愈陈旧选中。

// —— 极简 React 替身 ——————————————————————————————————————————————
// 关键语义：每次渲染重建 effect 闭包（effect 捕获当帧 state 快照）；useState 槽位持久、
// 游标每帧复位；hook 返回的 pick/save/refresh 闭包只依赖 setter（跨帧有效）。
function mountHook({ desktop, provider = "openrouter" }) {
  const states = [];
  let cursor = 0;
  let effects = [];
  const de = {
    useState(init) {
      const slot = cursor;
      if (states[slot] === undefined) states[slot] = typeof init === "function" ? init() : init;
      cursor += 1;
      return [states[slot], (updater) => { states[slot] = typeof updater === "function" ? updater(states[slot]) : updater; }];
    },
    useEffect(fn) { effects.push(fn); },
  };
  const { RRouterOpenRouterModel } = loadComponents({ RLocT: zhT, de, a, window: { desktop }, ...stubs });
  const runtime = {
    // 返回当帧 [state, pick, saveEndpoint, refresh]；state 是快照，读最新值用 runtime.state。
    render() { cursor = 0; effects = []; return RRouterOpenRouterModel(provider); },
    get state() { return states[0]; },
    set state(value) { states[0] = value; },
    mountEffect: () => effects[0](),
    updateEffect: () => effects[1](),
  };
  return runtime;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function pump(runtime, { maxRounds = 12 } = {}) {
  let previous = "";
  for (let round = 0; round < maxRounds; round += 1) {
    await flush();
    await flush();
    runtime.render();
    await runtime.updateEffect();
    await flush();
    const snapshot = JSON.stringify(runtime.state);
    if (snapshot === previous) return;
    previous = snapshot;
  }
  assert.fail("hook state did not settle");
}

async function settle(runtime) {
  runtime.render();
  await runtime.mountEffect();
  await pump(runtime);
}

// 帧驱动（组件）：useState 槽位持久、游标每帧复位——模拟 React 逐帧调用函数组件。
function makeFrameDe() {
  const states = [];
  let cursor = 0;
  const de = {
    useState(init) {
      const slot = cursor;
      if (states[slot] === undefined) states[slot] = typeof init === "function" ? init() : init;
      cursor += 1;
      return [states[slot], (updater) => { states[slot] = typeof updater === "function" ? updater(states[slot]) : updater; }];
    },
    useEffect() {},
  };
  return { de, frame(renderFn) { cursor = 0; return renderFn(); } };
}

function findAll(node, predicate, out = []) {
  if (node == null || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  const children = node.props?.children;
  if (Array.isArray(children)) for (const child of children) findAll(child, predicate, out);
  else findAll(children, predicate, out);
  return out;
}

const a = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
};
const stubs = {
  ie: (props) => ({ name: "ie", props }),
  ye: (props) => ({ name: "ye", props }),
  se: (props) => ({ name: "se", props }),
  oe: (props) => ({ name: "oe", props }),
  re: (props) => ({ name: "re", props }),
  Te: (props) => ({ name: "Te", props }),
  k: (...parts) => parts.join(" "),
};
const zhT = (en, zh) => zh ?? en;

function makeDesktop(overrides = {}) {
  const calls = [];
  const desktop = {
    agent: {
      getOpenRouterModelOptions: async () => ({
        models: ["AICodeMirrorCodex/gpt-6-astra", "minimax-cn/MiniMax-M3.1-Flash-Preview"],
        selected: "minimax-cn/MiniMax-M3.1-Flash-Preview",
        baseUrl: "https://api.minimax.cn/v1",
        error: null,
      }),
      setOpenRouterModel: async (model) => { calls.push(["setOpenRouterModel", model]); return { model }; },
      setOpenRouterBaseUrl: async (value) => { calls.push(["setOpenRouterBaseUrl", value]); return { baseUrl: value ?? null }; },
    },
    fetchEndpointModels: async () => ({ models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"], error: null }),
    ...overrides,
  };
  return { desktop, calls };
}

// 注入源按测试绑定实例化（hook 的 de/window 是词法捕获，必须每个测试自己注入）。
function loadComponents(bindings) {
  return new Function(
    "RLocT", "de", "a", "window", "se", "ie", "ye", "oe", "k", "re", "Te",
    `${COMPONENT_SOURCE}\nreturn { RRouterOpenRouterModel, RRouterMergeEndpointModels, RRouterModelCard, RRouterCustomSentinel };`,
  )(
    bindings.RLocT ?? undefined, bindings.de, bindings.a, bindings.window,
    bindings.se, bindings.ie, bindings.ye, bindings.oe, bindings.k, bindings.re, bindings.Te,
  );
}

// —— 注入源的结构门 ————————————————————————————————————————————————
test("injected source compiles, stays backtick-free, and keeps panel wiring", () => {
  assert.ok(!COMPONENT_SOURCE.includes("`"), "注入源不得含反引号（String.raw 提前闭合教训）");
  assert.ok(COMPONENT_SOURCE.startsWith("\nfunction RRouterLoc"));
  assert.doesNotMatch(COMPONENT_SOURCE, /\(RLocT\(/, "RLocT 不得被多套引号（历史上的整 chunk 解析失败）");
  assert.equal(typeof patchOriginalSettingsRegistry, "function", "面板注入函数仍存在");
  assert.match(COMPONENT_SOURCE, /\[m,u,g,y\]=RRouterOpenRouterModel\(s\.provider\)/, "面板需解构第四个返回值");
  assert.match(COMPONENT_SOURCE, /RRouterModelCard,\{state:m,pick:u,refresh:y\}/, "refresh 必须接到模型卡片");
  assert.match(COMPONENT_SOURCE, /window\.desktop\.fetchEndpointModels/, "hook 必须走 preload 端点探测桥");
  assert.match(COMPONENT_SOURCE, /await pull\(!0\)/, "保存 API 地址后必须重新拉取并允许自愈");
  assert.match(COMPONENT_SOURCE, /merged\.keep\?stored:heal\?null:stored/, "自愈语义：仅显式刷新/换端点时丢弃陈旧选中");
  // 语法门：真编译才抓得住括号/引号不平衡（AGENTS「RLocT 多套引号」教训）。
  loadComponents({ RLocT: zhT, de: makeFrameDe().de, a, window: { desktop: makeDesktop().desktop }, ...stubs });
});

// —— hook 行为 ————————————————————————————————————————————————————
test("endpoint list wins in endpoint order; fresh null stored auto-picks the first endpoint model", async () => {
  const { desktop, calls } = makeDesktop({
    agent: {
      getOpenRouterModelOptions: async () => ({ models: ["bridge-1", "bridge-2"], selected: null, baseUrl: "https://api.minimax.cn/v1", error: null }),
      setOpenRouterModel: async (model) => { calls.push(["setOpenRouterModel", model]); return { model }; },
      setOpenRouterBaseUrl: async (value) => { calls.push(["setOpenRouterBaseUrl", value]); return { baseUrl: value ?? null }; },
    },
  });
  const runtime = mountHook({ desktop });
  await settle(runtime);
  assert.deepEqual(runtime.state.models, ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"], "真实端点列表应原序胜出（不排序，M3 保持首位）");
  assert.equal(runtime.state.selected, "MiniMax-M3", "无已存模型时自动持久化端点列表首项");
  assert.equal(runtime.state.note, null);
  assert.deepEqual(calls.filter((entry) => entry[0] === "setOpenRouterModel").at(-1), ["setOpenRouterModel", "MiniMax-M3"]);
});

test("mount keeps a stored model the endpoint does not list (no silent clobber on open)", async () => {
  const { desktop, calls } = makeDesktop(); // bridge selected = 目录幻影
  const runtime = mountHook({ desktop });
  await settle(runtime);
  assert.deepEqual(runtime.state.models, ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"], "列表仍是端点真实列表");
  assert.equal(runtime.state.selected, "minimax-cn/MiniMax-M3.1-Flash-Preview", "打开设置不得悄悄改掉已存模型");
  assert.ok(calls.length === 0, "首开对陈旧选中不应有任何持久化调用");
});

test("explicit refresh heals a stale stored model and persists the first endpoint model", async () => {
  const { desktop, calls } = makeDesktop();
  const runtime = mountHook({ desktop });
  await settle(runtime);
  assert.equal(runtime.state.selected, "minimax-cn/MiniMax-M3.1-Flash-Preview", "前置条件：陈旧选中在首开后被保留");
  calls.length = 0;
  const [, , , refresh] = runtime.render();
  refresh();
  await pump(runtime);
  assert.equal(runtime.state.selected, "MiniMax-M3", "显式重新拉取应自愈到端点首项");
  assert.deepEqual(calls.find((entry) => entry[0] === "setOpenRouterModel"), ["setOpenRouterModel", "MiniMax-M3"]);
});

test("saving the endpoint re-pulls, prefers the real list, and heals stale selections", async () => {
  const { desktop, calls } = makeDesktop();
  const runtime = mountHook({ desktop });
  await settle(runtime);
  assert.equal(runtime.state.selected, "minimax-cn/MiniMax-M3.1-Flash-Preview");
  calls.length = 0;
  const [, , saveEndpoint] = runtime.render();
  await saveEndpoint("  https://api.minimax.cn/v1/  ");
  // hook 只做 trim；去尾斜杠的规范化在主进程 settings-store（旧测试 router-settings 的既有契约）。
  assert.deepEqual(calls.find((entry) => entry[0] === "setOpenRouterBaseUrl"), ["setOpenRouterBaseUrl", "https://api.minimax.cn/v1/"]);
  await pump(runtime);
  assert.equal(runtime.state.selected, "MiniMax-M3", "换端点后陈旧选中被自愈");
  assert.deepEqual(runtime.state.models, ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"]);
});

test("saving the endpoint records the per-bot reset count in the card note and survives the re-pull", async () => {
  const { desktop, calls } = makeDesktop({
    agent: {
      getOpenRouterModelOptions: async () => ({ models: ["bridge-1"], selected: null, baseUrl: "https://api.minimax.cn/v1", error: null }),
      setOpenRouterModel: async (model) => { calls.push(["setOpenRouterModel", model]); return { model }; },
      setOpenRouterBaseUrl: async (value) => { calls.push(["setOpenRouterBaseUrl", value]); return { baseUrl: value ?? null, resetAgents: 3 }; },
    },
  });
  const runtime = mountHook({ desktop });
  await settle(runtime);
  const [, , saveEndpoint] = runtime.render();
  await saveEndpoint("https://other.example/v1");
  await settle(runtime);
  assert.match(runtime.state.endpointNote, /已将 3 个 Bot 的专属模型与推理强度恢复为跟随全局/);
  assert.deepEqual(runtime.state.models, ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"], "保存后仍重新拉取真实列表");
});

test("endpoint save without resets leaves no note", async () => {
  const { desktop } = makeDesktop(); // 桩不带 resetAgents
  const runtime = mountHook({ desktop });
  await settle(runtime);
  const [, , saveEndpoint] = runtime.render();
  await saveEndpoint("https://api.minimax.cn/v1");
  await settle(runtime);
  assert.equal(runtime.state.endpointNote, null);
});

test("endpoint probe failure falls back to the bridge list and surfaces a note instead of silence", async () => {
  const { desktop } = makeDesktop({
    fetchEndpointModels: async () => ({ models: [], error: "HTTP 401" }),
  });
  const runtime = mountHook({ desktop });
  await settle(runtime);
  assert.deepEqual(runtime.state.models, ["AICodeMirrorCodex/gpt-6-astra", "minimax-cn/MiniMax-M3.1-Flash-Preview"], "端点失败回退桥接（目录）列表");
  assert.match(runtime.state.note, /端点模型列表不可用/, "失败必须可见，不能再静默");
  assert.equal(runtime.state.selected, "minimax-cn/MiniMax-M3.1-Flash-Preview", "回退列表里有该选中，保持不变");
});

// —— 纯合并函数 ————————————————————————————————————————————————————
test("RRouterMergeEndpointModels: endpoint wins, order kept, note on error, stored kept only when listed", () => {
  const { RRouterMergeEndpointModels: merge } = loadComponents({ RLocT: zhT, de: makeFrameDe().de, a, window: {}, ...stubs });
  const ok = merge("MiniMax-M2.7", ["bridge-1"], { models: ["MiniMax-M3", "MiniMax-M2.7"], error: null });
  assert.deepEqual(ok.models, ["MiniMax-M3", "MiniMax-M2.7"]);
  assert.equal(ok.keep, true);
  assert.equal(ok.note, null);
  const stale = merge("phantom-id", ["bridge-1"], { models: ["MiniMax-M3"], error: null });
  assert.equal(stale.keep, false);
  const failed = merge("bridge-1", ["bridge-1", "bridge-2"], { models: [], error: "HTTP 401" });
  assert.deepEqual(failed.models, ["bridge-1", "bridge-2"]);
  assert.match(failed.note, /端点模型列表不可用/);
  assert.equal(failed.keep, true);
  const noProbe = merge("bridge-1", ["bridge-1"], null);
  assert.deepEqual(noProbe.models, ["bridge-1"]);
  assert.equal(noProbe.note, null);
});

// —— 模型卡片（帧驱动） ——————————————————————————————————————————————
function mountCardHarness(props) {
  const frame = makeFrameDe();
  const comps = loadComponents({ RLocT: zhT, de: frame.de, a, window: {}, ...stubs });
  return { comps, render: () => frame.frame(() => comps.RRouterModelCard(props)) };
}

test("model card prepends an unlisted selected model and offers the custom entry in the dropdown", () => {
  const { comps, render } = mountCardHarness({
    state: { models: ["MiniMax-M3"], selected: "My-Custom-Id", busy: false, note: null, error: null },
    pick: async () => {},
    refresh: () => {},
  });
  const card = render();
  const select = findAll(card, (node) => node.type === stubs.ye)[0];
  assert.ok(select, "有选中/列表时应渲染下拉");
  const values = select.props.options.map((option) => option.value);
  assert.equal(values[0], "My-Custom-Id", "未列出的选中模型要前置显示，不能消失");
  assert.equal(values.at(-1), comps.RRouterCustomSentinel, "下拉末尾提供自定义模型入口");
  assert.ok(values.includes("MiniMax-M3"));
  const refreshButton = findAll(card, (node) => node.type === stubs.oe && typeof node.props.onClick === "function")[0];
  assert.ok(refreshButton, "卡片上有刷新按钮");
  assert.equal(refreshButton.props.children, "重新拉取");
});

test("custom entry flow: picking the sentinel opens the input, Save persists the typed id and closes", async () => {
  const picked = [];
  const frame = makeFrameDe();
  const comps = loadComponents({ RLocT: zhT, de: frame.de, a, window: {}, ...stubs });
  const props = {
    state: { models: ["MiniMax-M3"], selected: "MiniMax-M3", busy: false, note: null, error: null },
    pick: async (id) => { picked.push(id); },
    refresh: () => {},
  };
  const render = () => frame.frame(() => comps.RRouterModelCard(props));
  const frame1 = render();
  const select = findAll(frame1, (node) => node.type === stubs.ye)[0];
  assert.ok(select, "初始为下拉形态");
  select.props.onValueChange(comps.RRouterCustomSentinel); // 选「自定义模型…」
  const frame2 = render();
  const input = findAll(frame2, (node) => node.type === "input")[0];
  assert.ok(input, "进入自定义输入形态");
  assert.equal(input.props["aria-label"], "自定义模型 ID", "输入框有可达性标签");
  input.props.onChange({ currentTarget: { value: "  My-Custom-Id  " } });
  const frame3 = render();
  const saveButton = findAll(frame3, (node) => node.type === stubs.oe && typeof node.props.onClick === "function")
    .find((node) => !node.props.disabled);
  assert.ok(saveButton, "输入非空后保存按钮可用");
  await saveButton.props.onClick();
  assert.deepEqual(picked, ["My-Custom-Id"], "手填 ID 应 trim 后原样持久化（后端 setOpenRouterModel 接受任意非空字符串）");
  const frame4 = render();
  assert.ok(findAll(frame4, (node) => node.type === stubs.ye)[0], "保存后回到下拉形态");
});

// —— preload 桥 ————————————————————————————————————————————————————
test("preload bridge reveals the key internally and never returns it to the renderer", async () => {
  const preload = await readFile(new URL("../source/electron-preload/preload.ts", import.meta.url), "utf8");
  assert.match(preload, /fetchEndpointModels: \(baseUrl: string\)/, "preload 需暴露 fetchEndpointModels");
  assert.match(preload, /sand:secrets-reveal/, "探测在 preload 内自行取密钥");
  assert.match(preload, /key: "OPENROUTER_API_KEY"/);
  assert.match(preload, /authorization: `Bearer \$\{token\}`/, "密钥只进 Authorization 头");
  assert.match(preload, /done\(\[\], null\); return;/, "无密钥（代理模式）静默回退，不报错");
  assert.doesNotMatch(preload, /resolve\(\{ models: token/, "绝不把密钥当返回值");
  assert.match(preload, /node:https/, "Node 上下文请求，绕开页面 CSP connect-src 限制");
});
