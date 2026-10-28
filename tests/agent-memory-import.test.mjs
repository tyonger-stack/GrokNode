import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { parse } from "acorn";
import {
  COMPONENT_SOURCE,
  EXPORT_PROMPT,
  IMPORT_MAX_CHARS,
  INSTRUCTIONS,
  OFFICIAL_MANIFEST,
  SA_CHILDREN_AFTER,
  VISIBLE_TEXT_EN,
  VISIBLE_TEXT_ZH,
  patchOriginalSettingsGeneral,
} from "../scripts/lib/memory-import-0770-renderer-patch.mjs";

const MAIN_EDGE_PATH = new URL("../source/electron-main/main-edge.ts", import.meta.url).pathname;
const PRELOAD_PATH = new URL("../source/electron-preload/preload.ts", import.meta.url).pathname;
const RPC_TABLE_PATH = new URL("../source/shared/rpc/main.ts", import.meta.url).pathname;
const SHARED_PATH = new URL("../source/shared/node/agent-memory-import.ts", import.meta.url).pathname;
const CLEAN_BUILD_PATH = new URL("../scripts/clean-build.mjs", import.meta.url).pathname;
const OFFICIAL_PROMPT_PATH = new URL("../../rea-grokbot-0770/import/export-prompt.txt", import.meta.url).pathname;
// Sibling 0.77.0 snapshot evidence (rea-grokbot-0770/) is not checked out on CI runners.
const officialPromptSkip = existsSync(OFFICIAL_PROMPT_PATH)
  ? false
  : "rea-grokbot-0770 snapshot evidence is not present on this machine";

const mainEdge = await readFile(MAIN_EDGE_PATH, "utf8");
const preload = await readFile(PRELOAD_PATH, "utf8");
const rpcTable = await readFile(RPC_TABLE_PATH, "utf8");
const shared = await readFile(SHARED_PATH, "utf8");
const cleanBuild = await readFile(CLEAN_BUILD_PATH, "utf8");

/** Import the shared TS module (esbuild to temp ESM) so the contract comparison is real. */
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

test("提示词契约：官方 0.77.0 模型文本（可见行 + imported_memory 围栏 + 编号指令）", async () => {
  const mod = await loadShared();
  assert.equal(mod.IMPORT_MEMORY_MAX_CHARS, 100_000, "official cap is rhe=1e5");
  const visible = "添加这些来自我另一个 AI 助手的记忆";
  const prompt = mod.buildImportMemoryPrompt({ exported: "  ## Instructions\n- Keep replies short.  ", visibleText: visible });
  assert.ok(prompt.startsWith(`${visible}\n\n<imported_memory>\n## Instructions`), "visible line first, export fenced and trimmed");
  assert.ok(prompt.includes("\n</imported_memory>\n\n<memory_import_instructions>\n"), "instruction block opens after the fence");
  assert.ok(prompt.endsWith("</memory_import_instructions>"), "instruction block closes the turn");
  assert.match(prompt, /\n1\. The block above is an export the user pasted/, "instructions are numbered from 1");
  assert.equal(prompt.match(/<imported_memory>/g).length, 1, "exactly one opening fence");
  assert.throws(() => mod.buildImportMemoryPrompt({ exported: "   ", visibleText: visible }), /empty/, "blank export must throw");
  assert.throws(
    () => mod.buildImportMemoryPrompt({ exported: "x".repeat(100_001), visibleText: visible }),
    /too long/,
    "over-limit export must throw",
  );
  const rich = JSON.parse(mod.buildImportMemoryRichText(visible));
  assert.deepEqual(rich, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: visible }] }] }, "richText is the official TipTap paragraph doc");
});

