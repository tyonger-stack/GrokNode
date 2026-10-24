import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { parse } from "acorn";
import {
  COMPONENT_SOURCE,
  MEMORY_MAX_CHARS,
  MEMORY_TEMPLATE,
  PANEL_SWITCH_AFTER,
  REGISTRY_AFTER,
  REQUIRED_CHUNK_BINDINGS,
  patchOriginalSettingsPanel,
  patchOriginalSettingsRegistry,
} from "../scripts/lib/agent-memory-import-renderer-patch.mjs";

const MAIN_EDGE_PATH = new URL("../source/electron-main/main-edge.ts", import.meta.url).pathname;
const PRELOAD_PATH = new URL("../source/electron-preload/preload.ts", import.meta.url).pathname;
const RPC_TABLE_PATH = new URL("../source/shared/rpc/main.ts", import.meta.url).pathname;
const SHARED_PATH = new URL("../source/shared/node/agent-memory-import.ts", import.meta.url).pathname;
const CLEAN_BUILD_PATH = new URL("../scripts/clean-build.mjs", import.meta.url).pathname;

const mainEdge = await readFile(MAIN_EDGE_PATH, "utf8");
const preload = await readFile(PRELOAD_PATH, "utf8");
const rpcTable = await readFile(RPC_TABLE_PATH, "utf8");
const shared = await readFile(SHARED_PATH, "utf8");
const cleanBuild = await readFile(CLEAN_BUILD_PATH, "utf8");

