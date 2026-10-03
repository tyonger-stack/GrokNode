// Per-bot TokenHub model override, injected into the checksum-pinned 0.18 renderer chunk.
//
// EXPERIMENTAL EXTENSION — no upstream equivalent. Neither the pinned 0.18 renderer nor the
// official 0.62.0 app (bundle com.anysphere.sand, checked 2026-10-01: its app.asar has no
// per-agent model setting; the single "agentModel" hit is a protobuf model-config class)
// offers a per-bot model choice. Like the Router panel, this card exists only because the
// rebuild routes inference itself (Settings → Router → TokenHub), and it is recorded as such
// in the provenance file.
//
// Placement evidence. The bot properties panel is `h3n` in index-UbX-y3il.js: it renders the
// avatar, the Name / Title / Description editors and — for non-group bots — one
// `sand-agent-settings__card` holding the Notifications toggle. Its last statement is
//
//     I=p.jsxs("div",{className:d,children:[E,A]})
//
// where E is the identity column and A is that Notifications card. The patch appends one more
// child, `RAgentModelCard`, built from exactly the same card / row / text / control markup and
// atomic classes as the Notifications card, so the new row is visually one more row of the
// same kind. The select is the chunk's own top-level `so` wrapper (filled variant, menu size
// md), the same control the routine editor uses. No memo slot is added to `h3n`: the card is a
// separate component that owns its state.
//
// Data flow: window.desktop.agent.getAgentOpenRouterModel(agentId) /
// setAgentOpenRouterModel(agentId, model|null) → main-edge → settings.json
// `openRouterAgentModels` → synced to the in-box host, where resolveOpenRouterModel(agentId)
// picks it before the Router default. The Effort row works the same way through
// get/setAgentOpenRouterEffort and `openRouterAgentEfforts`; its options are the levels the
// bot's effective model supports, so they are refetched whenever the model row changes.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const H3N_SIGNATURE =
  "function h3n(n){const e=he.c(31),{agent:t,onNameChange:s,onTitleChange:r,onDescriptionChange:i}=n,";

export const H3N_RETURN_BEFORE =
  'I=p.jsxs("div",{className:d,children:[E,A]}),e[28]=E,e[29]=A,e[30]=I';

export const H3N_RETURN_AFTER =
  'I=p.jsxs("div",{className:d,children:[E,A,p.jsx(RAgentModelCard,{agent:t})]}),e[28]=E,e[29]=A,e[30]=I';

/** Atomic classes copied from h3n's Notifications card; each must resolve in the pinned CSS. */
export const CARD_CLASSES = "sand-78zum5 sand-dt5ytf sand-167g77z sand-1y1aw1k sand-y13l1i sand-wib8y2 sand-163pfp sand-4pepcl sand-cq4si4";
export const ROW_CLASSES = "sand-78zum5 sand-6s0dn4 sand-1qughib sand-1v2ro7d sand-1iorvi4 sand-jkvuk6 sand-11iknt3 sand-mzs88n";
export const TEXT_CLASSES = "sand-78zum5 sand-dt5ytf sand-195vfkc sand-euugli";
export const LABEL_CLASSES = "sand-11wthnw sand-1ja60sm sand-1wd3ewq";
export const CONTROL_CLASSES = "sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-78zum5 sand-6s0dn4";