test("官方导出提示词逐字节对齐 0.77.0 产物（nhe 提取件）", { skip: officialPromptSkip }, async () => {
  const mod = await loadShared();
  const official = (await readFile(OFFICIAL_PROMPT_PATH, "utf8")).replace(/\n$/, "");
  assert.equal(mod.IMPORT_MEMORY_EXPORT_PROMPT, official, "shared module must carry the verbatim official export prompt");
  assert.equal(EXPORT_PROMPT, mod.IMPORT_MEMORY_EXPORT_PROMPT, "patch module mirrors the shared export prompt byte for byte");
  assert.equal(mod.IMPORT_MEMORY_VISIBLE_TEXT.en, VISIBLE_TEXT_EN);
  assert.equal(mod.IMPORT_MEMORY_VISIBLE_TEXT.zh, VISIBLE_TEXT_ZH);
  assert.deepEqual([...mod.IMPORT_MEMORY_INSTRUCTIONS], INSTRUCTIONS);
});

test("工具契约措辞：指令映射到本机 UpdateMemory（memory_type shared_*），非官方 scope/tier 字面量", () => {
  const joined = INSTRUCTIONS.join("\n");
  assert.match(joined, /memory_type "shared_profile" or "shared_journal"/, "user-scope wording maps to our memory_type values");
  assert.doesNotMatch(joined, /scope "user"/, "official scope literal must not survive untranslated");
  assert.doesNotMatch(joined, /tier "/, "official tier literal must not survive untranslated");
  assert.match(joined, /Settings → General → Import/, "the 'paste the rest' pointer names the local surface");
  assert.match(joined, /never save passwords, API keys, card numbers/, "secrets rule stays verbatim");
});

test("注入源为逐字官方段（O77 命名空间 + 编译器缓存），且可独立解析（chunk 运行时桩）", () => {
  // The body is verbatim official minified code (backticks are legal module syntax);
  // the hand-written RImportDialog revision must be gone.
  assert.ok(COMPONENT_SOURCE.includes("function O77ImportDialog("), "official Tr present");
  assert.ok(COMPONENT_SOURCE.includes("react.memo_cache_sentinel"), "official compiler-cached segments present");
  assert.equal(COMPONENT_SOURCE.includes("RImportDialog"), false, "hand-written dialog is gone");
  assert.equal(COMPONENT_SOURCE.includes("Gt.Root"), false, "old Gt dialog chrome is gone");
  assert.ok(OFFICIAL_MANIFEST.length >= 80, `official segments recorded (got ${OFFICIAL_MANIFEST.length})`);
  for (const seg of OFFICIAL_MANIFEST) {
    assert.ok(seg.sha && seg.src && seg.official, "every segment carries provenance");
  }
  const harness = [
    "const a={},de={},H={c:n=>new Array(n).fill(Symbol.for('react.memo_cache_sentinel'))},re={},ie={},se={},je=()=>null,Ds=({children})=>children,RLocT=(e,z)=>z,navigator={},setTimeout=()=>0,window={};",
    COMPONENT_SOURCE,
    "export{RImportSection};",
  ].join("\n");
  assert.doesNotThrow(() => parse(harness, { ecmaVersion: "latest", sourceType: "module" }));
});

test("锚点：导入区挂在 Sa children 尾部（router 输出锚点）；官方体自带全部依赖，无注册表导入改写", () => {
  const generalFixture = 'function RRouterPanel(){}const Q=x==="general"?a.jsx(Te,{children:a.jsx(Sa,{auth:t})}):null;function Sa(s){return a.jsxs("div",{className:n,children:[l,r,i,o]})}';
  const patchedGeneral = patchOriginalSettingsGeneral(generalFixture);
  assert.ok(patchedGeneral.includes("function RImportSection(") && patchedGeneral.includes("function O77ImportDialog("));
  assert.ok(patchedGeneral.includes(SA_CHILDREN_AFTER), "section renders as Sa's last child");
  assert.throws(() => patchOriginalSettingsGeneral(patchedGeneral), /already injected/);
  assert.throws(() => patchOriginalSettingsGeneral("function Sa(s){return null}"), /missing or ambiguous/, "panel without the router output fails closed");
});

test("弃用 v1：旧标签页补丁与注册表条目不得再出现在流水线中", () => {
  assert.equal(cleanBuild.includes("agent-memory-import-renderer-patch"), false, "the v1 tab patch is gone from clean-build");
  assert.ok(cleanBuild.includes("applyOriginalRendererMemoryImport0770"), "the 0770 patch is wired");
  assert.equal(cleanBuild.includes('{id:"memory"'), false, "no memory settings tab is registered anywhere in the pipeline");
});

test("main-edge importAgentMemory：转发渲染端组合好的 turn（prompt+richText），同一 sendPrompt 通道", () => {
  assert.ok(mainEdge.includes("importAgentMemory: async (raw) =>"), "handler must exist");
  assert.match(mainEdge, /GATEWAY_API_PREFIX}\/sendPrompt/, "must POST the gateway sendPrompt route");
  assert.match(mainEdge, /GATEWAY_AUTH_SCHEME} \$\{connection\.token\}/, "must authenticate with the gateway token");
  assert.match(mainEdge, /clientNonce: `memory-import-/, "must carry an import-scoped nonce");
  assert.match(mainEdge, /IMPORT_MEMORY_MAX_CHARS/, "must enforce the paste cap");
  assert.match(mainEdge, /richText === undefined \? \{\} : \{ richText \}/, "richText rides along only when present");
  assert.match(mainEdge, /startLocalDockerBox\(String\(Reflect\.get\(deps\.settingsStore, "settingsPath"\)\)\)/, "must reuse the connector's single-flight gateway connection");
  assert.doesNotMatch(mainEdge, /buildImportMemoryPrompt\(/, "composition moved to the renderer; the edge only forwards");
});

test("接线：rpc 方法表 + preload 桥（可选 richText 参与请求形状）", () => {
  assert.ok(rpcTable.includes('importAgentMemory: { args: "object" }'));
  assert.ok(
    preload.includes('importAgentMemory: (agentId: string, prompt: string, richText?: string) => edge("importAgentMemory", { agentId, prompt, ...(richText === undefined ? {} : { richText }) })'),
    "preload forwards prompt plus optional richText",
  );
  assert.match(COMPONENT_SOURCE, /getMainAgent\(\)/, "the wiring resolves the receiving main bot itself");
  assert.match(COMPONENT_SOURCE, /importAgentMemory\(req.agentId,req.prompt,req.richText\)/, "submit sends the official composed turn through the bridge");
  assert.match(COMPONENT_SOURCE, /9A\+Hw8/, "missing main bot surfaces the official hint id");
});

test("流水线顺序：router 之后、i18n pass 之前", () => {
  const router = cleanBuild.indexOf("await applyOriginalRendererRouterPatch({ stageRoot })");
  const memory = cleanBuild.indexOf("await applyOriginalRendererMemoryImport0770({ stageRoot })");
  assert.ok(router >= 0 && memory > router, "import patch must run after the router patch (it anchors on its output)");
  assert.ok(cleanBuild.indexOf("await applyOriginalRendererSettingsI18n(") > memory, "import patch must run before settings-i18n appends the RLocT runtime");
});

test("产物语法与绑定：真实 settings chunk 与导入入口", async t => {
  const archive = '/Applications/Grok Node.app/Contents/Resources/app.asar';
  if (await stat(archive).catch(error => { if (error.code === 'ENOENT') return null; throw error; }) == null) return t.skip('installed settings artifact unavailable');
  const { extractFile } = await import('@electron/asar');
  const panel = extractFile(archive, 'dist/renderer/assets/index-BlqerJhg.js').toString();
  // The INSTALLED app still carries the v1 tab injection; the 0770 patch only requires the
  // router-output anchors (Sa anchor, Sa children), which v1 never touched. The verbatim
  // body binds the panel chunk's own locals (de/a/H/je/Ds/se/re/ie) — no import rewrite.
  let patchedPanel = panel.includes('function RImportSection(') ? panel : patchOriginalSettingsGeneral(panel);
  assert(patchedPanel.includes(SA_CHILDREN_AFTER));
  const ast = parse(patchedPanel, { ecmaVersion: 'latest', sourceType: 'module' });
  const imported = new Set(ast.body.flatMap(node => node.type === 'ImportDeclaration' ? node.specifiers.map(specifier => specifier.local.name) : []));
  for (const name of ['a', 'de', 'H', 'je', 'Ds', 'se', 're', 'ie']) assert(imported.has(name), 'missing settings binding: ' + name);
});
