// Grok Bot 0.61.0 chat-header identity control, ported onto the checksum-pinned 0.18
// renderer chunk. 0.18 already ships the whole header mechanism; this patch changes
// three things inside `aSn` so the identity control reads like 0.61.0's.
//
// Evidence (byte-sourced 2026-09-29 from the official Grok Bot 0.61.0 macOS app,
// bundle com.anysphere.sand at /Applications/Grok Bot.app, renderer chunk
// dist/renderer/assets/index-DIQ9cJ4R.js inside its app.asar; plus a live AX read of
// both installed apps, see the table below).
//
//   * Both versions render a `sand-chat-header` at the top of the chat column. Measured
//     on the running apps (1728x1024 window):
//         0.18 Grok Node : AXButton (查看智能体设置) @347,8  88x28
//         0.61 Grok Bot  : AXButton (查看对话详情)   @804,10 110x40
//     So 0.18 is NOT missing the control — it is left-aligned, smaller, plain, and
//     wired to agent settings. The delta is three field-level edits, not a new element.
//
//   * 0.18's identity button, verbatim (aSn, byte 4895183):
//         A=p.jsxs("button",{"aria-controls":upe,"aria-expanded":o,
//                            "aria-label":"View agent settings",
//                            className:Z,onClick:u,style:X,type:"button",
//                            children:[xe,Ne]})
//     where `o`=isInfoOpen, `c`=onToggleInfo, `u`=onToggleSettings, `Z`=identity class,
//     `X`=identity style (undefined). Note `aria-expanded` is already bound to the info
//     pane while the click opens settings — 0.18 upstream is internally inconsistent
//     here, and 0.61.0 resolves it by pointing the button at the details pane. This
//     patch follows 0.61.0.
//
//   * The children `[xe, Ne]` are the avatar + presence dot (`ml({agent,size:"xs"})`)
//     and the name/title pair, both already present in 0.18 (`sand-chat-header__avatar`,
//     `sand-chat-header__title`, `sand-chat-header__name`). The avatar span carries no
//     accessibility node, which is why the AX tree only shows the static text — 0.18
//     does draw the avatar.
//
//   * Centring: 0.61.0's header root is `sand-rvj5dj` (=display:grid) plus
//     `sand-37c5m6` (=grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)), and the
//     identity control carries `sand-1npkx4u` (=grid-column:2). Two 1fr flanks around an
//     auto middle column are what centre the pill — not justify-content. 0.18's root is
//     the same class list minus the grid, i.e. flex + `sand-1qughib`
//     (justify-content:space-between), which left-aligns. `sand-37c5m6` does not exist
//     in the pinned 0.18 stylesheet, so the template is inlined; `sand-rvj5dj` and
//     `sand-1npkx4u` both do exist and are reused.
//
//   * Pill surface, 0.61.0's identity class resolved against its stylesheet
//     (padding 7.5/7.5/13.5/7.5, border .5px solid --sand-border-weak, radius 9999px,
//     background --sand-bg-elevated, box-shadow --sand-shadow-inline). 0.18 ships the
//     radius-6px / no-border / no-background / no-shadow version, so the surface is
//     inlined as a style object instead of borrowed as class names.
//
//   * `box-shadow:var(--sand-shadow-inline)` is NOT a stylesheet token in 0.61.0 — it is
//     a JS-composed constant (index.eager-app-C8vlFwEg.js @999540):
//         Co.inline = "0 4px 12px -1px var(--sand-shadow-inline-ambient),
//                      0 2px 4px -2px var(--sand-shadow-inline-key),
//                      0 0 0 1px var(--sand-shadow-ring)"
//     All three component tokens exist in the pinned 0.18 stylesheet with byte-identical
//     values (#00000014 / #0000000f / #e4e4e40a), so the original string is copied
//     verbatim — no approximation, no substitute token.
//
//   * The label is written as a raw `"View conversation details"` literal in the
//     `aria-label` display prop, not as a runtime RLocT wrapper. main-i18n already ships
//     that exact pair sourced from 0.61.0 message id +fxiY8 (MAIN_I18N_PAIRS, mode FULL),
//     and the engine keys on `prop:"literal"` so it localises the label — and the
//     pre-existing breadcrumb crumb that already used the same literal. A runtime wrapper
//     would have hidden the literal from the engine and shipped English under a Chinese UI.
//     This is also why 0.18's `"View agent settings"` row had to leave
//     MAIN_I18N_LOCAL_PAIRS: this patch removed its only anchor, and applyPair fails
//     closed on a zero-anchor pair. The build caught it, which is the gate working.
//
//   * `style` on a NATIVE element must be a plain object. `X` used to be spread in as
//     `style:[X,RChIdentity]`, and `X` is `D.style` on a `{className}`-only object, i.e.
//     `undefined` — so the array reached React, which then tried
//     `style["0"] = …` and threw
//     `TypeError: Failed to set an indexed property [0] on 'CSSStyleDeclaration'`.
//     That killed the whole chat view behind the error boundary ("This view failed to
//     load.") while the build stayed green and every chunk passed `node --check`.
//     `sidebar-search-renderer-patch.mjs` gets away with `style:[a,b]` because those go
//     to `fr`, whose own props are merged by stylex and never land on a DOM node.
//     Dropping `X` costs nothing — it was always `undefined`.
//
// Not ported: 0.61.0's `sand-chat-header__controls` (publish/share menu) and the
// `bo()`-driven subtitle. The controls are the bot-template surface, which is out of
// scope; the subtitle resolver is imported across chunks and was not readable, so it is
// recorded as uncertainty rather than invented.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { DISPLAY_PROPS } from "./i18n-patch-engine.mjs";