/** Import the shared TS module (esbuild to temp ESM) so the template comparison is real. */
async function loadShared() {
  const dir = await mkdtemp(path.join(tmpdir(), "mem-shared-"));
  const out = path.join(dir, "shared.mjs");
  await build({ entryPoints: [SHARED_PATH], bundle: true, format: "esm", target: "es2022", outfile: out, logLevel: "silent" });
  try {
    return await import(out);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

test("提示词构建：蒸馏契约（UpdateMemory write/profile + 快照围栏 + 拒空）", async () => {
  const mod = await loadShared();
  assert.match(shared, /UpdateMemory 工具（action "write"，memory 类型 "profile"）/, "prompt must direct the bot at UpdateMemory write/profile");
  assert.ok(shared.includes("<快照开始>") && shared.includes("<快照结束>"));
  assert.match(shared, /IMPORT_MEMORY_MAX_CHARS = 64 \* 1024/, "paste cap is 64 KB");
  const prompt = mod.buildImportMemoryPrompt("  ## 身份信息\n- 用户在 UTC+8。  ");
  assert.ok(prompt.includes("<快照开始>\n## 身份信息"), "snapshot is trimmed and fenced");
  assert.ok(prompt.includes("<快照结束>"));
  assert.throws(() => mod.buildImportMemoryPrompt("   "), /empty/, "blank snapshot must throw");
});

test("模板单一来源：补丁模块与共享模块的模板逐字节一致", async () => {
  const mod = await loadShared();
  assert.equal(MEMORY_TEMPLATE, mod.IMPORT_MEMORY_TEMPLATE);
  assert.equal(MEMORY_MAX_CHARS, mod.IMPORT_MEMORY_MAX_CHARS);
});

test("注入源无反引号/模板语法，且可独立解析（chunk 运行时桩）", () => {
  assert.equal(COMPONENT_SOURCE.includes("`"), false);
  assert.equal(COMPONENT_SOURCE.includes("${"), false);
  const harness = `const a={},de={},Te={},re={},ie={},se={},oe={},k=()=>"",RLocT=(e,z)=>z,navigator={};\n${COMPONENT_SOURCE}\nexport{RMemoryPanel};`;
  assert.doesNotThrow(() => parse(harness, { ecmaVersion: "latest", sourceType: "module" }));
});

test("面板状态映射：文本/状态/主Bot 各归其位（r 不再承担文本职责）", () => {
  assert.match(COMPONENT_SOURCE, /const\[s,e\]=de\.useState\(""\)/);          // text
  assert.match(COMPONENT_SOURCE, /,\[r,i\]=de\.useState\(null\)/);
  assert.match(COMPONENT_SOURCE, /,\[o,l\]=de\.useState\(void 0\)/);
  assert.match(COMPONENT_SOURCE, /if\(snapshot\.length===0\)/, "empty check reads the trimmed snapshot");
  assert.match(COMPONENT_SOURCE, /importAgentMemory\(mainId,snapshot\)/, "send uses the freshly resolved main agent");
  assert.match(COMPONENT_SOURCE, /value:s}/, "textarea is controlled by the TEXT state");
  assert.match(COMPONENT_SOURCE, /children:r\.message/, "status line renders the STATUS message");
  assert.match(COMPONENT_SOURCE, /maxLength:\d+/, "textarea carries the paste cap");
});

test("设置注册与面板开关：记忆插在 Router 与 Usage 之间，锚在 router 补丁的输出上", () => {
  assert.ok(REGISTRY_AFTER.includes('{id:"memory"') && REGISTRY_AFTER.indexOf('"router"') < REGISTRY_AFTER.indexOf('"memory"') && REGISTRY_AFTER.indexOf('"memory"') < REGISTRY_AFTER.indexOf('"usage"'));
  assert.ok(PANEL_SWITCH_AFTER.includes('x==="memory"?a.jsx(RMemoryPanel,{})'));
  const registryFixture = 'const wDn=[{id:"general",label:"General",icon:"settings-gear"},{id:"router",label:(typeof RLocT==="function"?RLocT("Router","路由"):"Router"),icon:"git-branch"},{id:"usage",label:"Usage & Billing",icon:"chart-bars"}]';
  const patchedRegistry = patchOriginalSettingsRegistry(registryFixture);
  assert.ok(patchedRegistry.includes('{id:"memory",label:(typeof RLocT==="function"?RLocT("Import","导入"):"Import"),icon:"bookmark"}'));
  assert.throws(() => patchOriginalSettingsRegistry(patchedRegistry), /already registered/);
  const bareFixture = 'function Sa(s){return null}';
  assert.throws(() => patchOriginalSettingsPanel(bareFixture), /router patch/, "must fail closed without the router panel present");
  const panelFixture = 'function RRouterPanel(){}const Q=x==="general"?a.jsx(Sa,{}):x==="router"?a.jsx(RRouterPanel,{}):null;function Sa(s){return null}';
  const patchedPanel = patchOriginalSettingsPanel(panelFixture);
  assert.ok(patchedPanel.includes("function RMemoryPanel("));
  assert.ok(patchedPanel.includes(':x==="memory"?a.jsx(RMemoryPanel,{})'));
  assert.throws(() => patchOriginalSettingsPanel(patchedPanel), /already injected/);
});

test("main-edge importAgentMemory：与聊天同一条 sendPrompt 通道", () => {
  assert.ok(mainEdge.includes("importAgentMemory: async (raw) =>"), "handler must exist");
  assert.match(mainEdge, /GATEWAY_API_PREFIX}\/sendPrompt/, "must POST the gateway sendPrompt route");
  assert.match(mainEdge, /GATEWAY_AUTH_SCHEME} \$\{connection\.token\}/, "must authenticate with the gateway token");
  assert.match(mainEdge, /clientNonce: `memory-import-/, "must carry an import-scoped nonce");
  assert.match(mainEdge, /IMPORT_MEMORY_MAX_CHARS/, "must enforce the paste cap");
  assert.match(mainEdge, /buildImportMemoryPrompt\(snapshot\)/, "must build the distillation prompt");
  assert.match(mainEdge, /startLocalDockerBox\(String\(Reflect\.get\(deps\.settingsStore, "settingsPath"\)\)\)/, "must reuse the connector's single-flight gateway connection");
});

test("接线：rpc 方法表 + preload 桥（面板经 getMainAgent 取主 Bot）", () => {
  assert.ok(rpcTable.includes('importAgentMemory: { args: "object" }'));
  assert.ok(preload.includes('importAgentMemory: (agentId: string, text: string) => edge("importAgentMemory", { agentId, text })'));
  assert.match(COMPONENT_SOURCE, /getMainAgent\(\)/, "panel resolves the receiving main bot itself");
  assert.match(COMPONENT_SOURCE, /No main Bot is set/, "missing main bot surfaces as a status line");
});

test("流水线顺序：router 之后、i18n pass 之前", () => {
  const router = cleanBuild.indexOf("await applyOriginalRendererRouterPatch({ stageRoot })");
  const memory = cleanBuild.indexOf("await applyOriginalRendererMemoryImport({ stageRoot })");
  assert.ok(router >= 0 && memory > router, "memory patch must run after the router patch (it anchors on its output)");
  assert.ok(cleanBuild.indexOf("await applyOriginalRendererSettingsI18n(") > memory, "memory patch must run before settings-i18n appends the RLocT runtime");
});

test("产物语法与绑定：真实 settings chunk 与导入入口", async t => {
  const archive = '/Applications/Grok Node.app/Contents/Resources/app.asar';
  if (await stat(archive).catch(error => { if (error.code === 'ENOENT') return null; throw error; }) == null) return t.skip('installed settings artifact unavailable');
  const { extractFile } = await import('@electron/asar');
  const registry = extractFile(archive, 'dist/renderer/assets/index-UbX-y3il.js').toString();
  const panel = extractFile(archive, 'dist/renderer/assets/index-BlqerJhg.js').toString();
  const registered = registry.includes('{id:"memory",label:');
  const patchedRegistry = registered ? registry : patchOriginalSettingsRegistry(registry);
  const patchedPanel = panel.includes('function RMemoryPanel(') ? panel : patchOriginalSettingsPanel(panel);
  assert(patchedRegistry.includes('{id:"memory",label:'));
  const order = [patchedRegistry.indexOf('{id:"router"'), patchedRegistry.indexOf('{id:"memory"'), patchedRegistry.indexOf('{id:"usage"')];
  assert(order.every(index => index >= 0) && order[0] < order[1] && order[1] < order[2], 'memory must sit between router and usage');
  assert(patchedPanel.includes(PANEL_SWITCH_AFTER));
  const ast = parse(patchedPanel, { ecmaVersion: 'latest', sourceType: 'module' });
  const names = new Set(ast.body.flatMap(node => node.type === 'ImportDeclaration' ? node.specifiers.map(specifier => specifier.local.name) : node.type === 'VariableDeclaration' ? node.declarations.map(declaration => declaration.id.name) : node.type === 'FunctionDeclaration' ? [node.id.name] : []));
  for (const name of REQUIRED_CHUNK_BINDINGS) assert(names.has(name), 'missing settings binding: ' + name);
  parse(patchedRegistry, { ecmaVersion: 'latest', sourceType: 'module' });
});

test("chunk 依赖声明与组件引用一致", () => {
  for (const name of REQUIRED_CHUNK_BINDINGS) {
    assert.ok(COMPONENT_SOURCE.includes(name + "}") || COMPONENT_SOURCE.includes(name + "(") || COMPONENT_SOURCE.includes(name + ",") || COMPONENT_SOURCE.includes(name + ":") || COMPONENT_SOURCE.includes("=" + name) || COMPONENT_SOURCE.includes(" " + name), `${name} must be referenced`);
  }
});
