// Grok Bot 0.71.2 widget multiSelect, ported onto the checksum-pinned 0.18 widget card.
//
// Host commit 5815874 already accepts `multiSelect` on ask/widget cards and joins
// selected `value ?? label` with "\n" (source/shared/sand-widgets.ts:
// MULTI_SELECT_ANSWER_SEPARATOR / getWidgetAnswerLabel). This patch is the renderer
// half: checkboxes + one Submit, resolved card ticks every matched row.
//
// Evidence (0.71.2 asar):
//   * Live card `Ue` in chunk-widget-BhFzp8Ld.js @5636: `v=n.multiSelect===!0`,
//     selection Set, click toggles when multi / submits when single, answer =
//     `Xe([...picks, allowCustom?trim:""])` (Xe = join with \n), Submit when
//     `v&&pe.length>0`. Bubble surface (0.18's shape) is the non-elevated return
//     at @11900: form with options + optional custom row + multi Submit.
//   * Resolved card `It` @12426 / `Ye` @11827: split answer, tick every option
//     whose canonical value is in the set, plus a raw row for leftover custom text.
//   * Answer helpers in index.eager-app-DSuGVQNC.js (`K$e`/`sge`/`Yd`, exported as
//     bm/bn/bo) — same contract already in source/shared/sand-widgets.ts.
//
// 0.18's live `Xs` / resolved `Gs` in view-CIFdOvCz.js have no multiSelect path
// (click always submits one value; resolved shows one row). This patch replaces
// those two functions with bubble-surface equivalents that keep every i18n
// literal extra-i18n's FULL/PANEL pairs need (Custom answer / Dismiss question /
// Dismiss without answering / Selected / Submit / Type your own answer / Your answer)
// and the same sand-widget* class recipes. `Rs` (dismissed) is untouched.
//
// The zod schema call after `Ps` is a discarded expression in 0.18 (side-effect-
// free); multiSelect is still added so the description matches the host tool
// schema. The entry's `message.widget` is what the card reads at runtime.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_BEFORE =
  'allowCustom:us().optional().describe("When true, the user can type a custom free-text answer instead of choosing one of the options."),';
const SCHEMA_AFTER =
  'multiSelect:us().optional().describe("When true, several options may apply. The user toggles any subset, then submits once. Picked values return in one reply, one per line."),'
  + SCHEMA_BEFORE;

const OS_BEFORE =
  "function Os(g,s){return(Array.isArray(g.options)?g.options:[]).find(u=>(u.value??u.label)===s)?.label??s}";
const OS_AFTER =
  "function RMsNorm(vs){return vs.map(v=>String(v).replace(/\\s*\\n\\s*/g,\" \").trim()).filter(v=>v.length>0)}"
  + "function RMsSplit(a){return RMsNorm(String(a).split(\"\\n\"))}"
  + "function RMsJoin(vs){return RMsNorm(vs).join(\"\\n\")}"
  + "function RMsVal(g){return RMsNorm([g.value??g.label??\"\"])[0]??\"\"}"
  + "function RMsToggle(set,v){const n=new Set(set);return n.has(v)?(n.delete(v),n):(n.add(v),n)}"
  + "function Os(g,s){if(g.multiSelect===!0)return RMsSplit(s).map(v=>(Array.isArray(g.options)?g.options:[]).find(u=>RMsVal(u)===v)?.label??v).join(\"\\n\");"
  + "return(Array.isArray(g.options)?g.options:[]).find(u=>(u.value??u.label)===s)?.label??s}";

const XS_START = "function Xs(g){";
const GS_START = "function Gs(g){";
const RS_START = "function Rs(g){";