const COMPONENT_ANCHOR = "function aSn(n){const e=he.c(109),";

// q is the shared `sand-chat-header` root for both the agent and the no-agent branch.
const ROOT_BEFORE =
  'q={className:"sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli"};';
const ROOT_AFTER =
  'q={className:"sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-euugli sand-rvj5dj",style:RChHeaderGrid};';

const IDENTITY_BEFORE =
  '"aria-label":"View agent settings",className:Z,onClick:u,style:X,type:"button"';
const IDENTITY_AFTER =
  '"aria-label":"View conversation details",className:Z,onClick:()=>RChOpenInfo(c,o,RChOpenOv),style:RChIdentity,type:"button"';

const IDENTITY_ROW_BEFORE = 'B=p.jsxs("div",{className:N,style:E,children:[A,I]})';
const IDENTITY_ROW_AFTER = 'B=p.jsxs("div",{className:N,style:RChIdentityRow,children:[A,I]})';

const CONTROLS_BEFORE = 'j=p.jsxs("div",{className:ee,style:Y.style,children:[te,ne]})';
const CONTROLS_AFTER = 'j=p.jsxs("div",{className:ee,style:RChControls,children:[te,ne]})';

// --- Transparent chat toolbar ----------------------------------------------------------------
//
// 0.18's chat-column top bar (`sand-toolbar`, in `qLn`) carries `sand-1ua6jya`, which
// resolves to `background-color:var(--cursor-bg-editor)` in the pinned stylesheet. That is
// an opaque band, so transcript text scrolling under the header is hidden instead of
// showing through beside the identity control.
//
// 0.61.0's `sand-toolbar` carries no background declaration at all — the header is
// transparent, which is what lets the text behind the pill read through. Verified by
// extracting every class from both `sand-toolbar` class sets and resolving them against
// their own stylesheets: 0.18 yields `sand-1ua6jya` -> `background-color:var(--cursor-bg-editor)`,
// 0.61 yields nothing.
//
// So this is not a property of the pill (0.61's pill has the same
// `background-color:var(--sand-bg-elevated)`); it is the bar behind it. Dropping the class
// is therefore the whole fix, and it also drops no other rule: `sand-1ua6jya` is only ever
// a background here.
//
// Both variants of the class set are handled. The anchors are pinned by their surrounding
// classes because `sand-1ua6jya` occurs 33 times across the chunk.
const TOOLBAR_FILL_0_BEFORE = "sand-12w9bfk sand-b51amx sand-1ua6jya sand-1a4o4su sand-17v0fby\"}";
const TOOLBAR_FILL_0_AFTER = "sand-12w9bfk sand-b51amx sand-1a4o4su sand-17v0fby\"}";
const TOOLBAR_FILL_1_BEFORE = "sand-b51amx sand-1ua6jya sand-1a4o4su sand-17v0fby sand-oegz02";
const TOOLBAR_FILL_1_AFTER = "sand-b51amx sand-1a4o4su sand-17v0fby sand-oegz02";

