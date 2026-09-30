// Grok Bot 0.62.0 "Add selection to prompt", ported onto the checksum-pinned 0.18
// renderer chunk.
//
// Evidence (byte-sourced 2026-09-29 from the official Grok Bot 0.62.0 macOS app,
// bundle com.anysphere.sand at /Applications/Grok Bot.app; renderer chunks
// dist/renderer/assets/index-BYEktDeR.js, chunk-prompt-editor-CQvDR83o.js and
// index-Cp99LmKM.css inside its app.asar — the app was upgraded from 0.61.0 at 06:47
// the same day, so these bytes are 0.62.0's). The chip's markup was not read from the
// minified bundle: it was dumped from the running 0.62.0 app over CDP after driving its
// own "Add to prompt" button, so class names and nesting are measured, not inferred.
//
// 1. The command
//   `mod+l` occurs exactly once in 0.62.0's main chunk, as a first-class action rather
//   than a second hotkey on the focus action:
//     {id:"sand.addSelectionToPrompt", label:Me({id:"WWv1+v"}), hotkey:"mod+l",
//      run:N.addSelectionToPrompt}
//   0.18 still binds both to one action:
//     {id:"sand.focusInput",label:"Focus prompt",hotkey:"mod+i, mod+l",run:_.focusPrompt}
//   so the patch performs the split and gives the new action its own behaviour.
//
// 2. The action body
//     const ke = () => {
//       const Ve = Y5e(document.getSelection());
//       const We = Ve == null ? null : Z5e(Ve);
//       if (We != null && te.current?.insertQuote(We) === true) {} else { pe(); }
//     };
//   i.e. read the selection, normalise it, hand it to the composer, fall back to
//   focusing the prompt. `pe` is 0.18's `le`.
//
// 3. Selection validity (`kM` + `K5e`) and normalisation (`Z5e`)
//   Non-collapsed range, both ends resolving to an element, neither end inside
//   `Ix` = "button, input, textarea, select, [contenteditable='true'],
//   [contenteditable='plaintext-only']"; then `selection.toString().trim()`, then
//   `\r\n?` → a single space, trim, and cap at `Tx` = 20000 with " [quote truncated]".
//   0.62 additionally requires the range to sit inside one `[data-sand-selection-surface]`,
//   an attribute 0.18's renderer never emits, so that half is dropped rather than invented.
//
// 4. When the toolbar appears — the part that is easy to get wrong
//   `O6e` is a pointer state machine, not a selectionchange mirror:
//     pointerdown  → remember {pointerId, rangeBefore: cloneRange()}, and HIDE
//     pointerup    → show only if the resulting range differs from rangeBefore
//                    (x0 compares start/end container+offset); otherwise mark dismissed
//     pointercancel→ clear press, hide
//     selectionchange → update ONLY while n.press == null, i.e. never mid-drag
//     window blur → re-evaluate
//   That is the difference between "the toolbar pops up while the mouse is still
//   dragging" and "it pops up once the selection settles". This patch implements the
//   same machine, including the dismissed-range guard so a click that does not move the
//   caret does not flash the toolbar.
//
// 5. The inserted node is a chip, not text
//   The main chunk's `insertQuote` is `k6e(){return!1}`, a pre-load stub; the real one
//   lives in the lazy prompt-editor chunk and re-registers live controls:
//     insertQuote: q => { const ed = getEditor(); return ed == null ? false
//       : ed.chain().command(Ht).focus()
//           .insertContent([{type: is, attrs:{quote:q}}, {type:"text", text:" "}]).run(); }
//   Dumping the live 0.62.0 composer shows what `is` renders as — a React NodeView:
//     <p><span class="react-renderer node-quoteReference" contenteditable="false">
//       <span data-type="quote-reference" data-node-view-wrapper="">
//         <span data-type="quote-reference" title="…"
//               class="sand-inserted-chip …15 classes…">
//           <span aria-hidden="true" class="…icon wrapper…">
//             <i class="ui-icon … cursor-ico">
//           …the quoted text, wrapped in double quotes…
//   So the node type is `quoteReference`, the text lives in an attribute, and the label
//   is rendered with surrounding double quotes. 0.18 has no such node, so this patch
//   adds one, modelled on 0.18's own `mention` node (`Kl.create({name:"mention",
//   group:"inline", atom:true, addNodeView(){return VCe(C5n)}})`).
//   `Kl` is Node.create in this chunk; `la` is Extension.create and cannot make a node.
//
//   Two runtime-only constraints came from shipping the first attempt and reading the
//   renderer console, neither of which any static check can see:
//     * `bt` is the module-level icon component (it renders the `ui-icon` glyph 0.62's
//       chip also uses). `rn` is used as an icon component too but is only bound inside
//       another component's scope, so it threw `rn is not defined` on insert.
//     * The NodeView's root element MUST be this chunk's `Tge` (NodeViewWrapper): the
//       editor throws "Please use the NodeViewWrapper component for your node view"
//       when the rendered root lacks the `data-node-view-wrapper` attribute. `Tge` also
//       supplies the `node-quoteReference` class and the `as` tag, exactly as 0.62 does.
//
// Design-system delta (every class resolved against the pinned 0.18 stylesheet
// index-lCyB53CO.css, re-checked at build time by assertSelectionClassesResolve()):
//   * 11 of the 15 chip classes exist in 0.18 with byte-identical declarations:
//     sand-3nfvp2 (inline-flex), sand-6s0dn4 (align-items), sand-1jnr06f (gap 4px),
//     sand-t9pb60 (radius 6px), sand-9f619 (box-sizing), sand-16dsc37 (vertical-align),
//     sand-uxw1ft (nowrap), sand-1heor9g (color inherit), sand-jbqb8w (transparent bg),
//     sand-aalx5g (hover fill-ghost-hover) and the icon wrapper's sand-lup9mm (16px) +
//     sand-2lah0s (flex-shrink 0).
//   * `sand-g2ss61` (height:1lh) does not exist under the sand- prefix in 0.18, but
//     0.18 ships the same declaration as `ui-g2ss61` — the class-name hash is derived
//     from the declaration, so the prefix is all that differs across versions. Borrowed.
//   * `sand-3y1lgt` (padding-inline:3px), `sand-19yoxgu` (margin-inline:-3px) and
//     `sand-1bo111n` (hover color-mix) have no 0.18 equivalent at all, not under either
//     prefix; they are inlined on `style`, which React applies last.
//   * 0.62's hover is `sand-tfy4bk{background-color:var(--sand-fill-secondary)}`, and
//     0.18 ships that class with a byte-identical declaration. An earlier revision of this
//     patch recorded 0.18 as having no background hover at all and dropped the class on
//     that basis; that came from a search whose pattern required `{` straight after the
//     class name, and stylex emits `.cls:hover:not(#\#)…{…}` — the class was there all
//     along. When a stylesheet lookup says a class is missing, confirm the probe handles
//     the pseudo-class and `:not(#\#)` chain before concluding absence.
//   * The icon is `chat-bubble-ellipsis`, read off the live chip's
//     `i[data-icon-name]`, and 0.18 ships that exact name — same glyph, no approximation.
//     An earlier revision used `chat-bubbles` after mistaking the chip's `cursor-ico`
//     class for the icon name: that class names the `cursor-icons` FONT FAMILY, not the
//     glyph, so it identified nothing. To resolve an icon, read `data-icon-name`.
//     Drawn with `bt`, the component this chunk uses for its `ui-icon` glyphs — the same
//     component 0.62's own chip uses.
//   * The toolbar keeps 0.62's z-index:1 but overrides it inline: 0.62 portals to
//     document.body, this mount is inside the app root where z-index:1 is painted under
//     the transcript. 0.18's stylesheet also has no background hover rule for a chip
//     beyond the borrowed sand-aalx5g, which is why that one class is kept as-is.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { DISPLAY_PROPS } from "./i18n-patch-engine.mjs";