// Live card: single-select keeps 0.18 behaviour (click = submit); multiSelect
// toggles a Set and submits once via the shared Submit / Enter path. Visual
// selected state reuses the resolved-card option classes so we invent no CSS.
const XS_BODY = String.raw`function Xs(g){const{entryId:e,widget:a,isKeyboardTarget:u,agentId:t}=g,d=u===void 0?!1:u,{respondToWidget:r,dismissWidget:y}=qs(),[p,i]=ds.useState(()=>t==null?"":zs({agentId:t,entryId:e})??""),[RMsSel,RMsSetSel]=ds.useState(()=>new Set),[RMsBusy,RMsSetBusy]=ds.useState(!1),c=ds.useId(),m=Array.isArray(a.options)?a.options:[],w=a.allowCustom===!0,RMsMulti=a.multiSelect===!0,q=p.trim(),N=!RMsMulti&&w&&q.length>0,RMsPicks=RMsJoin([...m.filter(J=>RMsSel.has(RMsVal(J))).map(RMsVal),...w&&q.length>0?[q]:[]]),RMsCanSubmit=RMsMulti&&RMsPicks.length>0;const o=function(j){j.length!==0&&t!=null&&!RMsBusy&&ps({agentId:t,entryId:e})==null&&(RMsSetBusy(!0),Ss({agentId:t,entryId:e,value:j}),r({entryId:e,value:j,agentId:t}).then(k=>{k?.accepted===!1&&(RMsSetBusy(!1),es({agentId:t,entryId:e}))},()=>{RMsSetBusy(!1),es({agentId:t,entryId:e})}))};const z=function(){t!=null&&ps({agentId:t,entryId:e})==null&&(Ts({agentId:t,entryId:e}),y({entryId:e,agentId:t}).then(j=>{j.accepted===!1&&es({agentId:t,entryId:e})},()=>{es({agentId:t,entryId:e})}))};const RMsClick=function(ms){if(RMsMulti){RMsSetSel(prev=>RMsToggle(prev,ms));return}o(ms)};const v=d&&m.length>0;ds.useEffect(()=>{if(!v)return;const j=k=>{if(k.defaultPrevented||k.metaKey||k.ctrlKey||k.altKey||k.shiftKey||k.key.length!==1||gs(k.target)||gs(document.activeElement)||document.querySelector('[role="dialog"], [aria-modal="true"]')!=null)return;const L=k.key.toUpperCase().charCodeAt(0)-65,H=m[L];H!=null&&(k.preventDefault(),RMsClick(RMsVal(H)))};return document.addEventListener("keydown",j,!0),()=>document.removeEventListener("keydown",j,!0)},[v,m,RMsMulti,RMsSel,o]);const D=function(j){const{value:k}=j.currentTarget;i(k),t!=null&&Cs({agentId:t,entryId:e,value:k})};const W=function(j){j.key!=="Enter"||j.shiftKey||(j.preventDefault(),RMsMulti?RMsCanSubmit&&o(RMsPicks):o(q))};const T=function(j){j.preventDefault(),RMsMulti?RMsCanSubmit&&o(RMsPicks):o(q)};if(m.length===0||typeof a.prompt!="string")return null;const I=os(rs.transcriptWidget,C.widget,C.choices),j={className:"sand-78zum5 sand-1cy8zhl sand-167g77z sand-euugli"},k={className:"sand-78zum5 sand-1iyjqo2 sand-s83m0k sand-dt5ytf sand-euugli"},L={className:"sand-78zum5 sand-dt5ytf sand-h8yej3 sand-euugli sand-qjedn3 sand-1y0btm7 sand-q03nf1 sand-ur7f20 sand-b3r6kr sand-13l7odt"},H={className:"sand-78zum5 sand-1qjc9v5 sand-1iyjqo2 sand-s83m0k sand-1r8uery sand-euugli sand-21xpn4 sand-9f619 sand-mkeg23 sand-1y0btm7 sand-fnq37j sand-1swvq4d sand-ur7f20 sand-vvtkfd sand-1v2bezs"},cs={className:"sand-1iyjqo2 sand-s83m0k sand-1r8uery sand-euugli sand-1lliihq sand-5f5z56 sand-9f619 sand-126k92a sand-j0a0fe sand-tt52l0 sand-10wlt62 sand-123j3cw sand-cicffo sand-s9asl8 sand-1lqa7cf sand-ng3xce sand-ur7f20 sand-jbqb8w sand-1wd3ewq sand-jb2p0i sand-if65rj sand-1fc57z9 sand-12oo3zp sand-1t137rt sand-1h7ufjq"},ws=f("sand-widget sand-widget--choices",I.className),R=m.map((J,ss)=>{const ms=RMsVal(J),sel=RMsMulti&&RMsSel.has(ms);return n.jsxs(ds.Fragment,{children:[ss>0?n.jsx($s,{style:C.optionDivider}):null,n.jsxs(Is,{align:"left","aria-keyshortcuts":v?is(ss).toLowerCase():void 0,"aria-pressed":RMsMulti?sel:void 0,className:f("sand-widget-option",sel?"sand-widget-option--selected":void 0),onClick:()=>RMsClick(ms),rootStyle:C.option,type:"button",variant:"ghost",children:[n.jsx(hs,{letter:is(ss)}),n.jsxs("span",{className:f("sand-widget-option__body","sand-78zum5 sand-1iyjqo2 sand-s83m0k sand-dt5ytf sand-1cy8zhl sand-euugli"),children:[n.jsx(E,{className:f("sand-widget-option__label","sand-1heor9g sand-euugli sand-eaf4i8 sand-j0a0fe sand-dpxx8g"),children:J.label}),J.description!=null?n.jsx(E,{className:f("sand-widget-option__description","sand-euugli sand-eaf4i8 sand-j0a0fe sand-dpxx8g sand-19aaqeu"),children:J.description}):null]}),sel?n.jsx("span",{className:f("sand-3nfvp2 sand-6s0dn4 sand-2lah0s sand-19aaqeu"),title:"Selected",children:n.jsx(Es,{"aria-hidden":!0,name:"check",size:"md"})}):null]},ms+"-"+ss)]})});return n.jsxs("form",{"aria-labelledby":c,className:ws,onSubmit:T,style:I.style,children:[n.jsxs("div",{className:f("sand-widget__heading-row",j.className),style:j.style,children:[n.jsxs("div",{className:f("sand-widget__heading",k.className),style:k.style,children:[n.jsx(E,{as:"p",className:f("sand-widget__title","sand-10im51j sand-rxpjvj sand-euugli sand-1wd3ewq sand-j0a0fe"),id:c,weight:"medium",children:a.prompt}),a.helpText!=null?n.jsx(E,{as:"p",className:f("sand-widget__subtitle","sand-10im51j sand-rxpjvj sand-19aaqeu sand-j0a0fe"),children:a.helpText}):null]}),n.jsx(Ws,{"aria-label":"Dismiss question",className:"sand-widget__dismiss",icon:"x",iconSize:"sm",onClick:z,size:"sm",style:C.dismiss,title:"Dismiss without answering",type:"button"})]}),n.jsx("div",{className:f("sand-widget__options",L.className),style:L.style,children:R}),w?n.jsxs("div",{className:f("sand-widget__custom-row","sand-78zum5 sand-1cy8zhl sand-167g77z sand-h8yej3 sand-euugli"),children:[n.jsx("div",{className:f("sand-widget__custom-field",H.className),style:H.style,children:n.jsx("textarea",{"aria-label":"Custom answer",autoComplete:"off",className:f("sand-widget__custom-input",cs.className),onChange:D,onKeyDown:W,placeholder:"Type your own answer",rows:1,spellCheck:!1,style:cs.style,value:p})}),N?n.jsx(_s,{className:"sand-widget__custom-submit",size:"md",style:C.customSubmit,type:"submit",children:"Submit"}):null]}):null,RMsCanSubmit?n.jsx("div",{className:f("sand-widget__custom-row","sand-78zum5 sand-1cy8zhl sand-167g77z sand-h8yej3 sand-euugli sand-2lah0s"),children:n.jsx(_s,{className:"sand-widget__custom-submit",size:"md",style:C.customSubmit,type:"submit",children:"Submit"})}):null]})}
`;

