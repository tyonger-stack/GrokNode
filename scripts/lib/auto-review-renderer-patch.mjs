// Auto-review Always-allow + 0.71.2 rule-notice card (evidence-only).
//
// Evidence (Grok Bot 0.71.2):
// - chunk-auto-review-rule-notice-DJ3xIQc7.js:
//   - LCS token diff `G({before,after})` → `<mark>` on inserted spans
//   - Notice shell `N` (role="note", shield-check, label, action)
//   - Kind labels: 0MNI5o「已添加到你的“允许”规则」, 0doodQ「编辑规则」,
//     fMPkxb/6lGV3K 展开/收起, AhEO6S「替换：…」
//   - Edit rule → deep-link auto-review-rules → general
// - zh: chunk-chat-oYCOIqHR.js; en: index.eager-app-DSuGVQNC.js
//
// 0.18 approval view (view-QqBtBG74.js) previously used string settledNote via ue().
// This patch clears settledNote and mounts RArRuleNotice beside the approval card.
// Mark highlight classes sand-fwqdrz / sand-10kc733 are absent in 0.18 CSS; use
// same-token stand-ins sand-1tiofj7 (--sand-fill-secondary) + sand-n3e42v
// (--sand-text-accent) with sand-18zih8k (border-radius:3px). Collapse uses
// sand-104kibb / sand-1ua5tub / sand-1h7i4cw / ui-1l13ptj / sand-b3r6kr.

const LOAD_BEFORE =
  'async function de(t,e){if(e===void 0)return"approved";try{await t.load();const s=ne(t.snapshots.get());return s==null?"approved":(await t.setInstructions(W(s,e)),"always")}catch{return"approved"}}';
const LOCAL_DOCKER_SHELL_RULE = '"Always allow all Shell commands on this local Docker VM."';
const LOAD_AFTER = `async function de(t,e,s){const n=s==="box_shell"?${LOCAL_DOCKER_SHELL_RULE}:e;if(n===void 0)throw new Error("No reusable rule is available. Choose Allow once or retry the command for a new review.");await t.load();const o=ne(t.snapshots.get());if(o==null)throw new Error("Could not load Auto-review settings. Retry or choose Allow once.");await t.setInstructions(W(o,n));return"always"}`;
const RESOLVE_BEFORE =
  'let o=a;a==="always"&&(o=await l());try{const r=await i({entryId:s,requestId:n,resolution:o,agentId:e});D({agentId:e,entryId:s,status:r==="stale"?"expired":o})}catch{H({agentId:e,entryId:s})}';
const RESOLVE_AFTER =
  'try{const o=a==="always"?await l():a,r=await i({entryId:s,requestId:n,resolution:o,agentId:e});D({agentId:e,entryId:s,status:r==="stale"?"expired":o})}catch(error){H({agentId:e,entryId:s});throw error}';
const SURFACE_BEFORE = "loadAlwaysAllow:()=>de(r.autoReviewInstructions,N)";
const SURFACE_AFTER = "loadAlwaysAllow:()=>de(r.autoReviewInstructions,N,a.surface)";
// Clear string settledNote; the rule notice card replaces ue() copy (0.71.2 notice).
const SETTLED_NOTE_BEFORE = "_=ue(u,N)";
const SETTLED_NOTE_AFTER = "_=void 0";

const IMPORT_BEFORE =
  'import{c as P,w as F,O,K as U,R as V,j as C,V as q,W as z,X as D,Y as H,Z as W,g as Y,M as K,E as X}from"./index-UbX-y3il.js";';
const IMPORT_AFTER =
  'import{c as P,w as F,O,K as U,R as V,j as C,V as q,W as z,X as D,Y as H,Z as W,g as Y,M as K,E as X,I as RArIcon}from"./index-UbX-y3il.js";';