// --- Anchors --------------------------------------------------------------------------------
//
// Each was counted in the pinned chunk before being written down, and
// replaceExactlyOnce() re-checks the count, so an upstream change fails the build
// instead of silently half-patching the composer.

const HOOK_CALLBACKS_BEFORE =
  "X=S.useRef(null),se=S.useCallback(de=>{X.current=de},[]),le=S.useCallback(()=>{X.current?.focus()},[])";
const HOOK_RETURN_BEFORE = "registerPromptControls:se,focusPrompt:le,isSendRefused:Q";
const CONTROLS_BEFORE =
  'I?.({focus:()=>_m(f.current)?.commands.focus("end"),isVoiceSessionActive:()=>h.current,clear:()=>{';
const FOCUS_ACTION_BEFORE =
  '{id:"sand.focusInput",label:"Focus prompt",hotkey:"mod+i, mod+l",run:_.focusPrompt}';
const ACTION_DEPS_BEFORE = "_.focusPrompt,B.actions,R,q,L,o,l,c]";
const SLOT_SPAN_BEFORE =
  'p.jsx("span",{"aria-hidden":!0,ref:pn.attachComposerSlotLifecycle,style:{display:"none"}},pn.composerKey),';
const COMPONENT_ANCHOR = "function e9n({fieldClassName:n,";
// `hft` is 0.18's shared extension builder; this is its tail, where the prompt-surface
// nodes are pushed. The quote-reference node is appended right after prReference so it
// exists on the composer surface only, exactly like every other custom node there.
const EXTENSION_PUSH_BEFORE =
  'n.surface==="prompt"&&t.push(Jyn.configure({suggestion:n.prReference??null})),t}';