// Resolved card: tick every option whose value is in the split answer; leftover
// free-text lines (allowCustom) render as raw rows under the same "Your answer"
// group — matching 0.71.2 Ye + It.
const GS_BODY = String.raw`function Gs(g){const{widget:e,answer:a}=g;if(typeof e.prompt!="string")return null;const M=Array.isArray(e.options)?e.options:[],RMsMulti=e.multiSelect===!0,RMsRows=(()=>{if(!RMsMulti){const K=M.findIndex($=>ls($)===a),u=M[K];return u!=null?[{kind:"option",option:u,optionIndex:K}]:[{kind:"raw",answer:a}]}const n=RMsSplit(a),r=new Set(n),l=new Set,u=[];for(const[o,c]of M.entries()){const d=RMsVal(c);l.add(d),r.has(d)&&u.push({kind:"option",option:c,optionIndex:o})}const f=RMsJoin(n.filter(o=>!l.has(o)));return f.length>0&&u.push({kind:"raw",answer:f}),u})(),$=os(rs.transcriptWidget,C.widget,C.choices),W={className:"sand-78zum5 sand-dt5ytf sand-h8yej3 sand-euugli sand-qjedn3 sand-1y0btm7 sand-q03nf1 sand-ur7f20 sand-b3r6kr sand-13l7odt"},c=f("sand-widget sand-widget--resolved",$.className),t=f("sand-widget-option sand-widget-option--selected","sand-78zum5 sand-6s0dn4 sand-167g77z sand-h8yej3 sand-euugli sand-e8ttls"),w=f("sand-widget-option__body","sand-78zum5 sand-1iyjqo2 sand-s83m0k sand-dt5ytf sand-1cy8zhl sand-euugli"),x=f("sand-widget-option__label","sand-euugli sand-eaf4i8 sand-j0a0fe sand-dpxx8g sand-1ybxsvs"),o=f("sand-3nfvp2 sand-6s0dn4 sand-2lah0s sand-19aaqeu"),v=RMsRows.map(A=>{const q=A.kind==="option"?A.option.label:A.answer,r=A.kind==="option"?n.jsx(hs,{letter:is(A.optionIndex),settled:!0}):null;return n.jsxs("div",{className:t,children:[r,n.jsx("span",{className:w,children:n.jsx(E,{className:x,children:q})}),n.jsx("span",{className:o,title:"Selected",children:n.jsx(Es,{"aria-hidden":!0,name:"check",size:"md"})})]},A.kind==="option"?RMsVal(A.option)+"-"+A.optionIndex:"raw-"+q)});return n.jsxs("div",{className:c,role:"group",style:$.style,children:[n.jsx(E,{as:"p",className:f("sand-widget__title","sand-10im51j sand-rxpjvj sand-euugli sand-1wd3ewq sand-j0a0fe"),weight:"medium",children:e.prompt}),n.jsx("div",{"aria-label":"Your answer",className:f("sand-widget__options",W.className),role:"group",style:W.style,children:v})]})}
`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer widget-multiselect ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceFunction(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Original renderer widget-multiselect ${label} start missing.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Original renderer widget-multiselect ${label} end missing.`);
  if (source.indexOf(startMarker, start + 1) >= 0) {
    throw new Error(`Original renderer widget-multiselect ${label} start is ambiguous.`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

export function patchWidgetMultiselect(source) {
  let patched = replaceExactlyOnce(source, SCHEMA_BEFORE, SCHEMA_AFTER, "schema multiSelect");
  patched = replaceExactlyOnce(patched, OS_BEFORE, OS_AFTER, "Os / answer helpers");
  patched = replaceFunction(patched, XS_START, GS_START, XS_BODY, "live Xs");
  patched = replaceFunction(patched, GS_START, RS_START, GS_BODY, "resolved Gs");
  for (const needle of [
    "Dismiss question",
    "Dismiss without answering",
    "Type your own answer",
    "Custom answer",
    "Submit",
    "Your answer",
    "Selected",
  ]) {
    if (!patched.includes(needle)) {
      throw new Error(`Widget multiselect patch dropped i18n anchor ${JSON.stringify(needle)}.`);
    }
  }
  if (!patched.includes("multiSelect===!0")) {
    throw new Error("Widget multiselect patch did not install a multiSelect branch.");
  }
  return patched;
}

export async function applyOriginalRendererWidgetMultiselect({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(XS_START) && source.includes(SCHEMA_BEFORE)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one widget view chunk for the multiSelect port, found ${candidates.length}.`);
  }
  const candidate = candidates[0];
  const patched = patchWidgetMultiselect(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-widget-multiselect",
    upstream: {
      version: "0.71.2",
      liveCard: { chunk: "dist/renderer/assets/chunk-widget-BhFzp8Ld.js", name: "Ue", offset: 5636 },
      resolvedCard: { chunk: "dist/renderer/assets/chunk-widget-BhFzp8Ld.js", name: "It", offset: 12426 },
      answerHelpers: { chunk: "dist/renderer/assets/index.eager-app-DSuGVQNC.js", names: ["K$e", "sge", "Yd"] },
    },
    chunks: [
      {
        role: "widget-view",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
      },
    ],
    transformations: [
      "schema-multiSelect-field",
      "live-card-toggle-and-join-submit",
      "resolved-card-tick-each-selected-row",
      "answer-label-join-for-copy",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-widget-multiselect-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
