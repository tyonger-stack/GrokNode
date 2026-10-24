// Settings → 记忆 (Memory): the Muse-style "import memory" section. EXPERIMENTAL
// EXTENSION — no upstream equivalent. The pasted snapshot from another assistant is
// distilled by the MAIN bot as an ordinary user turn (dialog distillation, v1): the
// desktop posts /api/sendPrompt with a prompt that tells the bot to extract durable
// facts via its UpdateMemory tool. The import lives in Settings — not on a bot panel —
// because the snapshot describes the USER ("helps the bot understand who I am"), and
// the receiving bot is the main bot (window.desktop.agent.getMainAgent()).
//
// Anchoring. This patch runs AFTER applyOriginalRendererRouterPatch (clean-build order)
// and anchors on its OUTPUT in two chunks:
//   * the settings registry chunk: the wDn array entry list, post-router form — the
//     memory section is spliced in between Router and Usage & Billing;
//   * the settings panel chunk: the x=== section switch, post-router form — the memory
//     panel is appended to the same conditional chain.
// The component source splices before the shared `function Sa(s){` anchor in the panel
// chunk, exactly like the router panel does. i18n mirrors RRouterLoc: RMemLoc delegates
// to the RLocT that settings-i18n-patch appends later and falls back to English.
//
// State mapping inside RMemoryPanel (kept deliberately boring):
//   s=text e=setText · t=busy n=setBusy · r=status i=setStatus · o=mainAgent l=setMain · c=copied u=setCopied

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const REGISTRY_BEFORE =
  ',{id:"router",label:(typeof RLocT==="function"?RLocT("Router","路由"):"Router"),icon:"git-branch"},{id:"usage"';
export const REGISTRY_AFTER =
  ',{id:"router",label:(typeof RLocT==="function"?RLocT("Router","路由"):"Router"),icon:"git-branch"},{id:"memory",label:(typeof RLocT==="function"?RLocT("Import","导入"):"Import"),icon:"bookmark"},{id:"usage"';

export const PANEL_SWITCH_BEFORE =
  ':x==="router"?a.jsx(RRouterPanel,{}):null';
export const PANEL_SWITCH_AFTER =
  ':x==="router"?a.jsx(RRouterPanel,{}):x==="memory"?a.jsx(RMemoryPanel,{}):null';

export const COMPONENT_ANCHOR = "function Sa(s){";

/** Chunk-level identifiers the injected panel relies on (same set RRouterPanel uses). */
export const REQUIRED_CHUNK_BINDINGS = Object.freeze(["a", "de", "Te", "re", "ie", "se", "oe", "k"]);

// Must stay byte-identical to IMPORT_MEMORY_TEMPLATE in
// source/shared/node/agent-memory-import.ts (tests/agent-memory-import.test.mjs guards it).
export const MEMORY_TEMPLATE = [
  "你正在帮助我将背景信息从一个 AI 助手迁移到另一个 AI 助手。",
  "请基于我们过往的对话，整理一份关于我的便携式记忆快照，仅收录你确切掌握的信息。",
  "输出将逐字输入到新 AI 的记忆中，质量优先于完整性。",
  "要求：",
  "1. 使用下列章节标题输出一个 Markdown 区块，无可靠信息的章节直接省略，不要编造占位符：",
  "   ## 身份信息 / ## 职业与工作 / ## 沟通偏好 / ## 经常提及的人 / ## 健康与饮食 / ## 兴趣与爱好 / ## 进行中的项目 / ## 工作风格与价值观 / ## 工具与环境 / ## 其他持久信息",
  "2. 每个要点一句话、第三人称（“用户”、“他/她”），只写事实，不写过渡句。",
  "3. 不确定的信息在要点末尾标注“（推断）”。",
  "4. 忽略一次性陈述（除非明显重要）和敏感信息（健康状况、财务细节、心理健康）。",
  "5. 硬性上限：2000 字。",
].join("\n");

export const MEMORY_MAX_CHARS = 64 * 1024;