const EXTENSION_PUSH_AFTER =
  'n.surface==="prompt"&&t.push(Jyn.configure({suggestion:n.prReference??null})),n.surface==="prompt"&&t.push(RSelQuoteNode),t}';

const HOOK_CALLBACKS_AFTER =
  "X=S.useRef(null),se=S.useCallback(de=>{X.current=de},[]),le=S.useCallback(()=>{X.current?.focus()},[])," +
  "RSelAddToPrompt=S.useCallback(()=>{const q=RSelQuoteText();q==null||X.current?.insertQuote?.(q)===!0||le()},[le])";
const HOOK_RETURN_AFTER =
  "registerPromptControls:se,focusPrompt:le,addSelectionToPrompt:RSelAddToPrompt,isSendRefused:Q";
// 0.62 inserts `[quoteReference, {type:"text",text:" "}]`. The trailing text node is
// NOT decoration and must be kept: quoteReference is an inline atom, so without a
// following text position the caret has nowhere to land and every later insert fails
// silently — the symptom is "the first quote sticks and no selection after that ever
// appears". Dropping it on the grounds that a block node separates itself was wrong;
// that reasoning does not hold for an inline atom.
const CONTROLS_AFTER =
  'I?.({focus:()=>_m(f.current)?.commands.focus("end"),isVoiceSessionActive:()=>h.current,' +
  'insertQuote:q=>{const Z=_m(f.current);return Z==null?!1:Z.chain().focus().insertContent([{type:"quoteReference",' +
  'attrs:{quote:q}},{type:"text",text:" "}]).run()},clear:()=>{';
const FOCUS_ACTION_AFTER =
  '{id:"sand.focusInput",label:"Focus prompt",hotkey:"mod+i",run:_.focusPrompt},' +
  '{id:"sand.addSelectionToPrompt",label:"Add selection to prompt",hotkey:"mod+l",run:_.addSelectionToPrompt}';
const ACTION_DEPS_AFTER = "_.focusPrompt,_.addSelectionToPrompt,B.actions,R,q,L,o,l,c]";
const SLOT_SPAN_AFTER =
  'p.jsx("span",{"aria-hidden":!0,ref:pn.attachComposerSlotLifecycle,style:{display:"none"}},pn.composerKey),' +
  "p.jsx(RSelToolbar,{isMacPlatform:hs,onAddToPrompt:pn.addSelectionToPrompt}),";

// Chip classes, all resolved against the pinned 0.18 stylesheet.
export const SELECTION_CHIP_CLASS_NAMES = Object.freeze([
  "sand-3nfvp2", // display:inline-flex
  "sand-6s0dn4", // align-items:center
  "sand-1jnr06f", // gap:4px
  "sand-t9pb60", // border-radius:6px
  "sand-9f619", // box-sizing:border-box
  "ui-g2ss61", // height:1lh          (0.62's sand-g2ss61, under 0.18's other prefix)
  "sand-16dsc37", // vertical-align:top
  "sand-uxw1ft", // white-space:nowrap
  "sand-1heor9g", // color:inherit
  "sand-jbqb8w", // background-color:transparent
  "sand-aalx5g", // :hover background-color:var(--sand-fill-ghost-hover)
  "sand-lup9mm", // icon wrapper height:16px
  "sand-2lah0s", // icon wrapper flex-shrink:0
]);

