// Read-only bot data cards (soul / memory journal / user profile / audit / workflows),
// injected into the checksum-pinned 0.18 renderer chunk's bot properties panel (h3n).
//
// EXPERIMENTAL EXTENSION — no upstream equivalent in 0.18 or the official 0.62/0.75 apps:
// neither surface exposes the box-side per-bot data files. Like the per-bot model card,
// it exists because the rebuild owns the local box runtime, and it is recorded as such in
// the provenance file (dist/renderer-agent-data-cards-extension.json).
//
// Placement evidence. This patch runs AFTER applyOriginalRendererAgentModel in the
// clean-build pipeline and anchors on that patch's output (the h3n return line that
// already carries RAgentModelCard), appending one more child, RAgentDataCards. The
// component renders five cards built from exactly the card / row / text / control markup
// and atomic classes the Notifications and model cards use. No memo slot is added to h3n
// (same argument as the model card: the card owns its state; element identity stability
// is harmless for state updates).
//
// Data flow: window.desktop.agent.getAgentDataOverview(agentId) /
// getAgentMemoryLog(agentId, month) / getAgentWorkflowContent(slug) → main-edge →
// box/agent-data-reader.ts → `docker exec` reads a FIXED whitelist under
// /home/box/sand-data (agents/<id>/memory/profile.md, agents/<id>/memory/log/*.md,
// user-memory/agents/<id>/profile.md, agents/<id>/audit.jsonl tail, workflows/*/SKILL.md).
// Every read is byte-capped and id/slug/month validated; secrets files are unreachable.
//
// i18n: every label is a direct RLocT("…","…") literal pair so the main-i18n pass (which
// runs AFTER this patch and appends the RLocT runtime) can scan and wrap them — do not
// route these through a helper that hides the literals.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const H3N_RETURN_WITH_MODEL =
  'I=p.jsxs("div",{className:d,children:[E,A,p.jsx(RAgentModelCard,{agent:t})]}),e[28]=E,e[29]=A,e[30]=I';

export const H3N_RETURN_WITH_DATA =
  'I=p.jsxs("div",{className:d,children:[E,A,p.jsx(RAgentModelCard,{agent:t}),p.jsx(RAgentDataCards,{agent:t})]}),e[28]=E,e[29]=A,e[30]=I';

export const H3N_SIGNATURE =
  "function h3n(n){const e=he.c(31),{agent:t,onNameChange:s,onTitleChange:r,onDescriptionChange:i}=n,";

/** Atomic classes copied verbatim from the agent-model patch (proven against the pinned CSS). */
export const CARD_CLASSES = "sand-78zum5 sand-dt5ytf sand-167g77z sand-1y1aw1k sand-y13l1i sand-wib8y2 sand-163pfp sand-4pepcl sand-cq4si4";
export const ROW_CLASSES = "sand-78zum5 sand-6s0dn4 sand-1qughib sand-1v2ro7d sand-1iorvi4 sand-jkvuk6 sand-11iknt3 sand-mzs88n";
export const TEXT_CLASSES = "sand-78zum5 sand-dt5ytf sand-195vfkc sand-euugli";
export const LABEL_CLASSES = "sand-11wthnw sand-1ja60sm sand-1wd3ewq";
export const CONTROL_CLASSES = "sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-78zum5 sand-6s0dn4";

export const REUSED_CLASSES = Object.freeze(
  [...new Set([CARD_CLASSES, ROW_CLASSES, TEXT_CLASSES, LABEL_CLASSES, CONTROL_CLASSES].join(" ").split(" "))],
);

/** Chunk-level identifiers the injected code relies on. Each must be a top-level binding. */
export const REQUIRED_CHUNK_BINDINGS = Object.freeze(["p", "S", "re", "vt", "so"]);

/** Select sentinel for "nothing picked yet"; also guards loadMem/loadWf against no-ops. */
export const NONE_SENTINEL = "__r-agent-data-none__";