// No backticks in COMPONENT_SOURCE: it is spliced into a minified chunk as plain text.
export const COMPONENT_SOURCE = String.raw`function RMemLoc(en,zh){try{return RLocT(en,zh)}catch(_e){return en}}
const RMemoryTemplate=${JSON.stringify(MEMORY_TEMPLATE)};
function RMemoryPanel(){
  const[s,e]=de.useState(""),[t,n]=de.useState(!1),[r,i]=de.useState(null),[o,l]=de.useState(void 0),[c,u]=de.useState(!1);
  const sending=de.useRef(!1),fail=message=>i({kind:"error",message});
  de.useEffect(()=>{let d=!0;const g=window.desktop&&window.desktop.agent;Promise.resolve(g&&typeof g.getMainAgent==="function"?g.getMainAgent():null).then(m=>{if(d)l(typeof m==="string"&&m.length>0?m:null)}).catch(()=>{if(d)l(null)});return()=>{d=!1}},[]);
  const p=async()=>{if(sending.current)return;const snapshot=s.trim();if(snapshot.length===0){fail(RMemLoc("Paste the memory snapshot first.","请先粘贴记忆快照。"));return}
    if(snapshot.length>${MEMORY_MAX_CHARS}){fail(RMemLoc("The memory snapshot is too large.","记忆快照过长，请缩短后再试。"));return}
    const g=window.desktop&&window.desktop.agent;if(!g||typeof g.importAgentMemory!=="function"||typeof g.getMainAgent!=="function"){fail(RMemLoc("Unavailable in this build.","当前构建未开放此功能。"));return}
    if(o==null){fail(RMemLoc("No main Bot is set. Pick one in the sidebar first.","未设置主 Bot，请先在侧栏选择主 Bot。"));return}
    sending.current=!0;n(!0);i(null);
    try{const mainId=await g.getMainAgent();l(typeof mainId==="string"&&mainId.length>0?mainId:null);if(typeof mainId!=="string"||mainId.length===0){fail(RMemLoc("No main Bot is set. Pick one in the sidebar first.","未设置主 Bot，请先在侧栏选择主 Bot。"));return}
      const result=await g.importAgentMemory(mainId,snapshot);if(result&&result.ok===!0){i({kind:"sent",message:RMemLoc("Sent to the main Bot. Distillation is pending; check its chat for the result.","已发送给主 Bot，等待提炼。请在主 Bot 对话中确认写入结果。")});e("")}else fail(RMemLoc("Failed: ","发送失败：")+String(result&&result.reason||RMemLoc("No acknowledgement. Check the chat before retrying.","未收到确认，请先检查主 Bot 对话再重试。")))}catch(error){fail(RMemLoc("Failed: ","发送失败：")+String(error&&error.message||error))}finally{sending.current=!1;n(!1)}};
  const y=()=>{const g=navigator.clipboard;Promise.resolve(g&&typeof g.writeText==="function"?g.writeText(RMemoryTemplate):Promise.reject()).then(()=>{u(!0);setTimeout(()=>u(!1),2500)},()=>{fail(RMemLoc("Copy failed; select the text manually.","复制失败，请手动选择文本复制。"))})};
  return a.jsx(Te,{children:a.jsxs("div",{className:k("sand-settings-general","sand-9f619 sand-78zum5 sand-dt5ytf sand-3qzy4x"),"data-r-memory-import":"",children:[
    a.jsx(re,{title:RMemLoc("Import memory","导入记忆"),children:a.jsx(ie,{description:RMemLoc("Import a memory snapshot from another assistant so the main Bot understands who you are. The Bot distils durable facts into its own memory — this is not a verbatim copy.","从其他 AI 助手导入记忆快照，帮助主 Bot 理解你是谁。Bot 会把持久事实提炼进自己的记忆——这不是逐字副本。"),label:RMemLoc("How it works","工作方式"),variant:"card",children:a.jsxs("div",{className:"sand-9f619 sand-78zum5 sand-dt5ytf",style:{gap:8,width:360},children:[a.jsx("div",{"aria-label":RMemLoc("Memory snapshot prompt","记忆快照提示词"),style:{maxHeight:220,overflowY:"auto",whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0,padding:"8px 10px",borderRadius:8,background:"rgba(128,128,128,0.14)",fontSize:12,lineHeight:1.55,userSelect:"text"},children:RMemoryTemplate}),a.jsx(oe,{onClick:y,shape:"rectangular",size:"sm",variant:"secondary",children:c?RMemLoc("Copied","已复制"):RMemLoc("Copy","复制")})]})})}),
    a.jsx(re,{title:RMemLoc("Paste the snapshot","粘贴快照"),children:a.jsx(ie,{description:o===void 0?RMemLoc("Loading the main Bot…","正在读取主 Bot…"):o==null?RMemLoc("Sends to the main Bot. No main Bot is set yet.","将发送给主 Bot。尚未设置主 Bot。"):RMemLoc("Sends to the main Bot.","将发送给主 Bot。"),label:RMemLoc("Snapshot","记忆快照"),variant:"card",children:a.jsxs("div",{className:"sand-9f619 sand-78zum5 sand-dt5ytf",style:{gap:8,width:360},children:[a.jsx("textarea",{"aria-label":RMemLoc("Memory snapshot","记忆快照"),disabled:t,maxLength:${MEMORY_MAX_CHARS},onChange:m=>{e(m.currentTarget.value);i(null)},placeholder:RMemLoc("Paste the snapshot from the other assistant here…","把其他助手生成的记忆快照粘贴到这里…"),style:{boxSizing:"border-box",width:"100%",minWidth:0,minHeight:140,resize:"vertical",padding:"8px 10px",borderRadius:8,border:"1px solid var(--sand-border,#7777772b)",background:"transparent",color:"inherit",fontFamily:"inherit",fontSize:13,lineHeight:1.55},value:s}),a.jsx(oe,{disabled:t||o==null||s.trim().length===0,onClick:p,shape:"rectangular",size:"sm",variant:"secondary",children:t?RMemLoc("Sending…","发送中…"):RMemLoc("Add memory","添加记忆")})]})})}),
    r?a.jsx(se,{as:"p",role:"status","aria-live":"polite",color:r.kind==="error"?"red":"secondary",size:"sm",children:r.message}):null
  ]})})}
`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalSettingsRegistry(source) {
  if (source.includes('{id:"memory"')) throw new Error("Memory settings section is already registered.");
  return replaceExactlyOnce(source, REGISTRY_BEFORE, REGISTRY_AFTER, "settings registry (post-router)");
}