// The toolbar's own classes, byte-identical to 0.62's in 0.18.
export const SELECTION_TOOLBAR_CLASS_NAMES = Object.freeze([
  "sand-13vifvy", // top:0
  "sand-1vjfegm", // z-index:1 (overridden inline, see the delta note above)
  "sand-78zum5", // display:flex
  "sand-6s0dn4", // align-items:center
  "sand-j8oexa", // padding-block:2px
  "sand-5k8d2m", // padding-inline:2px
  "sand-1qmwy7c", // border-radius:8px
  "sand-qjedn3", // border-width:.5px
  "sand-1y0btm7", // border-style:solid
  "sand-fnq37j", // border-color:var(--sand-border-default)
  "sand-10e981r", // background-color:var(--sand-bg-elevated)
  "sand-1z0g938", // popover shadow (0.18's own three-part value)
  "sand-87ps6o", // user-select:none
  "sand-17d4w8g", // button gap:6px
  "sand-qrzla8", // button padding-inline-end:4px (0.62's sand-11lfxj5)
  "sand-c342km", // button border-width:0
  "sand-jbqb8w", // button background-color:transparent
  "sand-tyxrsu", // button color
  "sand-1ypdohk", // button cursor
  "sand-tfy4bk", // button :hover background-color:var(--sand-fill-secondary)
  // Typography and metrics 0.62 gets from `gt.body2` + `Cn.medium`. Those are imported
  // recipes, not literals, so they are invisible in the bundle and only show up in the
  // rendered DOM: the live 0.62.0 button carries four more classes beyond F6e.button.
  // 0.18 ships all four, two of them under its other stylix prefix.
  "ui-11wthnw", // font-size:var(--cursor-font-size-base)      (0.62: sand-11wthnw)
  "ui-d4r4e8", // line-height:18px                            (0.62: sand-d4r4e8)
  "ui-12oo3zp", // letter-spacing:0                            (0.62: sand-12oo3zp)
  "sand-1rhlpx6", // font-weight:var(--sand-font-weight-medium) (0.62: sand-1rhlpx6)
]);

const CHIP_STYLE = { paddingInline: "3px", marginInline: "-3px" };
const CONTAINER_STYLE = { position: "fixed", zIndex: 2147483647 };
const BUTTON_STYLE = { paddingBlock: "3px", paddingInlineStart: "8px" };
const KBD_STYLE = { fontSize: "0.9em", opacity: 0.7, fontFamily: "inherit" };