// No backticks anywhere in here: the source is spliced into a minified chunk as plain text.
// The sentinel const comes first so every later reference (render-time) is initialized.
export const COMPONENT_SOURCE = [
  'const RAgentDataNone=' + JSON.stringify(NONE_SENTINEL) + ';',  'const RAgentDataCardClasses=' + JSON.stringify(CARD_CLASSES) + ',RAgentDataRowClasses=' + JSON.stringify(ROW_CLASSES) + ',RAgentDataTextClasses=' + JSON.stringify(TEXT_CLASSES) + ',RAgentDataLabelClasses=' + JSON.stringify(LABEL_CLASSES) + ',RAgentDataControlClasses=' + JSON.stringify(CONTROL_CLASSES) + ';',
  'function RAgentDataWhen(ts){try{const d=new Date(ts);if(isNaN(d.getTime()))return String(ts);const z=n=>(n<10?"0":"")+n;return z(d.getMonth()+1)+"-"+z(d.getDate())+" "+z(d.getHours())+":"+z(d.getMinutes())}catch(err){return String(ts)}}',
  'const RAgentDataPre=text=>p.jsx("div",{"data-r-agent-data-pre":"",style:{maxHeight:"280px",overflowY:"auto",whiteSpace:"pre-wrap",wordBreak:"break-word",margin:"8px 0 0",padding:"8px 10px",borderRadius:"8px",background:"rgba(128,128,128,0.14)",fontSize:"12px",lineHeight:"1.55",userSelect:"text"},children:typeof text==="string"&&text.length>0?text:RLocT("(empty)","（空）")});',
  'const RAgentDataBtn=o=>p.jsx("button",{type:"button",onClick:o.onClick,style:{border:"none",cursor:"pointer",borderRadius:"8px",padding:"4px 10px",fontSize:"12px",background:o.active?"rgba(128,128,128,0.28)":"rgba(128,128,128,0.14)",color:"inherit",whiteSpace:"nowrap"},children:o.label});',
  'const RAgentDataHint=text=>text==null?null:p.jsx(vt,{color:"secondary",size:"sm",children:text});',
  "function RAgentDataCards({agent:t}){",
  "const[nz,setNz]=S.useState(0),[ov,setOv]=S.useState({busy:!0,error:null,data:null}),[open,setOpen]=S.useState(null),[memMonth,setMemMonth]=S.useState(null),[mem,setMem]=S.useState({busy:!1,content:null,error:null}),[wfSlug,setWfSlug]=S.useState(null),[wf,setWf]=S.useState({busy:!1,content:null,error:null});",
  "const memSeq=S.useRef(0),wfSeq=S.useRef(0);",
  "S.useEffect(()=>{let c=!0;const g=window.desktop&&window.desktop.agent;memSeq.current++;wfSeq.current++;",
  "setOpen(null);setMemMonth(null);setMem({busy:!1,content:null,error:null});setWfSlug(null);setWf({busy:!1,content:null,error:null});",
  'if(!g||typeof g.getAgentDataOverview!=="function"){setOv({busy:!1,error:RLocT("Unavailable in this build.","当前构建未开放此功能。"),data:null});return()=>{c=!1}}',
  "setOv({busy:!0,error:null,data:null});",
  'g.getAgentDataOverview(t.id).then(r=>{if(!c)return;if(r&&r.ok&&r.data){setOv({busy:!1,error:null,data:r.data})}else setOv({busy:!1,error:String((r&&r.reason)||"read-failed"),data:null})}).catch(err=>{if(c)setOv({busy:!1,error:String((err&&err.message)||err),data:null})});',
  "return()=>{c=!1;memSeq.current++;wfSeq.current++}},[t.id,nz]);",
  "const loadMem=m=>{if(m==null||m===RAgentDataNone){memSeq.current++;setMem({busy:!1,content:null,error:null});return}const n=++memSeq.current;setMem({busy:!0,content:null,error:null});const g=window.desktop&&window.desktop.agent;",
  'Promise.resolve(g&&typeof g.getAgentMemoryLog==="function"?g.getAgentMemoryLog(t.id,m):null).then(r=>{if(memSeq.current!==n)return;if(r&&r.ok){const c=r.data&&typeof r.data.content==="string"?r.data.content:null;setMem({busy:!1,content:c,error:c==null?RLocT("No entries for this month.","该月份暂无记录。"):null})}else setMem({busy:!1,content:null,error:String((r&&r.reason)||"read-failed")})}).catch(err=>{if(memSeq.current===n)setMem({busy:!1,content:null,error:String((err&&err.message)||err)})})};',
  "const loadWf=s=>{if(s==null||s===RAgentDataNone){wfSeq.current++;setWf({busy:!1,content:null,error:null});return}const n=++wfSeq.current;setWf({busy:!0,content:null,error:null});const g=window.desktop&&window.desktop.agent;",
  'Promise.resolve(g&&typeof g.getAgentWorkflowContent==="function"?g.getAgentWorkflowContent(s):null).then(r=>{if(wfSeq.current!==n)return;if(r&&r.ok){const c=r.data&&typeof r.data.content==="string"?r.data.content:null;setWf({busy:!1,content:c,error:c==null?RLocT("No SKILL.md in this workflow.","该技能没有 SKILL.md。"):null})}else setWf({busy:!1,content:null,error:String((r&&r.reason)||"read-failed")})}).catch(err=>{if(wfSeq.current===n)setWf({busy:!1,content:null,error:String((err&&err.message)||err)})})};',
  "if(t.isGroup)return null;",
  "const d=ov.data;",
  "const pick=(list,placeholder)=>[{value:RAgentDataNone,label:placeholder}].concat((list||[]).filter(m=>typeof m===\"string\").map(m=>({value:m,label:m})));",
  "const cardEl=(key,label,hint,control,extra)=>p.jsxs(\"div\",{className:re(\"sand-agent-settings__card\",RAgentDataCardClasses),[\"data-r-agent-\"+key]:\"\",children:[",
  'p.jsxs("div",{className:re("sand-agent-settings__row",RAgentDataRowClasses),children:[',
  'p.jsxs("span",{className:re("sand-agent-settings__text",RAgentDataTextClasses),children:[',
  'p.jsx("span",{className:RAgentDataLabelClasses,children:label}),RAgentDataHint(hint)]}),',
  'p.jsx("span",{className:re("sand-agent-settings__control",RAgentDataControlClasses),children:control})]}),',
  "extra||null]},key);",
  'const wrap=children=>p.jsx("div",{style:{display:"flex",flexDirection:"column",gap:"8px"},"data-r-agent-data":"",children:children});',
  'if(ov.busy)return wrap([cardEl("loading",RLocT("Bot data","Bot 数据"),RLocT("Loading…","读取中…"),null,null)]);',
  'if(ov.error)return wrap([cardEl("error",RLocT("Bot data","Bot 数据"),ov.error,p.jsx(RAgentDataBtn,{label:RLocT("Retry","重试"),active:!1,onClick:()=>setNz(n=>n+1)}),null)]);',
  'const auditText=d.audit&&Array.isArray(d.audit.entries)?d.audit.entries.map(x=>(x.ts?RAgentDataWhen(x.ts)+"  ":"")+"["+x.type+"]  "+x.summary).join("\\n"):null;',
  "const soulExtra=open===\"soul\"?RAgentDataPre(d.soul):null;",
  "const userExtra=open===\"user\"?RAgentDataPre(d.userProfile):null;",
  'const auditExtra=open==="audit"?(auditText!=null&&auditText.length>0?RAgentDataPre(auditText+(d.audit&&d.audit.truncated?"\\n… "+RLocT("older entries truncated","更早的记录已截断"):"")):RAgentDataHint(RLocT("No audit entries.","暂无审计记录。"))):null;',
  'const memExtra=mem.busy?RAgentDataHint(RLocT("Loading…","读取中…")):mem.error?RAgentDataHint(mem.error):mem.content!=null?RAgentDataPre(mem.content):null;',
  'const wfExtra=wf.busy?RAgentDataHint(RLocT("Loading…","读取中…")):wf.error?RAgentDataHint(wf.error):wf.content!=null?RAgentDataPre(wf.content):null;',
  "return wrap([",
  'cardEl("soul",RLocT("Soul","人格 (Soul)"),RLocT("memory/profile.md","memory/profile.md"),p.jsx(RAgentDataBtn,{label:open==="soul"?RLocT("Hide","收起"):RLocT("View","查看"),active:open==="soul",onClick:()=>setOpen(o=>o==="soul"?null:"soul")}),soulExtra),',
  'cardEl("memory",RLocT("Memory","记忆"),RLocT("memory/log/YYYY-MM.md","memory/log/YYYY-MM.md"),p.jsx(so,{"aria-label":RLocT("Memory month","记忆月份"),disabled:!d.memoryLogMonths||d.memoryLogMonths.length===0,onValueChange:n=>{if(n!==null){setMemMonth(n);loadMem(n)}},options:pick(d.memoryLogMonths,d.memoryLogMonths&&d.memoryLogMonths.length>0?RLocT("Pick a month","选择月份"):RLocT("No journal yet","暂无记忆日志")),placement:"bottom-end",size:"md",value:memMonth??RAgentDataNone}),memExtra),',
  'cardEl("user",RLocT("User profile","用户画像"),RLocT("user-memory profile.md","user-memory 画像"),p.jsx(RAgentDataBtn,{label:open==="user"?RLocT("Hide","收起"):RLocT("View","查看"),active:open==="user",onClick:()=>setOpen(o=>o==="user"?null:"user")}),userExtra),',
  'cardEl("audit",RLocT("Audit","行为审计"),RLocT("audit.jsonl (latest)","audit.jsonl（最近）"),p.jsx(RAgentDataBtn,{label:open==="audit"?RLocT("Hide","收起"):RLocT("View","查看"),active:open==="audit",onClick:()=>setOpen(o=>o==="audit"?null:"audit")}),auditExtra),',
  'cardEl("workflow",RLocT("Workflows","技能"),RLocT("workflows/*/SKILL.md","workflows/*/SKILL.md"),p.jsx(so,{"aria-label":RLocT("Workflow","技能"),disabled:!d.workflows||d.workflows.length===0,onValueChange:n=>{if(n!==null){setWfSlug(n);loadWf(n)}},options:pick(d.workflows,RLocT("Pick a workflow","选择技能")),placement:"bottom-end",size:"md",value:wfSlug??RAgentDataNone}),wfExtra)',
  "]);",
  "}",
].join("\n");

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalAgentDataCards(source) {
  if (source.includes("function RAgentDataCards(")) {
    throw new Error("Agent data cards are already injected into the renderer chunk.");
  }
  if (source.includes("const RAgentDataNone=")) {
    throw new Error("Agent data sentinel binding already present in the renderer chunk.");
  }
  if (!source.includes("function RAgentModelCard(")) {
    throw new Error("Agent data cards require the agent-model patch to run first.");
  }
  let patched = replaceExactlyOnce(source, H3N_RETURN_WITH_MODEL, H3N_RETURN_WITH_DATA, "bot properties return (with model card)");
  patched = replaceExactlyOnce(patched, H3N_SIGNATURE, COMPONENT_SOURCE + H3N_SIGNATURE, "bot properties signature");
  return patched;
}