// Width adaptation. The Notifications toggle is narrow, so its row lets the text column take
// whatever is left. A model name is not: under the inherited flex-shrink:0 the hugging select
// grows to the full label and crushes the text to one glyph per line. So the text column grows
// from a zero basis (flex-grow:1 / flex-basis:0%), the control may shrink (flex-shrink:1,
// min-width:0) up to MODEL_CONTROL_MAX_WIDTH, and the trigger is bounded by its column
// (max-width:100%, min-width:0) so the select's own ellipsis label truncates.
export const MODEL_TEXT_CLASSES = TEXT_CLASSES + " ui-1iyjqo2 ui-1t1x2f9";
export const MODEL_CONTROL_CLASSES = "sand-1c4vz4f ui-s83m0k sand-dl72j9 sand-78zum5 sand-6s0dn4 sand-euugli";
export const MODEL_TRIGGER_CLASSES = "ui-193iq5w ui-euugli";
// `so` overwrites any className with its own `xme`, so the trigger bound goes through `rootStyle`,
// which `$in` merges into the trigger's stylex styles. Keys are the chunk's own stylex property
// keys for max-width (ks0D6T) and min-width (k7Eaqz).
export const MODEL_TRIGGER_ROOT_STYLE = '{ks0D6T:"ui-193iq5w",k7Eaqz:"ui-euugli",$$css:!0}';
// No max-width:55% class ships in the pinned CSS, so the cap is an inline style.
export const MODEL_CONTROL_MAX_WIDTH = "55%";

export const REUSED_CLASSES = Object.freeze([
  ...new Set([CARD_CLASSES, ROW_CLASSES, MODEL_TEXT_CLASSES, LABEL_CLASSES, MODEL_CONTROL_CLASSES, MODEL_TRIGGER_CLASSES].join(" ").split(" ")),
]);

/** Chunk-level identifiers the injected code relies on. Each must be a top-level binding. */
export const REQUIRED_CHUNK_BINDINGS = Object.freeze(["p", "S", "re", "vt", "so"]);

// No backticks in here: the source is spliced into a minified chunk as plain text.
const ROW_SOURCE = [
  "const RAgentModelRow=({id:u,label:a,hint:h,ariaLabel:b,disabled:d,options:x,value:v,onChange:f})=>",
  'p.jsxs("div",{className:re("sand-agent-settings__row",' + JSON.stringify(ROW_CLASSES) + '),children:[',
  'p.jsxs("span",{className:re("sand-agent-settings__text",' + JSON.stringify(MODEL_TEXT_CLASSES) + '),children:[',
  'p.jsx("span",{className:' + JSON.stringify(LABEL_CLASSES) + ',id:u,children:a}),',
  'p.jsx(vt,{color:"secondary",size:"sm",children:h})]}),',
  'p.jsx("span",{className:re("sand-agent-settings__control",' + JSON.stringify(MODEL_CONTROL_CLASSES) + '),style:{maxWidth:' + JSON.stringify(MODEL_CONTROL_MAX_WIDTH) + '},children:',
  'p.jsx(so,{rootStyle:' + MODEL_TRIGGER_ROOT_STYLE + ',"aria-label":b,"aria-labelledby":u,disabled:d,onValueChange:n=>{if(n!==null)void f(n)},options:x,placement:"bottom-end",size:"md",value:v})})]});',
].join("");