// The trailing newline is load-bearing: this block ends in a `const` and is spliced
// directly in front of COMPONENT_ANCHOR, which starts with `function`.
const COMPONENT_SOURCE = String.raw`
const R_SEL_MAX=2e4,R_SEL_TRUNC="[quote truncated]",R_SEL_GAP=8,R_SEL_EDGE=8;
const R_SEL_INTERACTIVE="button, input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']";
// 0.62's $6e guard: a press inside the toolbar or inside a modal must not dismiss the
// toolbar, or the button can never be clicked.
const R_SEL_SELF='[data-sand-selection-actions], [aria-modal="true"]';
const R_SEL_CHIP_STYLE=${JSON.stringify(CHIP_STYLE)};
const R_SEL_CONTAINER_STYLE=${JSON.stringify(CONTAINER_STYLE)};
const R_SEL_BUTTON_STYLE=${JSON.stringify(BUTTON_STYLE)};
const R_SEL_KBD_STYLE=${JSON.stringify(KBD_STYLE)};
const R_SEL_CONTAINER_CLASS="sand-13vifvy sand-1vjfegm sand-78zum5 sand-6s0dn4 sand-j8oexa sand-5k8d2m sand-1qmwy7c sand-qjedn3 sand-1y0btm7 sand-fnq37j sand-10e981r sand-1z0g938 sand-87ps6o";
const R_SEL_BUTTON_CLASS="sand-3nfvp2 sand-6s0dn4 sand-17d4w8g sand-qrzla8 sand-c342km sand-jbqb8w sand-t9pb60 sand-tyxrsu sand-1ypdohk sand-uxw1ft sand-tfy4bk ui-11wthnw ui-d4r4e8 ui-12oo3zp sand-1rhlpx6";
const R_SEL_CHIP_CLASS="sand-inserted-chip sand-3nfvp2 sand-6s0dn4 sand-1jnr06f sand-t9pb60 sand-9f619 ui-g2ss61 sand-16dsc37 sand-uxw1ft sand-1heor9g sand-jbqb8w sand-aalx5g";
const R_SEL_CHIP_ICON_CLASS="sand-3nfvp2 sand-6s0dn4 sand-lup9mm sand-2lah0s";
function RSelEl(t){return t==null?null:t instanceof Element?t:t.parentElement}
function RSelRange(){if(typeof document==="undefined")return null;const t=document.getSelection();if(t==null||t.rangeCount===0||t.isCollapsed)return null;const e=RSelEl(t.anchorNode),n=RSelEl(t.focusNode);if(e==null||n==null)return null;if(e.closest(R_SEL_INTERACTIVE)!=null||n.closest(R_SEL_INTERACTIVE)!=null)return null;const s=t.toString().trim();if(s.length===0)return null;const i=t.getRangeAt(0).getBoundingClientRect();if(i.width===0&&i.height===0)return null;return{top:i.top,bottom:i.bottom,left:i.left,width:i.width,range:t.getRangeAt(0).cloneRange()}}
function RSelSame(t,e){if(t==null||e==null)return!1;return t.startContainer===e.startContainer&&t.startOffset===e.startOffset&&t.endContainer===e.endContainer&&t.endOffset===e.endOffset}
function RSelQuoteText(){const t=RSelRange();if(t==null)return null;const i=t.range.toString().replace(/\r\n?/gu," ").trim();return i.length===0?null:i.length<=R_SEL_MAX?i:i.slice(0,R_SEL_MAX)+" "+R_SEL_TRUNC}
function RSelChip(t){const{node:n,selected:s}=t,q=typeof n.attrs.quote=="string"?n.attrs.quote:"";
return p.jsx(Tge,{as:"span",className:R_SEL_CHIP_CLASS,"data-type":"quote-reference",title:q,style:R_SEL_CHIP_STYLE,children:[p.jsx("span",{"aria-hidden":!0,className:R_SEL_CHIP_ICON_CLASS,children:p.jsx(bt,{name:"chat-bubble-ellipsis",size:"sm"})}),p.jsx("span",{children:q===""?"":'"'+q+'"'})]})}
const RSelQuoteNode=Kl.create({name:"quoteReference",group:"inline",inline:!0,atom:!0,selectable:!0,addAttributes(){return{quote:{default:""}}},parseHTML(){return[{tag:'span[data-type="quote-reference"]'}]},renderText({node:t}){return'"'+(t.attrs.quote??"")+'"'},renderHTML({node:t}){return["span",{"data-type":"quote-reference",title:t.attrs.quote},'"'+(t.attrs.quote??"")+'"']},addNodeView(){return VCe(RSelChip)}});
function RSelToolbar(t){const{onAddToPrompt:s,isMacPlatform:i}=t,[a,o]=S.useState(null),c=S.useRef(null),[l,u]=S.useState(null);
S.useEffect(()=>{
// 0.62's O6e, kept structurally intact: a selection is shown on selectionchange ONLY
// while no pointer is down, and a drag only publishes its result on pointerup — and
// only when the range actually moved, so a plain click never flashes the toolbar.
//
// The '$6e' short-circuit on pointerdown is load-bearing and was missed in the first
// working build. '$6e(t)' is 't.closest("[data-sand-selection-actions], [aria-modal=
// \"true\"]") != null': a press that lands INSIDE the toolbar (or any modal) must not
// dismiss it. Without it, pressing the button itself hides the toolbar before the click
// can land, so the button is inert while a synthetic 'el.click()' still appears to work —
// which is exactly how it shipped broken. Keep the same selector string.
const st={shown:null,press:null,dismissed:null};
const snap=()=>{const r=RSelRange();return r==null?null:{top:r.top,bottom:r.bottom,left:r.left,width:r.width,range:r.range}};
const show=y=>{y!=null&&RSelSame(st.dismissed,y.range)||(st.dismissed=null,o(y))};
const onDown=e=>{if(e.target instanceof Element&&e.target.closest(R_SEL_SELF)!=null)return;
if(e.isPrimary===!0&&e.button===0){const s=document.getSelection();st.press={pointerId:e.pointerId,rangeBefore:s!=null&&s.rangeCount>0?s.getRangeAt(0).cloneRange():null};st.dismissed=null}else st.press=null;o(null)};
const onUp=e=>{const k=st.press;if(k==null||k.pointerId!==e.pointerId)return;st.press=null;const b=snap();if(b!=null&&RSelSame(k.rangeBefore,b.range)){st.dismissed=b.range;return}o(b)};
const onCancel=e=>{st.press!=null&&st.press.pointerId===e.pointerId&&(st.press=null,o(null))};
const onSelChange=()=>{st.press==null&&show(snap())};
const onBlur=()=>{st.press!=null&&(st.press=null,o(snap()))};
document.addEventListener("pointerdown",onDown,!0),document.addEventListener("pointerup",onUp,!0),document.addEventListener("pointercancel",onCancel,!0),document.addEventListener("selectionchange",onSelChange),window.addEventListener("blur",onBlur);
const first=snap();return first!=null&&o(first),()=>{document.removeEventListener("pointerdown",onDown,!0),document.removeEventListener("pointerup",onUp,!0),document.removeEventListener("pointercancel",onCancel,!0),document.removeEventListener("selectionchange",onSelChange),window.removeEventListener("blur",onBlur),o(null)}},[]);
S.useLayoutEffect(()=>{if(a==null||c.current==null)return void u(null);const e=c.current,y=e.offsetWidth,b=e.offsetHeight;if(y===0||b===0)return void u(null);let g=a.top-b-R_SEL_GAP;a.top-R_SEL_GAP<0&&(g=a.bottom+R_SEL_GAP);let f=a.left+a.width/2-y/2;f=Math.max(R_SEL_EDGE,Math.min(f,window.innerWidth-y-R_SEL_EDGE));u({top:Math.max(R_SEL_EDGE,g),left:f})},[a]);
if(a==null)return null;const Rd=s?"⌘L":"Ctrl+L",Ks=s?"Meta+L":"Control+L";
return p.jsx("div",{"aria-label":"Selection actions","data-sand-selection-actions":"",className:R_SEL_CONTAINER_CLASS,onMouseDown:e=>{e.preventDefault()},ref:c,role:"toolbar",style:l==null?R_SEL_CONTAINER_STYLE:{...R_SEL_CONTAINER_STYLE,top:l.top,left:l.left},children:p.jsx("button",{"aria-keyshortcuts":Ks,className:R_SEL_BUTTON_CLASS,onClick:s,style:R_SEL_BUTTON_STYLE,type:"button",children:[p.jsx("span",{children:"Add to prompt"}),p.jsx("kbd",{"aria-hidden":!0,style:R_SEL_KBD_STYLE,children:Rd})]})})}
`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/**
 * Fail closed unless every class the toolbar and the chip rely on is actually defined
 * by the pinned stylesheet. A hash change upstream would otherwise render an unstyled
 * control with nothing in the build failing.
 */