// --- Suppress the computer control ------------------------------------------------------------
//
// 0.61.0's chat header does not render a computer button. The class name
// `kC="sand-chat-header__computer"` still exists there, but only for two non-rendering
// purposes: it is passed as a container-name to the identity block
// (`Y("sand-chat-header__identity",kC,B.className)`), and `p1e` (the `.` + kC selector) is
// the fallback focus target used when the details pane closes
// (`document.querySelector(p1e)`). Neither draws a control.
//
// 0.18 does render one, gated on `!o||m` (`o` = details pane open, `m` = computer in use),
// so it appears as soon as the pane is closed — which is exactly the stray icon reported
// against this build. The fix is to make that branch unreachable. The computer surface
// itself is unaffected: it is the details pane's "电脑" tab, a separate path.
const COMPUTER_CONTROL_BEFORE =
  '!o||m?p.jsx(yo,{content:iSn,disabled:!m,children:p.jsx(fr,{';
const COMPUTER_CONTROL_AFTER =
  '!1?p.jsx(yo,{content:iSn,disabled:!m,children:p.jsx(fr,{';

// --- Suppress the toolbar hairline ----------------------------------------------------------
//
// 0.18 renders a `sand-toolbar-divider` inside the chat header, and it is a dynamic element
// rather than a static class: its opacity is driven by a scroll-timeline animation
// (`animation-name:sand-18re5ia-B`, `animation-timeline:--sand-transcript-scroll`,
// `animation-range:0 16px`), so it fades in as the transcript scrolls under the bar. That
// hairline reads as a separator only while the bar behind it is opaque; once the bar is
// made transparent to match 0.61.0, the line is left floating over the transcript, which
// 0.61.0 never shows because it has no such element at all (`sand-toolbar-divider` does not
// occur anywhere in 0.61.0's renderer).
//
// Located by measuring the live build: the element sits at y=44..45 directly under the
// header and computes to `background-color:rgba(252,252,252,0.1)` over `--sand-border-weak`,
// which is what the reported line is. The class cannot simply be dropped because the opacity
// animation would still paint it; the render condition is what has to go. 0.61.0's header
// carries only its own controls, so making this branch unreachable matches it.
const TOOLBAR_DIVIDER_BEFORE =
  'q=t||s?null:p.jsx("div",{"aria-hidden":!0,className:re("sand-toolbar-divider"';
// `!0` is `true`, so the ternary takes its `null` branch. Mind the polarity: `!1?null:X`
// evaluates to `X` and would keep rendering the hairline, which is exactly the mistake this
// constant was first written with. The test suite evaluates the patched expression for real,
// so a flip here fails the build rather than shipping the line.
const TOOLBAR_DIVIDER_AFTER =
  'q=!0?null:p.jsx("div",{"aria-hidden":!0,className:re("sand-toolbar-divider"';