export const COMPONENT_SOURCE = [
  'const RAgentModelDefault="__r-agent-model-default__";',
  'const RAgentEffortLadder=()=>[{value:"none",label:RLocT("None","无(不思考)")},{value:"low",label:RLocT("Low","低")},{value:"medium",label:RLocT("Medium","中")},{value:"high",label:RLocT("High","高")},{value:"xhigh",label:RLocT("Extra high","超高")},{value:"max",label:RLocT("Max","最高")},{value:"ultra",label:RLocT("Ultra","极致")}];',
  ROW_SOURCE,
  "function RAgentModelCard({agent:t}){",
  'const[s,e]=S.useState({selected:null,defaultModel:null,models:[],baseUrl:null,provider:"openrouter",error:null,busy:!0}),u=S.useId(),k=S.useId();',
  'const[q,y]=S.useState({selected:null,defaultEffort:null,modelDefault:null,options:[],error:null,busy:!0});',
  "S.useEffect(()=>{let c=!0;const g=window.desktop&&window.desktop.agent;",
  'if(!g||typeof g.getAgentOpenRouterModel!=="function"){e(o=>({...o,busy:!1}));return()=>{c=!1}}',
  "e(o=>({...o,busy:!0,error:null}));",
  'g.getAgentOpenRouterModel(t.id).then(async i=>{if(!c)return;let models=Array.isArray(i?.models)?i.models.filter(m=>typeof m==="string"):[];const base=typeof i?.baseUrl==="string"&&i.baseUrl.length>0?i.baseUrl:null;if(base&&i?.provider!=="codex"&&typeof window.desktop.fetchEndpointModels==="function"){try{const probe=await window.desktop.fetchEndpointModels(base);if(probe&&Array.isArray(probe.models)&&probe.models.length>0)models=probe.models.slice()}catch(_err){}}e({selected:typeof i?.selected==="string"?i.selected:null,defaultModel:typeof i?.defaultModel==="string"?i.defaultModel:null,models,baseUrl:base,provider:i?.provider==="codex"?"codex":"openrouter",error:typeof i?.error==="string"&&i.error.length>0?i.error:null,busy:!1})}).catch(i=>{c&&e(o=>({...o,error:String(i?.message??i),busy:!1}))});',
  "return()=>{c=!1}},[t.id]);",
  "S.useEffect(()=>{let c=!0;const g=window.desktop&&window.desktop.agent;",
  'if(!g||typeof g.getAgentOpenRouterEffort!=="function"){y(o=>({...o,busy:!1}));return()=>{c=!1}}',
  "y(o=>({...o,busy:!0,error:null}));",
  'g.getAgentOpenRouterEffort(t.id).then(i=>{if(!c)return;y({selected:typeof i?.selected==="string"?i.selected:null,defaultEffort:typeof i?.defaultEffort==="string"?i.defaultEffort:null,modelDefault:typeof i?.modelDefault==="string"?i.modelDefault:null,options:Array.isArray(i?.options)?i.options.filter(o=>o&&typeof o.value==="string"&&typeof o.label==="string"):[],error:null,busy:!1})}).catch(i=>{c&&y(o=>({...o,error:String(i?.message??i),busy:!1}))});',
  "return()=>{c=!1}},[t.id,s.selected,s.defaultModel]);",
  "if(t.isGroup)return null;",
  "const w=async v=>{const m=v===RAgentModelDefault?null:v;e(o=>({...o,busy:!0,error:null}));",
  'try{const r=await window.desktop.agent.setAgentOpenRouterModel(t.id,m);e(o=>({...o,selected:typeof r?.selected==="string"?r.selected:null,busy:!1}))}',
  "catch(i){e(o=>({...o,busy:!1,error:String(i?.message??i)}))}};",
  "const z=async v=>{const m=v===RAgentModelDefault?null:v;y(o=>({...o,busy:!0,error:null}));",
  'try{if(m!=null){const eff=s.selected??s.defaultModel;if(eff&&s.baseUrl&&typeof window.desktop.probeEffortSupport==="function"){const pr=await window.desktop.probeEffortSupport(s.baseUrl,eff,m);if(pr&&!pr.ok){const allowed=Array.isArray(pr.allowed)&&pr.allowed.length>0?RLocT(" Allowed levels: "," 可用档位：")+pr.allowed.join(", "):"";y(o=>({...o,busy:!1,error:RLocT("The endpoint rejected ","端点不接受 ")+JSON.stringify(m)+RLocT(" as a reasoning effort."," 这个推理强度。")+allowed}));return}}}const r=await window.desktop.agent.setAgentOpenRouterEffort(t.id,m);y(o=>({...o,selected:typeof r?.effort==="string"?r.effort:null,busy:!1}))}',
  "catch(i){y(o=>({...o,busy:!1,error:String(i?.message??i)}))}};",
  "const l=s.selected!=null&&!s.models.includes(s.selected)?[s.selected].concat(s.models):s.models;",
  'const x=[{value:RAgentModelDefault,label:RLocT("Use default","使用默认")+(s.defaultModel?" ("+s.defaultModel+")":"")}].concat(l.map(m=>({value:m,label:m})));',
  'const h=s.error?s.error:s.provider==="codex"?RLocT("Only applies when Routing uses TokenHub.","仅在路由使用 TokenHub 时生效。"):RLocT("Overrides the default model.","指定模型，覆盖默认模型。");',
  "const A=RAgentEffortLadder(),E=q.options.length>0?q.options.map(o=>A.find(n=>n.value===o.value)??o):A,L=v=>{const o=A.find(n=>n.value===v);return o?o.label:v};",
  'const D=q.defaultEffort?L(q.defaultEffort):RLocT("Model default","模型默认")+(q.modelDefault?" · "+L(q.modelDefault):"");',
  'const X=[{value:RAgentModelDefault,label:RLocT("Use default","使用默认")+" ("+D+")"}].concat(E.map(o=>({value:o.value,label:o.label})));',
  'const H=q.error?q.error:s.provider==="codex"?RLocT("Only applies when Routing uses TokenHub.","仅在路由使用 TokenHub 时生效。"):RLocT("Choose a supported reasoning effort.","指定支持的推理强度。");',
  'return p.jsxs("div",{className:re("sand-agent-settings__card",' + JSON.stringify(CARD_CLASSES) + '),"data-r-agent-model":"",children:[',
  'RAgentModelRow({id:u,label:RLocT("Model","模型"),hint:h,ariaLabel:RLocT("Bot model","Bot 模型"),disabled:s.busy||s.provider==="codex",options:x,value:s.selected??RAgentModelDefault,onChange:w}),',
  'RAgentModelRow({id:k,label:RLocT("Effort","推理强度"),hint:H,ariaLabel:RLocT("Bot reasoning effort","Bot 推理强度"),disabled:q.busy||s.busy||s.provider==="codex",options:X,value:q.selected??RAgentModelDefault,onChange:z})]})',
  "}",
].join("");

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalAgentModelCard(source) {
  if (source.includes("function RAgentModelCard(")) {
    throw new Error("Agent model card is already injected into the renderer chunk.");
  }
  let patched = replaceExactlyOnce(source, H3N_RETURN_BEFORE, H3N_RETURN_AFTER, "bot properties return");
  patched = replaceExactlyOnce(patched, H3N_SIGNATURE, COMPONENT_SOURCE + H3N_SIGNATURE, "bot properties signature");
  return patched;
}

