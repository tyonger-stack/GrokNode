// Auto-review Always-allow + Edit-rule navigation (0.71.2 parity, evidence-only).
//
// Evidence (Grok Bot 0.71.2):
// - chunk-auto-review-rule-notice-DJ3xIQc7.js: after always-allow, secondary button
//   t({id:"0doodQ"}) → en "Edit rule" / zh「编辑规则」; onClick opens settings via
//   Me("auto-review-rules").
// - index.eager-app: deep-link map ["auto-review-rules","general"] and
//   "auto-review-rules":{label:{id:"BKJ+TX"},description:{id:"WhXxC0"}}
//   (zh chunk-settings-B31Ra5H2.js: BKJ+TX「自定义规则」, WhXxC0 description).
//
// 0.18 already ships Auto-review Rules inside Settings → General
// (index-BlqerJhg.js aria-label / h3 "Auto-review Rules"). No separate Custom
// Rules settings nav row is added — 0.71 maps auto-review-rules → general.
// Edit rule opens Settings section "general" (same destination).

const LOAD_BEFORE = 'async function de(t,e){if(e===void 0)return"approved";try{await t.load();const s=ne(t.snapshots.get());return s==null?"approved":(await t.setInstructions(W(s,e)),"always")}catch{return"approved"}}';
const LOCAL_DOCKER_SHELL_RULE = '"Always allow all Shell commands on this local Docker VM."';
const LOAD_AFTER = `async function de(t,e,s){const n=s==="box_shell"?${LOCAL_DOCKER_SHELL_RULE}:e;if(n===void 0)throw new Error("No reusable rule is available. Choose Allow once or retry the command for a new review.");await t.load();const o=ne(t.snapshots.get());if(o==null)throw new Error("Could not load Auto-review settings. Retry or choose Allow once.");await t.setInstructions(W(o,n));return"always"}`;
const RESOLVE_BEFORE = 'let o=a;a==="always"&&(o=await l());try{const r=await i({entryId:s,requestId:n,resolution:o,agentId:e});D({agentId:e,entryId:s,status:r==="stale"?"expired":o})}catch{H({agentId:e,entryId:s})}';
const RESOLVE_AFTER = 'try{const o=a==="always"?await l():a,r=await i({entryId:s,requestId:n,resolution:o,agentId:e});D({agentId:e,entryId:s,status:r==="stale"?"expired":o})}catch(error){H({agentId:e,entryId:s});throw error}';
const SURFACE_BEFORE = 'loadAlwaysAllow:()=>de(r.autoReviewInstructions,N)';
const SURFACE_AFTER = 'loadAlwaysAllow:()=>de(r.autoReviewInstructions,N,a.surface)';
const SETTLED_NOTE_BEFORE = '_=ue(u,N)';
const SETTLED_NOTE_AFTER = `_=ue(u,a.surface==="box_shell"?${LOCAL_DOCKER_SHELL_RULE}:N)`;

// 0.71.2 0doodQ — Edit rule / 编辑规则. Opens Settings → general (Auto-review Rules).
const EDIT_RULE_LABEL = '(typeof RLocT==="function"?RLocT("Edit rule","编辑规则"):"Edit rule")';
const EDIT_RULE_BUTTON = `u==="always"?C.jsx("button",{type:"button","data-sand-auto-review-edit-rule":!0,"aria-label":${EDIT_RULE_LABEL},onClick:()=>{window.dispatchEvent(new CustomEvent("sand-open-settings",{detail:{section:"general"}}))},style:{margin:"4px 16px 8px",padding:"4px 10px",borderRadius:6,border:"0.5px solid var(--sand-border-default, rgba(252,252,252,0.15))",background:"var(--sand-fill-secondary, transparent)",color:"inherit",cursor:"pointer",fontSize:13},children:${EDIT_RULE_LABEL}}):null`;

const RETURN_BEFORE = ':j=e[42],j}function we(t)';
const RETURN_AFTER = `:j=e[42],C.jsxs(F.Fragment,{children:[j,arError==null?null:C.jsx("p",{role:"alert",style:{color:"var(--cursor-text-red, #ff5266)",padding:"8px 16px"},children:arError}),${EDIT_RULE_BUTTON}]})}function we(t)`;

const SETTINGS_OPENER_BEFORE = 'k1=I0t.actions;function xRn';
const SETTINGS_OPENER_AFTER = 'k1=I0t.actions;window.addEventListener("sand-open-settings",function(ev){try{const s=ev&&ev.detail&&typeof ev.detail.section==="string"&&ev.detail.section.length>0?ev.detail.section:"general";k1.open(Uf.settings({section:s}))}catch(_sandOpenSettingsErr){}});function xRn';

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error("Original Auto-review renderer anchor is missing or ambiguous.");
  return source.replace(before, after);
}

export function patchOriginalAutoReviewApproval(source) {
  let result = replaceOnce(source, LOAD_BEFORE, LOAD_AFTER);
  result = replaceOnce(result, SURFACE_BEFORE, SURFACE_AFTER);
  result = replaceOnce(result, SETTLED_NOTE_BEFORE, SETTLED_NOTE_AFTER);
  result = replaceOnce(result, RESOLVE_BEFORE, RESOLVE_AFTER);
  result = replaceOnce(result, 'function me(t){const e=P.c(43)', 'function me(t){const[arError,setArError]=F.useState(null);const e=P.c(43)');
  result = replaceOnce(result, 'i(L),pe({', 'i(L),setArError(null),pe({');
  result = replaceOnce(result, '.then(()=>i(void 0),()=>i(void 0))', '.then(()=>i(void 0),error=>{i(void 0);setArError(error instanceof Error?error.message:String(error))})');
  return replaceOnce(result, RETURN_BEFORE, RETURN_AFTER);
}

/** Wire CustomEvent("sand-open-settings") → k1.open(Uf.settings({section})) on the main registry chunk. */
export function patchAutoReviewSettingsOpener(source) {
  return replaceOnce(source, SETTINGS_OPENER_BEFORE, SETTINGS_OPENER_AFTER);
}