// --- Match 0.61.0's identity avatar size -----------------------------------------------------
//
// 0.61.0 renders the identity avatar as `Sa({agent,fillPx:t2,size:"sm"})` with `t2=24`.
// 0.18 renders the same slot as `ml({agent,fillPx:Tve,size:"xs"})` with `Tve=20`. That is the
// whole size difference the pill inherits — 20px of fill inside 98x36 versus 24px inside
// 110x40, which is most of the 12px x 4px the pill still measured short.
//
// `Jj={xs:16,sm:22,md:28,lg:36,xl:72}` is 0.18's own size table, so `size:"sm"` here would
// mean 22, not 24. `fillPx` wins over `size` in `ml` (`const E=r??Jj[l]`), so the fill is what
// actually sizes the glyph; 24 is passed explicitly to match 0.61.0 exactly, and `size:"sm"`
// is bumped alongside it so the two do not disagree.
//
// The anchor is pinned on the surrounding memo-slot expression because `fillPx:Tve` appears
// three times in the chunk and `p.jsx(ml,{agent:t,fillPx:Tve,isStatic:!0,size:"xs"})` twice —
// once for the breadcrumb crumb, which must keep 0.18's own size.
const IDENTITY_AVATAR_BEFORE =
  'e[72]!==t?(Q=p.jsx(ml,{agent:t,fillPx:Tve,isStatic:!0,size:"xs"}),e[72]=t,e[73]=Q)';
const IDENTITY_AVATAR_AFTER =
  'e[72]!==t?(Q=p.jsx(ml,{agent:t,fillPx:24,isStatic:!0,size:"sm"}),e[72]=t,e[73]=Q)';

// --- Overview landing ------------------------------------------------------------------------
//
// The details pane is mounted unconditionally at the app root, so its section is
// component state that survives close/open. 0.18's old control forced the "settings"
// section on every activation, so a user who ever clicked it keeps landing on the
// settings form instead of the overview the 0.61.0 control shows. Opening therefore has
// to ask for the overview section explicitly.
//
// The pane controller exposes `openSection` (its `P`), and the props object the chat
// header reads is the same literal that already carries `infoPane:hr` and
// `toggleInfoPane:Qt` — verified at the chunk level, both live in one object literal. So
// the fix is one prop threaded down from the app root, and the identity control's handler
// becomes "toggle, and when that opened it, also ask for the overview section".

const APP_PROPS_BEFORE =
  "infoPane:hr,composer:pn,agentCommands:$i,handleToggleSidebar:dn,toggleInfoPane:Qt";
const APP_PROPS_AFTER =
  "infoPane:hr,composer:pn,agentCommands:$i,handleToggleSidebar:dn,toggleInfoPane:Qt,openInfoOverview:hr.openSection";

const CHAT_HEADER_CALL_BEFORE =
  "onToggleInfo:n.toggleInfoPane,onToggleSettings:n.toggleAgentSettings,";
const CHAT_HEADER_CALL_AFTER =
  "onToggleInfo:n.toggleInfoPane,onToggleSettings:n.toggleAgentSettings,onOpenInfoOverview:n.openInfoOverview,";

const ASN_SIGNATURE_BEFORE = "onToggleInfo:c,onToggleSettings:u,onManageSharedRoom:d}=n";
const ASN_SIGNATURE_AFTER =
  "onToggleInfo:c,onToggleSettings:u,onOpenInfoOverview:RChOpenOv,onManageSharedRoom:d}=n";

// The two memo slot lists below must track the new prop rather than the old handler. `u`
// (onToggleSettings) becomes unread in this component once the identity control stops
// calling it, so its slot is reused instead of growing the memo's allocation — `he.c(109)`
// caps the slot count, so a fresh index is not available.
const ASN_OUTER_DEP_BEFORE =
  "e[1]!==t||e[2]!==i||e[3]!==m||e[4]!==o||e[5]!==d||e[6]!==c||e[7]!==u||e[8]!==s||e[9]!==v||e[10]!==r";
const ASN_OUTER_DEP_AFTER =
  "e[1]!==t||e[2]!==i||e[3]!==m||e[4]!==o||e[5]!==d||e[6]!==c||e[7]!==RChOpenOv||e[8]!==s||e[9]!==v||e[10]!==r";