export function assertSelectionClassesResolve(cssText, classNames = [...SELECTION_CHIP_CLASS_NAMES, ...SELECTION_TOOLBAR_CLASS_NAMES]) {
  const unresolved = classNames.filter(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`\\.${escaped}(?![\\w-])`).test(cssText);
  });
  if (unresolved.length > 0) {
    throw new Error(
      `Selection classes are missing from the pinned renderer stylesheet: ${unresolved.join(", ")}`,
    );
  }
  return classNames.length;
}

/**
 * Fail closed unless both toolbar labels sit on a prop the i18n engine can key on.
 * Exported so the check itself can be mutation-tested.
 */
export function assertSelectionLabelsReachable(componentSource = COMPONENT_SOURCE, reachableProps = DISPLAY_PROPS) {
  const reachable = (text) =>
    reachableProps.some(prop => componentSource.includes(`${prop}:"${text}"`) || componentSource.includes(`"${prop}":"${text}"`));
  if (!reachable("Selection actions")) {
    throw new Error("Selection toolbar lost its localizable Selection actions label.");
  }
  if (!reachable("Add to prompt")) {
    throw new Error("Selection toolbar lost its localizable Add to prompt label.");
  }
  return 2;
}

export function patchOriginalSelectionAddToPrompt(source) {
  let patched = replaceExactlyOnce(source, COMPONENT_ANCHOR, COMPONENT_SOURCE + COMPONENT_ANCHOR, "selection toolbar source insertion");
  patched = replaceExactlyOnce(patched, HOOK_CALLBACKS_BEFORE, HOOK_CALLBACKS_AFTER, "composer addSelectionToPrompt callback");
  patched = replaceExactlyOnce(patched, HOOK_RETURN_BEFORE, HOOK_RETURN_AFTER, "composer addSelectionToPrompt surface");
  patched = replaceExactlyOnce(patched, CONTROLS_BEFORE, CONTROLS_AFTER, "composer insertQuote control");
  patched = replaceExactlyOnce(patched, FOCUS_ACTION_BEFORE, FOCUS_ACTION_AFTER, "addSelectionToPrompt action split");
  patched = replaceExactlyOnce(patched, ACTION_DEPS_BEFORE, ACTION_DEPS_AFTER, "action memo dependency");
  patched = replaceExactlyOnce(patched, EXTENSION_PUSH_BEFORE, EXTENSION_PUSH_AFTER, "quoteReference node registration");
  return replaceExactlyOnce(patched, SLOT_SPAN_BEFORE, SLOT_SPAN_AFTER, "selection toolbar mount");
}