// Injected after the import line. No backticks (String.raw / template hazard).
const NOTICE_HELPERS = [
  "const RArDockerRule=" + LOCAL_DOCKER_SHELL_RULE + ";",
  "function RArLocale(){",
  "try{",
  "const tags=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];",
  "for(const raw of tags){",
  'const tag=String(raw||"").trim().toLowerCase();',
  'if(tag==="zh"||tag.indexOf("zh-")===0)return "zh-CN";',
  'if(tag==="en"||tag.indexOf("en-")===0)return "en";',
  "}",
  "}catch(_e){}",
  'return "en";',
  "}",
  "function RArT(en,zh){return RArLocale()===\"zh-CN\"?zh:en}",
  // 0.71.2 G() — LCS token diff; inserted spans become <mark>.
  "const RArTokenRe=/[^\\s,]+/g;",
  "function RArDiffSegments(before,after){",
  "const a=before.match(RArTokenRe)??[],n=[...after.matchAll(RArTokenRe)],i=n.length+1,t=new Array((a.length+1)*i).fill(0),d=(s,l)=>t[s*i+l]??0;",
  "for(let s=a.length-1;s>=0;s--)for(let l=n.length-1;l>=0;l--)t[s*i+l]=a[s]===n[l]?.[0]?d(s+1,l+1)+1:Math.max(d(s+1,l),d(s,l+1));",
  "const m=new Set;",
  "for(let s=0,l=0;l<n.length;)s<a.length&&a[s]===n[l]?.[0]?(s++,l++):s<a.length&&d(s+1,l)>=d(s,l+1)?s++:m.add(l++);",
  "const u=[];let c=0;",
  "for(let s=0;s<n.length;s++){",
  "if(!m.has(s))continue;let l=s;for(;m.has(l+1);)l++;",
  "const r=n[s]?.index??0,h=n[l],x=(h?.index??0)+(h?.[0].length??0);",
  "r>c&&u.push({text:after.slice(c,r),isInserted:!1}),u.push({text:after.slice(r,x),isInserted:!0}),c=x,s=l",
  "}",
  "return c<after.length&&u.push({text:after.slice(c),isInserted:!1}),u",
  "}",
  "function RArMark(seg,key){",
  'return seg.isInserted?C.jsx("mark",{key:key,className:"sand-18zih8k sand-1tiofj7 sand-n3e42v",children:seg.text}):seg.text',
  "}",
  "function RArOpenAutoReviewSettings(){",
  'window.dispatchEvent(new CustomEvent("sand-open-settings",{detail:{section:"general"}}))',
  "}",
  "function RArRuleNotice(t){",
  "const{approval:a,replaces:n}=t;",
  "const[expanded,setExpanded]=F.useState(!1);",
  "const raw=ce(a);",
  'const ruleText=a.surface==="box_shell"?RArDockerRule:raw;',
  'const label=RArT("Added to your Allow rules","已添加到你的“允许”规则");',
  'const editLabel=RArT("Edit rule","编辑规则");',
  'const showMore=RArT("Show more","展开");',
  'const showLess=RArT("Show less","收起");',
  "const segments=ruleText==null?[]:n==null||n===void 0?[{text:ruleText,isInserted:!1}]:RArDiffSegments(String(n),ruleText);",
  "const marked=segments.map(RArMark);",
  "const canClamp=ruleText!=null&&ruleText.length>80;",
  'const textClass=canClamp&&!expanded?"sand-tyxrsu sand-j0a0fe sand-104kibb sand-1ua5tub sand-1h7i4cw ui-1l13ptj sand-b3r6kr":"sand-tyxrsu sand-j0a0fe";',
  'const editBtn=C.jsx("button",{type:"button","data-sand-auto-review-edit-rule":!0,"aria-label":editLabel,onClick:RArOpenAutoReviewSettings,className:"sand-2lah0s",style:{padding:"4px 10px",borderRadius:6,border:"0.5px solid var(--sand-border-default, rgba(252,252,252,0.15))",background:"var(--sand-fill-secondary, transparent)",color:"inherit",cursor:"pointer",fontSize:13,alignSelf:"flex-start"},children:editLabel});',
  'const toggle=canClamp?C.jsx("button",{type:"button",onClick:()=>setExpanded(v=>!v),className:"sand-qcrz7y",style:{padding:0,border:"none",background:"transparent",color:"var(--sand-text-secondary)",cursor:"pointer",fontSize:12,alignSelf:"flex-start"},children:expanded?showLess:showMore}):null;',
  'const replacesNote=n!=null&&n!==void 0&&ruleText!=null?C.jsx("div",{className:"sand-1o0liin",dir:"auto",style:{fontSize:13},children:RArT("Replaces: ","替换：")+String(n)}):null;',
  'const ruleBlock=ruleText==null?null:C.jsxs(C.Fragment,{children:[C.jsx("div",{className:textClass,dir:"auto",style:{fontSize:13,fontWeight:500},children:marked}),toggle,replacesNote]});',
  'const head=C.jsxs("div",{className:"sand-78zum5 sand-6s0dn4 sand-17d4w8g sand-euugli",children:[C.jsx(RArIcon,{name:"shield-check",size:"sm",style:{flexShrink:0},className:"sand-2lah0s sand-1o0liin"})," ",C.jsx("span",{className:"sand-1o0liin",style:{fontSize:13},children:label})]});',
  'const body=C.jsxs("div",{className:"sand-78zum5 sand-dt5ytf sand-195vfkc sand-1iyjqo2 sand-s83m0k sand-euugli",children:[head,ruleBlock]});',
  'return C.jsxs("div",{"data-sand-auto-review-rule-notice":!0,"aria-label":label,role:"note",className:"sand-78zum5 sand-6s0dn4 sand-167g77z sand-euugli",style:{padding:"8px 16px"},children:[body,editBtn]})',
  "}",
].join("");

const UE_BEFORE =
  'function ue(t,e){if(t!=="always")return;const s="A rule always allowing this was added to your Auto-review settings";return e===void 0?s:`${s}: “${e}”`}';