const ASN_OUTER_SET_BEFORE =
  "e[1]=t,e[2]=i,e[3]=m,e[4]=o,e[5]=d,e[6]=c,e[7]=u,e[8]=s,e[9]=v,e[10]=r";
const ASN_OUTER_SET_AFTER =
  "e[1]=t,e[2]=i,e[3]=m,e[4]=o,e[5]=d,e[6]=c,e[7]=RChOpenOv,e[8]=s,e[9]=v,e[10]=r";

const IDENTITY_MEMO_DEP_BEFORE =
  "e[90]!==D||e[91]!==o||e[92]!==u||e[93]!==Z||e[94]!==xe||e[95]!==Ne";
const IDENTITY_MEMO_DEP_AFTER =
  "e[90]!==D||e[91]!==o||e[92]!==RChOpenOv||e[93]!==Z||e[94]!==xe||e[95]!==Ne";
const IDENTITY_MEMO_SET_BEFORE =
  ",e[90]=D,e[91]=o,e[92]=u,e[93]=Z,e[94]=xe,e[95]=Ne,e[96]=A";
const IDENTITY_MEMO_SET_AFTER =
  ",e[90]=D,e[91]=o,e[92]=RChOpenOv,e[93]=Z,e[94]=xe,e[95]=Ne,e[96]=A";

// Classes borrowed from 0.18's own stylesheet rather than inlined.
export const HEADER_CLASS_NAMES = Object.freeze([
  "sand-rvj5dj", // display:grid
  "sand-1npkx4u", // grid-column:2 (the centre cell)
  "sand-3nfvp2", // display:inline-flex
  "sand-6s0dn4", // align-items:center
  "sand-1ypdohk", // cursor:pointer
  "sand-1c4vz4f", // flex-grow:0
  "sand-s83m0k", // flex-shrink:1
  "sand-dl72j9", // flex-basis:auto
  "sand-euugli", // min-width:0
  "sand-lvsv26", // -webkit-app-region:no-drag
]);

// Custom properties the inlined pill surface reads. A stylesheet change that drops one
// of these would otherwise ship a silently unstyled control.
export const HEADER_CUSTOM_PROPERTIES = Object.freeze([
  "--sand-border-weak",
  "--sand-bg-elevated",
  "--sand-shadow-inline-ambient",
  "--sand-shadow-inline-key",
  "--sand-shadow-ring",
]);

