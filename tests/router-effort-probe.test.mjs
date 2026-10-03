import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMPONENT_SOURCE } from "../scripts/lib/router-renderer-patch.mjs";

// 轻量档位校验（2026-10-03，用户拍板「先轻后重」）：选定推理强度时 preload 先发
// 1-token 请求探测端点是否接受该模型的 reasoning_effort；被拒则不保存并在卡片上
// 展示原因 + 从报错解析出的可用档位列表（MiniMax 400 报错机器可读：
// `invalid reasoning_effort: "ultra" (allowed: low, medium, high, xhigh, max)`）。
// 「模型默认」不发字段，不探测。治本版（host 400 学习+去字段重试）等并行会话的
// provider-session 改动落地后再做。

function loadComponents(bindings) {
  return new Function(
    "RLocT", "de", "a", "window", "se", "ie", "ye", "oe", "k", "re", "Te",
    `${COMPONENT_SOURCE}\nreturn { RRouterOpenRouterEffort, RRouterEffortDefault };`,
  )(
    bindings.RLocT ?? undefined, bindings.de, bindings.a, bindings.window,
    bindings.se, bindings.ie, bindings.ye, bindings.oe, bindings.k, bindings.re, bindings.Te,
  );
}

// —— 极简 React 替身（与 router-model-endpoint-refresh.test.mjs 同款语义）—————
function makeEffortRuntime(hook, { provider, model, baseUrl, desktop }) {
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
  const bound = new Function(
    "RLocT", "de", "a", "window", "se", "ie", "ye", "oe", "k", "re", "Te",
    `${COMPONENT_SOURCE}\nreturn RRouterOpenRouterEffort;`,
  )(
    zhT, de, a, { desktop }, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  );
  void hook;
  return {
    render() { cursor = 0; effects = []; return bound(provider, model, baseUrl); },
    get state() { return states[0]; },
    mountEffect: () => effects[0](),
  };
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
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function mountEffort({ desktop, provider = "openrouter", model = "MiniMax-M3", baseUrl = "https://api.minimax.cn/v1", stored = "low", options = null }) {
  const calls = [];
  const providedProbe = desktop?.probeEffortSupport;
  const rest = { ...(desktop ?? {}) };
  delete rest.probeEffortSupport;
  const fullDesktop = {
    agent: {
      getOpenRouterEffort: async () => ({ effort: stored, options: options ?? [{ value: "low", label: "Low" }, { value: "max", label: "Max" }], modelDefault: "max" }),
      setOpenRouterEffort: async (value) => { calls.push(["setOpenRouterEffort", value]); return { effort: value ?? "model-default" }; },
    },
    ...rest,
    probeEffortSupport: async (base, id, value) => {
      calls.push(["probe", base, id, value]);
      return providedProbe ? providedProbe(base, id, value) : { ok: true, error: null, allowed: null };
    },
  };
  const runtime = makeEffortRuntime(null, { provider, model, baseUrl, desktop: fullDesktop });
  runtime.render();
  await runtime.mountEffect();
  await flush();
  const [, pick] = runtime.render();
  return { runtime, calls, pick, desktop: fullDesktop };
}

test("picking a supported effort probes first, then persists", async () => {
  const { calls, pick, runtime } = await mountEffort({});
  await pick("max");
  await flush();
  assert.deepEqual(calls[0], ["probe", "https://api.minimax.cn/v1", "MiniMax-M3", "max"]);
  assert.deepEqual(calls.at(-1), ["setOpenRouterEffort", "max"]);
  assert.equal(runtime.state.effort, "max");
  assert.equal(runtime.state.error, null);
});

test("picking a rejected effort shows the parsed allowed list and persists nothing", async () => {
  const { calls, pick, runtime } = await mountEffort({
    desktop: {
      probeEffortSupport: async () => ({ ok: false, error: 'invalid params, invalid reasoning_effort: "ultra" (allowed: low, medium, high, xhigh, max)', allowed: ["low", "medium", "high", "xhigh", "max"] }),
    },
  });
  const before = runtime.state.effort;
  await pick("ultra");
  await flush();
  assert.deepEqual(calls[0], ["probe", "https://api.minimax.cn/v1", "MiniMax-M3", "ultra"]);
  assert.ok(!calls.some((entry) => entry[0] === "setOpenRouterEffort"), "被拒档位绝不能落盘");
  assert.match(runtime.state.error, /端点不接受/);
  assert.match(runtime.state.error, /可用档位：/);
  assert.match(runtime.state.error, /low, medium, high, xhigh, max/);
  assert.equal(runtime.state.effort, before, "强度状态保持原值");
});

test("model default is never probed and persists null", async () => {
  const { calls, pick } = await mountEffort({});
  await pick(null); // 面板把「模型默认」归一为 null 再传入
  await flush();
  assert.ok(!calls.some((entry) => entry[0] === "probe"), "模型默认不发字段，无需探测");
  assert.deepEqual(calls.at(-1), ["setOpenRouterEffort", null]);
});

test("without the probe bridge (old preload) the pick persists directly", async () => {
  const { desktop } = { desktop: {} };
  const calls = [];
  const fullDesktop = {
    agent: {
      getOpenRouterEffort: async () => ({ effort: "low", options: [{ value: "low", label: "Low" }], modelDefault: null }),
      setOpenRouterEffort: async (value) => { calls.push(["setOpenRouterEffort", value]); return { effort: value }; },
    },
    // probeEffortSupport 故意缺失
    ...desktop,
  };
  const runtime = makeEffortRuntime(null, { provider: "openrouter", model: "MiniMax-M3", baseUrl: "https://api.minimax.cn/v1", desktop: fullDesktop });
  runtime.render();
  await runtime.mountEffect();
  await flush();
  const [, pick] = runtime.render();
  await pick("high");
  await flush();
  assert.deepEqual(calls, [["setOpenRouterEffort", "high"]], "无桥时退回旧行为，不阻塞保存");
});

test("panel passes the model hook's baseUrl into the effort hook", () => {
  assert.match(COMPONENT_SOURCE, /RRouterOpenRouterEffort\(s\.provider,m\.selected,m\.baseUrl\)/);
  assert.match(COMPONENT_SOURCE, /probeEffortSupport\(baseUrl,model,v\)/);
  assert.ok(!COMPONENT_SOURCE.includes("`"), "注入源不得含反引号");
});

test("preload probe uses a 1-token chat completion, parses the allowed list, never returns the key", async () => {
  const preload = await readFile(new URL("../source/electron-preload/preload.ts", import.meta.url), "utf8");
  assert.match(preload, /probeEffortSupport: \(baseUrl: string, model: string, effort: string\)/);
  assert.match(preload, /chat\/completions/);
  assert.match(preload, /max_tokens: 1/);
  assert.match(preload, /reasoning_effort: value/);
  assert.match(preload, /allowed:\\s\*\(\[\^\)\]\+\)/i, "从报错解析 allowed 列表");
  assert.match(preload, /done\(true, null, null\); return;/, "无密钥（代理模式）放行不阻塞");
  assert.doesNotMatch(preload, /resolve\(\{ ok, error, allowed: token/);
});