// Keep ue() as a no-op so any residual call sites stay safe; notice card owns the copy.
const UE_AFTER = "function ue(t,e){return}/* RAr: settledNote retired; see RArRuleNotice */";

const NOTICE_MOUNT =
  'u==="always"?C.jsx(RArRuleNotice,{approval:a}):null';

const RETURN_BEFORE = ":j=e[42],j}function we(t)";
const RETURN_AFTER = `:j=e[42],C.jsxs(F.Fragment,{children:[j,arError==null?null:C.jsx("p",{role:"alert",style:{color:"var(--cursor-text-red, #ff5266)",padding:"8px 16px"},children:arError}),${NOTICE_MOUNT}]})}function we(t)`;

const SETTINGS_OPENER_BEFORE = "k1=I0t.actions;function xRn";
const SETTINGS_OPENER_AFTER =
  'k1=I0t.actions;window.addEventListener("sand-open-settings",function(ev){try{const s=ev&&ev.detail&&typeof ev.detail.section==="string"&&ev.detail.section.length>0?ev.detail.section:"general";k1.open(Uf.settings({section:s}))}catch(_sandOpenSettingsErr){}});function xRn';

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error("Original Auto-review renderer anchor is missing or ambiguous.");
  }
  return source.replace(before, after);
}

export function patchOriginalAutoReviewApproval(source) {
  let result = source;
  if (result.includes(IMPORT_BEFORE)) {
    result = replaceOnce(result, IMPORT_BEFORE, IMPORT_AFTER + NOTICE_HELPERS);
  } else if (!result.includes("function RArRuleNotice(")) {
    // Synthetic fixtures: inject helpers before ue().
    result = replaceOnce(result, UE_BEFORE, NOTICE_HELPERS + UE_AFTER);
  }
  if (result.includes(UE_BEFORE)) {
    result = replaceOnce(result, UE_BEFORE, UE_AFTER);
  }
  result = replaceOnce(result, LOAD_BEFORE, LOAD_AFTER);
  result = replaceOnce(result, SURFACE_BEFORE, SURFACE_AFTER);
  result = replaceOnce(result, SETTLED_NOTE_BEFORE, SETTLED_NOTE_AFTER);
  result = replaceOnce(result, RESOLVE_BEFORE, RESOLVE_AFTER);
  result = replaceOnce(
    result,
    "function me(t){const e=P.c(43)",
    "function me(t){const[arError,setArError]=F.useState(null);const e=P.c(43)",
  );
  result = replaceOnce(result, "i(L),pe({", "i(L),setArError(null),pe({");
  result = replaceOnce(
    result,
    ".then(()=>i(void 0),()=>i(void 0))",
    ".then(()=>i(void 0),error=>{i(void 0);setArError(error instanceof Error?error.message:String(error))})",
  );
  return replaceOnce(result, RETURN_BEFORE, RETURN_AFTER);
}

/** Wire CustomEvent("sand-open-settings") → k1.open(Uf.settings({section})) on the main registry chunk. */
export function patchAutoReviewSettingsOpener(source) {
  return replaceOnce(source, SETTINGS_OPENER_BEFORE, SETTINGS_OPENER_AFTER);
}

/** Pure port of 0.71.2 `G({before,after})` for unit tests (same algorithm as NOTICE_HELPERS). */
export function rArDiffSegments(before, after) {
  const tokenRe = /[^\s,]+/g;
  const a = before.match(tokenRe) ?? [];
  const n = [...after.matchAll(tokenRe)];
  const i = n.length + 1;
  const t = new Array((a.length + 1) * i).fill(0);
  const d = (s, l) => t[s * i + l] ?? 0;
  for (let s = a.length - 1; s >= 0; s--) {
    for (let l = n.length - 1; l >= 0; l--) {
      t[s * i + l] = a[s] === n[l]?.[0] ? d(s + 1, l + 1) + 1 : Math.max(d(s + 1, l), d(s, l + 1));
    }
  }
  const m = new Set();
  for (let s = 0, l = 0; l < n.length; ) {
    if (s < a.length && a[s] === n[l]?.[0]) {
      s++;
      l++;
    } else if (s < a.length && d(s + 1, l) >= d(s, l + 1)) {
      s++;
    } else {
      m.add(l++);
    }
  }
  const u = [];
  let c = 0;
  for (let s = 0; s < n.length; s++) {
    if (!m.has(s)) continue;
    let l = s;
    for (; m.has(l + 1); ) l++;
    const r = n[s]?.index ?? 0;
    const h = n[l];
    const x = (h?.index ?? 0) + (h?.[0].length ?? 0);
    if (r > c) u.push({ text: after.slice(c, r), isInserted: false });
    u.push({ text: after.slice(r, x), isInserted: true });
    c = x;
    s = l;
  }
  if (c < after.length) u.push({ text: after.slice(c), isInserted: false });
  return u;
}