// The trailing newline is load-bearing, not cosmetic: this block ends in a `const`
// declaration, and it is spliced straight into COMPONENT_ANCHOR, which starts with
// `function`. `const X = {…}function f(){}` on one line is a SyntaxError — ASI only
// fires at a line terminator — whereas two adjacent function declarations are fine,
// which is why routine-surfaces-renderer-patch.mjs also ends its block with "\n".
const COMPONENT_SOURCE = String.raw`
function RChOpenInfo(toggle,isOpen,openOverview){if(typeof toggle!=="function")return;toggle();if(isOpen||typeof openOverview!=="function")return;try{openOverview("overview")}catch(_e){}}
const RChHeaderGrid={gridTemplateColumns:"minmax(0,1fr) auto minmax(0,1fr)"};
const RChControls={gridColumn:"3"};
const RChIdentityRow={gridColumn:"2"};
const RChIdentity={paddingTop:"7.5px",paddingInlineEnd:"13.5px",paddingBottom:"7.5px",paddingInlineStart:"7.5px",borderWidth:".5px",borderStyle:"solid",borderColor:"var(--sand-border-weak)",borderRadius:"9999px",backgroundColor:"var(--sand-bg-elevated)",boxShadow:"0 4px 12px -1px var(--sand-shadow-inline-ambient), 0 2px 4px -2px var(--sand-shadow-inline-key), 0 0 0 1px var(--sand-shadow-ring)",textAlign:"start"}
`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalChatHeaderIdentity(source) {
  let patched = replaceExactlyOnce(source, COMPONENT_ANCHOR, COMPONENT_SOURCE + COMPONENT_ANCHOR, "chat header component insertion");
  // Thread openInfoOverview from the app root before the component starts reading it.
  patched = replaceExactlyOnce(patched, APP_PROPS_BEFORE, APP_PROPS_AFTER, "app root openInfoOverview prop");
  patched = replaceExactlyOnce(patched, CHAT_HEADER_CALL_BEFORE, CHAT_HEADER_CALL_AFTER, "chat header onOpenInfoOverview wiring");
  patched = replaceExactlyOnce(patched, ASN_SIGNATURE_BEFORE, ASN_SIGNATURE_AFTER, "chat header signature");
  patched = replaceExactlyOnce(patched, ASN_OUTER_DEP_BEFORE, ASN_OUTER_DEP_AFTER, "chat header outer memo dependency");
  patched = replaceExactlyOnce(patched, ASN_OUTER_SET_BEFORE, ASN_OUTER_SET_AFTER, "chat header outer memo slot");
  patched = replaceExactlyOnce(patched, ROOT_BEFORE, ROOT_AFTER, "chat header root grid");
  patched = replaceExactlyOnce(patched, IDENTITY_BEFORE, IDENTITY_AFTER, "chat header identity control");
  patched = replaceExactlyOnce(patched, IDENTITY_MEMO_DEP_BEFORE, IDENTITY_MEMO_DEP_AFTER, "chat header identity memo dependency");
  patched = replaceExactlyOnce(patched, IDENTITY_MEMO_SET_BEFORE, IDENTITY_MEMO_SET_AFTER, "chat header identity memo slot");
  patched = replaceExactlyOnce(patched, IDENTITY_ROW_BEFORE, IDENTITY_ROW_AFTER, "chat header identity row placement");
  patched = replaceExactlyOnce(patched, CONTROLS_BEFORE, CONTROLS_AFTER, "chat header controls placement");
  patched = replaceExactlyOnce(patched, COMPUTER_CONTROL_BEFORE, COMPUTER_CONTROL_AFTER, "chat header computer control suppression");
  patched = replaceExactlyOnce(patched, TOOLBAR_FILL_0_BEFORE, TOOLBAR_FILL_0_AFTER, "chat toolbar opaque fill (variant 0)");
  patched = replaceExactlyOnce(patched, TOOLBAR_FILL_1_BEFORE, TOOLBAR_FILL_1_AFTER, "chat toolbar opaque fill (variant 1)");
  patched = replaceExactlyOnce(patched, TOOLBAR_DIVIDER_BEFORE, TOOLBAR_DIVIDER_AFTER, "chat toolbar hairline suppression");
  return replaceExactlyOnce(patched, IDENTITY_AVATAR_BEFORE, IDENTITY_AVATAR_AFTER, "chat header identity avatar size");
}

/**
 * Fail closed unless every borrowed class and every custom property the inlined pill
 * surface reads is actually defined by the pinned stylesheet.
 */
export function assertChatHeaderIdentityStylesResolve(cssText, {
  classNames = HEADER_CLASS_NAMES,
  customProperties = HEADER_CUSTOM_PROPERTIES,
} = {}) {
  const unresolvedClasses = classNames.filter(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`\\.${escaped}(?![\\w-])`).test(cssText);
  });
  const unresolvedProperties = customProperties.filter(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`${escaped}\\s*:`).test(cssText);
  });
  if (unresolvedClasses.length > 0 || unresolvedProperties.length > 0) {
    const parts = [];
    if (unresolvedClasses.length > 0) parts.push(`classes: ${unresolvedClasses.join(", ")}`);
    if (unresolvedProperties.length > 0) {
      parts.push(`custom properties: ${unresolvedProperties.join(", ")}`);
    }
    throw new Error(
      `Chat-header identity styles are missing from the pinned renderer stylesheet — ${parts.join("; ")}`,
    );
  }
  return { classes: classNames.length, customProperties: customProperties.length };
}