export function assertAgentModelClassesResolve(css) {
  const missing = REUSED_CLASSES.filter((name) => !css.includes(`.${name}`));
  if (missing.length > 0) {
    throw new Error(`Agent model card classes missing from the pinned CSS: ${missing.join(", ")}`);
  }
  return REUSED_CLASSES.length;
}

export async function applyOriginalRendererAgentModel({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  let css = "";
  for (const name of await readdir(assetsRoot)) {
    const target = path.join(assetsRoot, name);
    if (name.endsWith(".css")) { css += await readFile(target, "utf8"); continue; }
    if (!name.endsWith(".js")) continue;
    const source = await readFile(target, "utf8");
    if (source.includes(H3N_SIGNATURE)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one original renderer chunk for the agent model card, found ${candidates.length}.`);
  }
  const classCount = assertAgentModelClassesResolve(css);
  const candidate = candidates[0];
  const patched = patchOriginalAgentModelCard(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-agent-model",
    chunks: [
      {
        role: "bot-properties-model-card",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
        reusedClasses: classCount,
      },
    ],
    evidence: {
      upstreamEquivalent: null,
      note: "Experimental extension: neither 0.18 nor 0.62.0 has a per-bot model setting. Markup mirrors h3n's Notifications card.",
    },
    features: ["experimental-per-bot-openrouter-model", "experimental-per-bot-openrouter-effort"],
    transformations: ["bot-properties-appends-model-card"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-agent-model-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