export async function applyOriginalRendererSelectionAddToPrompt({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(COMPONENT_ANCHOR)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one original chunk for the selection toolbar patch, found ${candidates.length}.`);
  }
  const candidate = candidates[0];
  assertSelectionLabelsReachable();
  let checkedClasses = 0;
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".css")) continue;
    checkedClasses += assertSelectionClassesResolve(await readFile(path.join(assetsRoot, name), "utf8"));
  }
  if (checkedClasses === 0) {
    throw new Error("Selection toolbar found no renderer stylesheet to validate its classes against.");
  }
  const patched = patchOriginalSelectionAddToPrompt(candidate.source);
  // The action split and the node registration live in anchor replacements rather than
  // the injected source, so they are asserted on the patched chunk.
  if (!patched.includes('id:"sand.addSelectionToPrompt"') || !patched.includes('hotkey:"mod+l"')) {
    throw new Error("Selection toolbar lost its command action registration.");
  }
  if (patched.includes('hotkey:"mod+i, mod+l"')) {
    throw new Error("Selection toolbar did not take mod+l away from the focus action.");
  }
  if (!patched.includes('t.push(RSelQuoteNode)')) {
    throw new Error("The quote-reference node was never registered on the composer surface.");
  }
  if (patched.includes('type:"paragraph",content:[{type:"text",text:"> "')) {
    throw new Error("The quoted text is still being inserted as a markdown paragraph.");
  }
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 2,
    mode: "original-renderer-selection-add-to-prompt",
    chunks: [
      {
        role: "chat",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
        validatedStyleClasses: [...SELECTION_CHIP_CLASS_NAMES, ...SELECTION_TOOLBAR_CLASS_NAMES],
      },
    ],
    features: ["selection-add-to-prompt", "quote-reference-node"],
    transformations: [
      "inject-selection-toolbar-source",
      "add-quote-reference-node",
      "add-composer-addSelectionToPrompt",
      "add-composer-insertQuote-control",
      "split-mod-l-from-focus-action",
      "mount-selection-toolbar",
    ],
    deltas: [
      "toolbar appears on selection settle, not mid-drag: 0.62's O6e pointer state machine (press/pointerup/range comparison)",
      "pointerdown inside the toolbar does not dismiss it: 0.62's $6e short-circuit, without which the button can never be clicked",
      "inserted quote is a chip, not a markdown paragraph: 0.62 inserts a quoteReference node rendered by a React NodeView",
      "chip height:1lh borrowed as ui-g2ss61, 0.18's spelling of 0.62's sand-g2ss61",
      "padding-inline:3px / margin-inline:-3px inlined, no 0.18 class carries them",
      "z-index overridden inline: 0.62 portals to document.body where z-index:1 suffices, this mount is inside the app root",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-selection-add-to-prompt-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