export async function applyOriginalRendererChatHeaderIdentity({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(COMPONENT_ANCHOR)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one original renderer chunk for the chat-header identity patch, found ${candidates.length}.`,
    );
  }
  const candidate = candidates[0];
  // The label must stay a single RLocT call with the 0.61.0 English source string, so
  // the 0.61.0 message id can be traced to it and so the English fallback is the same
  // wording 0.61.0 uses.
  // The label must stay a raw literal in a display-prop position so main-i18n can pin
  // it to 0.61.0's +fxiY8 pair; a runtime RLocT wrapper would hide it from the engine
  // and ship an English-only control under a Chinese UI.
  const reachable = DISPLAY_PROPS.filter(
    prop =>
      IDENTITY_AFTER.includes(`${prop}:"View conversation details"`) ||
      IDENTITY_AFTER.includes(`"${prop}":"View conversation details"`),
  );
  if (!reachable.includes("aria-label")) {
    throw new Error("Chat-header identity lost its localizable 0.61.0 label.");
  }
  if (!IDENTITY_AFTER.includes("RChOpenInfo(c,o,RChOpenOv)")) {
    throw new Error("Chat-header identity does not open the details pane.");
  }
  if (ROOT_AFTER.includes("sand-rvj5dj") === false || !ROOT_AFTER.includes("RChHeaderGrid")) {
    throw new Error("Chat-header identity lost its three-column grid root.");
  }
  // A native element's `style` prop must stay a plain object. An array here compiles
  // fine and passes `node --check`, then throws "Failed to set an indexed property [0] on
  // 'CSSStyleDeclaration'" at render time and takes the whole view down behind the error
  // boundary — see the header comment.
  for (const fragment of [IDENTITY_AFTER, ROOT_AFTER, CONTROLS_AFTER]) {
    if (/style:\[/.test(fragment)) {
      throw new Error("Chat-header identity puts an array in a native style prop.");
    }
  }
  let checked = { classes: 0, customProperties: 0 };
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".css")) continue;
    const result = assertChatHeaderIdentityStylesResolve(await readFile(path.join(assetsRoot, name), "utf8"));
    checked.classes += result.classes;
    checked.customProperties += result.customProperties;
  }
  if (checked.classes === 0) {
    throw new Error("Chat-header identity found no renderer stylesheet to validate against.");
  }
  const patched = patchOriginalChatHeaderIdentity(candidate.source);
  // The overview landing is a three-hop wire: app root prop -> chat header prop -> the
  // control's handler. Assert every hop survived, because a dropped hop would still build
  // and still look right while quietly landing on the settings section.
  for (const [needle, what] of [
    ["openInfoOverview:hr.openSection", "app root openInfoOverview prop"],
    ["onOpenInfoOverview:n.openInfoOverview", "chat header onOpenInfoOverview wiring"],
    ["onOpenInfoOverview:RChOpenOv", "chat header onOpenInfoOverview destructure"],
    ['openOverview("overview")', "overview landing request"],
    ["style:RChIdentityRow", "identity row grid placement"],
  ]) {
    if (!patched.includes(needle)) {
      throw new Error(`Chat-header identity lost its ${what}.`);
    }
  }
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-chat-header-identity",
    chunks: [
      {
        role: "chat-header",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
        validatedStyleClasses: HEADER_CLASS_NAMES,
        validatedCustomProperties: HEADER_CUSTOM_PROPERTIES,
      },
    ],
    features: ["chat-header-identity-centre", "chat-header-identity-open-details"],
    transformations: [
      "insert-chat-header-identity-styles",
      "chat-header-root-three-column-grid",
      "identity-control-grid-column-2",
      "identity-control-open-details-pane",
      "identity-control-pill-surface",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-chat-header-identity-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