export function patchOriginalSettingsPanel(source) {
  if (source.includes("function RMemoryPanel(")) throw new Error("Memory settings panel is already injected.");
  if (!source.includes("function RRouterPanel(")) throw new Error("Memory settings panel requires the router patch to run first.");
  let patched = replaceExactlyOnce(source, COMPONENT_ANCHOR, COMPONENT_SOURCE + COMPONENT_ANCHOR, "memory component insertion");
  patched = replaceExactlyOnce(patched, PANEL_SWITCH_BEFORE, PANEL_SWITCH_AFTER, "memory panel switch");
  return patched;
}

export async function applyOriginalRendererMemoryImport({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const registryCandidates = [];
  const panelCandidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(REGISTRY_BEFORE)) registryCandidates.push({ name, target, source });
    if (source.includes(PANEL_SWITCH_BEFORE)) panelCandidates.push({ name, target, source });
  }
  if (registryCandidates.length !== 1 || panelCandidates.length !== 1) {
    throw new Error(`Expected one settings registry and one settings panel chunk (post-router), found ${registryCandidates.length}/${panelCandidates.length}.`);
  }
  const registry = registryCandidates[0];
  const panel = panelCandidates[0];
  const registryPatched = patchOriginalSettingsRegistry(registry.source);
  const panelPatched = patchOriginalSettingsPanel(panel.source);
  await writeFile(registry.target, registryPatched);
  await writeFile(panel.target, panelPatched);
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-memory-import",
    chunks: [
      {
        role: "settings-registry-memory-section",
        path: `dist/renderer/assets/${registry.name}`,
        original: { bytes: Buffer.byteLength(registry.source), sha256: hash(registry.source) },
        patched: { bytes: Buffer.byteLength(registryPatched), sha256: hash(registryPatched) },
      },
      {
        role: "settings-panel-memory-panel",
        path: `dist/renderer/assets/${panel.name}`,
        original: { bytes: Buffer.byteLength(panel.source), sha256: hash(panel.source) },
        patched: { bytes: Buffer.byteLength(panelPatched), sha256: hash(panelPatched) },
      },
    ],
    evidence: {
      upstreamEquivalent: null,
      note: "Experimental extension: Muse-style memory import, Settings-level (about the user, not a bot property). Delivered to the main bot as a distillation turn via /api/sendPrompt; no host change.",
    },
    features: ["experimental-memory-import"],
    transformations: ["settings-registry-appends-memory-section", "settings-panel-appends-memory-panel"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-memory-import-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