export function assertAgentDataClassesResolve(css) {
  const missing = REUSED_CLASSES.filter((name) => !css.includes(`.${name}`));
  if (missing.length > 0) {
    throw new Error(`Agent data card classes missing from the pinned CSS: ${missing.join(", ")}`);
  }
  return REUSED_CLASSES.length;
}

export async function applyOriginalRendererAgentDataCards({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  let css = "";
  for (const name of await readdir(assetsRoot)) {
    const target = path.join(assetsRoot, name);
    if (name.endsWith(".css")) { css += await readFile(target, "utf8"); continue; }
    if (!name.endsWith(".js")) continue;
    const source = await readFile(target, "utf8");
    if (source.includes(H3N_RETURN_WITH_MODEL)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one original renderer chunk carrying the agent-model card anchor, found ${candidates.length}.`);
  }
  const classCount = assertAgentDataClassesResolve(css);
  const candidate = candidates[0];
  const patched = patchOriginalAgentDataCards(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-agent-data-cards",
    chunks: [
      {
        role: "bot-properties-data-cards",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
        reusedClasses: classCount,
      },
    ],
    evidence: {
      upstreamEquivalent: null,
      note: "Experimental extension: no upstream or official surface exposes box-side bot data files. Markup mirrors h3n's Notifications card; runs after the agent-model patch and anchors on its output.",
    },
    features: ["experimental-bot-soul-viewer", "experimental-bot-memory-viewer", "experimental-bot-user-profile-viewer", "experimental-bot-audit-viewer", "experimental-bot-workflow-viewer"],
    transformations: ["bot-properties-appends-data-cards"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-agent-data-cards-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
