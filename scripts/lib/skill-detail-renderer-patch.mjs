// Grok Bot 0.62.0 "Learn from demonstration" skill-detail pane, ported onto the
// checksum-pinned 0.18 renderer chunk.
//
// Evidence (byte-sourced 2026-09-30 from the official Grok Bot 0.62.0 macOS app,
// bundle com.anysphere.sand at /Applications/Grok Bot.app, read out of its
// app.asar with the four-uint32 header — @0=4, @4=headerSize, @8=pickle size,
// @12=JSON byte count, so the data section starts at `8 + readUInt32LE(4)` and
// the JSON tree at offset 16 for `readUInt32LE(12)` bytes):
//   * The 0.62.0 skill detail is `mi` in dist/renderer/assets/chunk-view-CUl9t9OA.js
//     (156,946 B), reachable through the `sand-plugins-skill-detail` marker class,
//     which occurs exactly once in that chunk. 0.18 renders the same component as
//     `Hi` in dist/renderer/assets/view-B5Ug8wEm.js (103,572 B) — also the only
//     occurrence of the marker in 0.18's whole renderer tree.
//   * The teach-recording strings 0.62.0 uses to label the transcript button
//     (`iq = "learn-from-demonstration"`, `rq = "Learn from demonstration"`,
//     `oq = "teach-recording:"`, `sq = "The recording is finished. Learn the task
//     from it."`) all live in dist/renderer/assets/index.eager-app-C20nv6Dx.js
//     (1,416,407 B). 0.62.0 also relabels that button through QSe(), keyed on
//     `e.id === iq && e.label === lq()`. 0.18 ships the `sand_teach_by_demonstration`
//     feature gate and the `teach-recording` store event but none of those literals,
//     so the button and its modal are the 0.18 equivalents to bring in line here.
//
// What 0.18 gets wrong, and what this patch changes. All four deltas are the reason
// the two screenshots of the same popup do not match:
//
//  1. The instructions textarea. 0.18 pins it to `min-height: 80px` (sand-seoqlg)
//     plus `resize: vertical` (sand-288g5), so a multi-paragraph skill body is
//     clipped mid-line and the user is offered a drag handle. 0.62.0's
//     `Mn.textarea` recipe is content-sized instead: `field-sizing: content`
//     (sand-5f5z56), `min-height: 106px` (sand-jgen18), `max-height: 320px`
//     (sand-1sslpiy), `resize: none` (sand-tt52l0), `overflow-y: auto`
//     (sand-1odjw0f) and 0.62.0's thin-scrollbar recipe. It therefore grows with
//     the body, stops at 320px, then scrolls inside itself.
//  2. The detail root. 0.18's root is `display:flex; flex-direction:column` with
//     `gap: 24px` and no growth, so it is content-height inside the pane's own
//     scroll area and the dialog shows a large empty band under the form.
//     0.62.0's root is the plugins-pane flex recipe
//     (`flex-grow:1; flex-shrink:1; flex-basis:auto; min-height:0`) so the detail
//     owns the full pane height.
//  3. The scroll region. 0.62.0 routes a `skill` detail *straight* into the pane
//     root — `_s()` returns `kl(S.target)` for `S.target.kind === "skill"`, with no
//     outer ScrollPane — and the detail itself wraps its header+form in its own
//     `Kn` scroll pane over a `gap: 24px` column, with the action bar as a sibling
//     of that scroll pane. 0.18 wraps every detail in the pane-level scroll pane, so
//     0.18's detail has no inner scroll region of its own. This patch gives 0.18
//     the same shape (and stops double-wrapping, which would have doubled the
//     22/32/28/32 scroll-pane padding).
//  4. The action row. 0.18 keeps Save inside the form group and puts a full-width
//     "Delete skill" text button under it. 0.62.0 moves Delete into the header
//     actions group as a `variant:"secondary"` button carrying the `deleteDanger`
//     root style, and puts Save in a footer action bar — right-aligned, with
//     0.62.0's `footerRule` top rule and 12/12/16 padding.
//
// Design-system delta. Every class 0.62.0 uses is either byte-identical in the pinned
// 0.18 stylesheet (index-lCyB53CO.css) or has a physical-property twin there, so the
// port is a class swap rather than an invention. assertSkillDetailClassesResolve()
// re-checks all of them at build time so a stylesheet change fails the build
// instead of shipping an unstyled pane.
//   * `sand-pdmqnj` (padding-inline-end: 12px, the action bar's right padding) and
//     `sand-jgen18` (min-height: 106px, the textarea floor) are the only two 0.62.0
//     declarations 0.18 never shipped, so they ride the `style` prop, which React
//     applies after the class sheet and therefore wins.
//   * 0.62.0's `sand-14z9mp`/`sand-1lziwak` (margin-inline-end/start: 0) and
//     `sand-f159sx`/`sand-mzvs34` (padding-inline-end/start: 8px) are the logical
//     spellings of declarations 0.18 already carries as `sand-1yf7rl7`/`sand-j3b58b`
//     and `sand-y13l1i`/`sand-163pfp`; the computed result is identical in the LTR
//     UI, so the existing classes are left alone.
//   * 0.62.0's `sand-11wthnw` (font-size: var(--cursor-font-size-base)) and
//     `sand-fc7y3v` (font-size: var(--cursor-font-size-lg)) resolve to 13px and
//     14px in *both* stylesheets, matching 0.18's `sand-4z9k3i` (13px) and
//     `sand-if65rj` (14px); the textarea therefore keeps `sand-fc7y3v` only to
//     mirror 0.62.0's recipe ordering, not to change the rendered size.
//
// Deliberately not ported, because the 0.62.0 evidence for them is behavioural
// rather than visual and 0.18 has no equivalent primitive to move to:
//   * 0.62.0 routes Delete through a confirmation dialog
//     (title "Delete this skill?", body "This action cannot be undone",
//     destructive). 0.18 deletes immediately. The button is repositioned and
//     restyled here; the confirmation is left as 0.18 behaviour.
//   * 0.62.0's Save button has Saving/Saved label states driven by the mutation's
//     pending flag. 0.18's Button has no `pending` prop; only the footer chrome is
//     ported.
//   * 0.62.0's instructions placeholder reads "…the Bot follows when it runs this
//     skill" against 0.18's "…the agent follows…". It only shows on an empty body,
//     and rewriting a raw literal here would strand main-i18n's pair table, so the
//     0.18 literal is kept.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const COMPONENT_ANCHOR = "function Hi(n){const e=ne.c(104),{workflow:s,agentId:a,onNotice:l,onClosed:i,onSkillMoved:d}=n,";

// 0.62.0 `Ie` — the header actions group that holds the publish trigger and Delete.
const HEADER_ACTIONS_CLASS = "sand-9f619 sand-78zum5 sand-6s0dn4 sand-2lah0s sand-167g77z";
// 0.62.0 `Y` — the gap-24 column inside the detail's own scroll pane.
const BODY_COLUMN_CLASS = "sand-9f619 sand-78zum5 sand-dt5ytf sand-1665zp3";
// 0.62.0 `As.actions` + `As.actionsRich` (identical to `Mn.footerRule`).
const ACTION_BAR_CLASS =
  "sand-9f619 sand-78zum5 sand-6s0dn4 sand-13a6bvl sand-167g77z sand-2lah0s sand-z9dl7a sand-sag5q8 sand-f7dkkf sand-t8cgyo sand-13fuv20 sand-s351rv";
// 0.62.0 `Mn.textarea` + `fo.thinScrollbar`.
const TEXTAREA_CLASS =
  "sand-9f619 sand-h8yej3 sand-5f5z56 sand-1sslpiy sand-tt52l0 sand-1odjw0f sand-z9dl7a sand-v54qhq sand-sag5q8 sand-f7dkkf "
  + "sand-mkeg23 sand-1y0btm7 sand-9r1u3d sand-1ubt8my sand-ixl9f9 sand-1t137rt sand-i07v4r sand-1wd3ewq sand-jb2p0i "
  + "sand-fc7y3v sand-1fc57z9 sand-12oo3zp "
  + "sand-1597r2g sand-xkn5u1 sand-y2251v sand-122zoth sand-1ch4u7m sand-1nh7un5 sand-9xsh1y";
// The detail root becomes the pane's flex row so it fills the pane height.
const ROOT_BEFORE = 'V=k("sand-plugins-skill-detail","sand-9f619 sand-78zum5 sand-dt5ytf sand-1665zp3")';
const ROOT_AFTER = 'V=k("sand-plugins-skill-detail","sand-9f619 sand-78zum5 sand-1iyjqo2 sand-s83m0k sand-dl72j9 sand-dt5ytf sand-2lwn1j")';

// 0.18 renders `te` as the bare publish trigger and hands the header `[L, J, te]`.
// 0.62.0's header is `[icon, name+badge, actionsGroup]` where actionsGroup is
// `[publishTrigger, deleteButton]`. The extra dependencies (E/S/w) are parked in the
// memo slots 89-92 that the deleted bottom delete-button block used to own, so no
// slot index in the surrounding React Compiler output shifts.
const HEADER_ACTIONS_BEFORE =
  "let te;e[41]!==a||e[42]!==o||e[43]!==g||e[44]!==i||e[45]!==l||e[46]!==d||e[47]!==s?"
  + "(te=g?null:t.jsx(Bi,{agentId:a,isEnabled:o,onNotice:l,onClosed:i,onSkillMoved:d,workflow:s}),"
  + "e[41]=a,e[42]=o,e[43]=g,e[44]=i,e[45]=l,e[46]=d,e[47]=s,e[48]=te):te=e[48];";
const HEADER_ACTIONS_AFTER =
  "let te;e[41]!==a||e[42]!==o||e[43]!==g||e[44]!==i||e[45]!==l||e[46]!==d||e[47]!==s||e[89]!==E||e[90]!==S||e[91]!==w?"
  + '(te=t.jsxs("div",{className:RSkillDetailHeaderActions,children:['
  + "g?null:t.jsx(Bi,{agentId:a,isEnabled:o,onNotice:l,onClosed:i,onSkillMoved:d,workflow:s}),"
  + 'a!=null&&!w&&!g?t.jsx(ve,{"aria-busy":S,disabled:S,onClick:()=>{E()},rootStyle:RSkillDetailDeleteDanger,size:"sm",type:"button",variant:"secondary",children:(RLocT("Delete Skill","删除技能"))}):null'
  + "]}),e[41]=a,e[42]=o,e[43]=g,e[44]=i,e[45]=l,e[46]=d,e[47]=s,e[89]=E,e[90]=S,e[91]=w,e[92]=te):te=e[92];";

// 0.62.0 reads the skill's provenance badge through i18n keys — `V1Vjra`
// ("Private skill"), `7eKKjp` ("Managed by Cursor") and `quCEII` ("Shared with your
// team") — while 0.18 hard-codes the English literals, so a Chinese UI shows an
// English badge. The zh-Hans values were read out of 0.62.0's own message tables
// (dist/renderer/assets/chunk-core-dNaCtJM1.js): 私有技能 / 由 Cursor 管理 /
// 已与你的团队共享. Same treatment as the teach-gate patch's visible label: wrap the
// literals rather than replace the badge's logic, so the source/managed/plugin
// branching is untouched.
const SKILL_BADGE_BEFORE =
  'w=s.source==="plugin",g=s.source==="managed";let A="Private skill";g?A="Managed by Cursor":w&&(A="Shared with your team");';
const SKILL_BADGE_AFTER =
  'w=s.source==="plugin",g=s.source==="managed";'
  + 'let A=(RLocT("Private skill","私有技能"));'
  + 'g?A=(RLocT("Managed by Cursor","由 Cursor 管理")):w&&(A=(RLocT("Shared with your team","已与你的团队共享")));';

// 0.18's bottom-of-form "Delete skill" text button. 0.62.0 has no counterpart here —
// the button moved into the header actions group, so the block goes away entirely.
const DELETE_ROW_BEFORE =
  "let Pe;e[89]!==a||e[90]!==E||e[91]!==S||e[92]!==w||e[93]!==g?"
  + '(Pe=a!=null&&!w&&!g?t.jsx("div",{className:k("sand-9f619 sand-ixl9f9 sand-i07v4r"),children:'
  + 't.jsx("button",{className:k("sand-9f619 sand-78zum5 sand-6s0dn4 sand-h8yej3 sand-889kno sand-cicffo sand-1a8lsjc sand-1lqa7cf '
  + "sand-c342km sand-ng3xce sand-ixl9f9 sand-jbqb8w sand-1py74cc sand-6wxzax sand-jb2p0i sand-4z9k3i sand-d4r4e8 sand-12oo3zp sand-dpxx8g "
  + 'sand-1ypdohk"),disabled:S,onClick:()=>{E()},type:"button",children:"Delete skill"})}):null,'
  + "e[89]=a,e[90]=E,e[91]=S,e[92]=w,e[93]=g,e[94]=Pe):Pe=e[94];";

// The form group keeps only the three labelled fields; Save becomes a footer sibling
// of the scroll pane and Delete lives in the header.
const FORM_GROUP_BEFORE =
  "let Ae;e[95]!==oe||e[96]!==fe||e[97]!==Se||e[98]!==Ce||e[99]!==Pe?"
  + "(Ae=t.jsxs(\"div\",{className:ee,children:[oe,fe,Se,Ce,Pe]}),"
  + "e[95]=oe,e[96]=fe,e[97]=Se,e[98]=Ce,e[99]=Pe,e[100]=Ae):Ae=e[100];";
const FORM_GROUP_AFTER =
  "let Ae;e[95]!==oe||e[96]!==fe||e[97]!==Se?"
  + '(Ae=t.jsxs("div",{className:ee,children:[oe,fe,Se]}),'
  + "e[95]=oe,e[96]=fe,e[97]=Se,e[100]=Ae):Ae=e[100];";

// 0.62.0 renders Save through `As.actions` + `As.actionsRich`; only the 12px
// inline-end padding (`sand-pdmqnj`) has no 0.18 twin, so it rides `style`.
const SAVE_ROW_BEFORE =
  "let Ce;e[85]!==T||e[86]!==M||e[87]!==g?"
  + '(Ce=g?null:t.jsx("div",{className:k("sand-9f619 sand-78zum5 sand-13a6bvl sand-167g77z"),children:'
  + 't.jsx(ve,{disabled:!T,onClick:()=>{M()},size:"sm",type:"button",variant:"primary",children:"Save"})}),'
  + "e[85]=T,e[86]=M,e[87]=g,e[88]=Ce):Ce=e[88];";
const SAVE_ROW_AFTER =
  "let Ce;e[85]!==T||e[86]!==M||e[87]!==g?"
  + '(Ce=g?null:t.jsx("div",{className:RSkillDetailActionBar,style:{paddingInlineEnd:"12px"},children:'
  + 't.jsx(ve,{disabled:!T,onClick:()=>{M()},size:"sm",type:"button",variant:"primary",children:"Save"})}),'
  + "e[85]=T,e[86]=M,e[87]=g,e[88]=Ce):Ce=e[88];";

// The detail grows its own scroll region, exactly like 0.62.0's `ln`, and the Save
// footer sits beside it instead of inside the scrolling column.
const ROOT_RETURN_BEFORE =
  "let qe;return e[101]!==G||e[102]!==Ae?"
  + '(qe=t.jsxs("div",{className:V,children:[G,Ae]}),e[101]=G,e[102]=Ae,e[103]=qe):qe=e[103],qe';
const ROOT_RETURN_AFTER =
  "let qe;return e[101]!==G||e[102]!==Ae||e[99]!==Ce?"
  + "(qe=t.jsxs(\"div\",{className:V,children:[t.jsx(nl,{children:"
  + 't.jsxs("div",{className:RSkillDetailBody,children:[G,Ae]})}),Ce]}),'
  + "e[101]=G,e[102]=Ae,e[99]=Ce,e[103]=qe):qe=e[103],qe";

// 0.18 pins the textarea to 80px and lets the user drag it; 0.62.0 sizes it to its
// content between 106px and 320px and scrolls past that.
const TEXTAREA_CLASS_BEFORE =
  'Ne=k("sand-9f619 sand-h8yej3 sand-seoqlg sand-1sslpiy sand-288g5 sand-z9dl7a sand-yfqnmn sand-sag5q8 sand-nm25rq sand-mkeg23 '
  + 'sand-1y0btm7 sand-9r1u3d sand-1ubt8my sand-ixl9f9 sand-1t137rt sand-i07v4r sand-1wd3ewq sand-jb2p0i sand-if65rj sand-1fc57z9 sand-12oo3zp")';
const TEXTAREA_CLASS_AFTER = `Ne=k(${JSON.stringify(TEXTAREA_CLASS)})`;
const TEXTAREA_ELEMENT_BEFORE =
  't.jsx("textarea",{className:Ne,onChange:ze,placeholder:"Markdown instructions the agent follows when it runs this skill",readOnly:g,spellCheck:!1,value:m})';
const TEXTAREA_ELEMENT_AFTER =
  't.jsx("textarea",{className:Ne,onChange:ze,placeholder:"Markdown instructions the agent follows when it runs this skill",readOnly:g,spellCheck:!1,style:{minHeight:"106px"},value:m})';

// 0.18 puts every detail inside the pane-level scroll pane. 0.62.0 returns a skill
// detail straight from `_s()` (`S.target.kind === "skill"`), so the detail — which now
// owns its own scroll region — must not be wrapped a second time.
const PANE_SCROLL_BEFORE =
  "let Le;e[67]!==_s||e[68]!==Es||e[69]!==Rs?"
  + "(Le=t.jsx(nl,{ref:Es,children:Rs},_s),e[67]=_s,e[68]=Es,e[69]=Rs,e[70]=Le):Le=e[70];";
const PANE_SCROLL_AFTER =
  "let Le;e[67]!==_s||e[68]!==Es||e[69]!==Rs?"
  + "(Le=Me!=null?Rs:t.jsx(nl,{ref:Es,children:Rs},_s),e[67]=_s,e[68]=Es,e[69]=Rs,e[70]=Le):Le=e[70];";

const COMPONENT_SOURCE =
  `const RSkillDetailHeaderActions=${JSON.stringify(HEADER_ACTIONS_CLASS)};`
  + `const RSkillDetailBody=${JSON.stringify(BODY_COLUMN_CLASS)};`
  + `const RSkillDetailActionBar=${JSON.stringify(ACTION_BAR_CLASS)};`
  + 'const RSkillDetailDeleteDanger={kWkggS:"sand-6y9aml sand-tly4hf",kMwMTN:"sand-6rl5ky",$$css:!0};';

const ROOT_CLASSES = ["sand-9f619", "sand-78zum5", "sand-1iyjqo2", "sand-s83m0k", "sand-dl72j9", "sand-dt5ytf", "sand-2lwn1j"];
const BODY_COLUMN_CLASSES = ["sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-1665zp3"];
const HEADER_ACTIONS_CLASSES = ["sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-2lah0s", "sand-167g77z"];
const ACTION_BAR_CLASSES = [
  "sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-13a6bvl", "sand-167g77z", "sand-2lah0s",
  "sand-z9dl7a", "sand-sag5q8", "sand-f7dkkf", "sand-t8cgyo", "sand-13fuv20", "sand-s351rv",
];
const DELETE_DANGER_CLASSES = ["sand-6y9aml", "sand-tly4hf", "sand-6rl5ky"];
const TEXTAREA_CLASSES = TEXTAREA_CLASS.split(/\s+/).filter(Boolean);

export const SKILL_DETAIL_CLASS_NAMES = Object.freeze([
  ...new Set([
    ...ROOT_CLASSES,
    ...BODY_COLUMN_CLASSES,
    ...HEADER_ACTIONS_CLASSES,
    ...ACTION_BAR_CLASSES,
    ...DELETE_DANGER_CLASSES,
    ...TEXTAREA_CLASSES,
  ]),
]);

// Classes 0.62.0 reaches for that 0.18 never shipped. They must stay out of the
// className strings, because a class with no rule silently does nothing.
export const SKILL_DETAIL_UNSUPPORTED_CLASS_NAMES = Object.freeze([
  "sand-pdmqnj",
  "sand-jgen18",
  "sand-1lziwak",
  "sand-mzvs34",
]);

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/**
 * Fail closed unless every class the ported skill detail relies on is actually
 * defined by the pinned stylesheet, and unless no 0.62.0-only class slipped into a
 * className string. A hash change upstream would otherwise render the pane
 * unstyled with nothing in the build failing.
 */
export function assertSkillDetailClassesResolve(cssText, classNames = SKILL_DETAIL_CLASS_NAMES) {
  const unresolved = classNames.filter(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`\\.${escaped}(?![\\w-])`).test(cssText);
  });
  if (unresolved.length > 0) {
    throw new Error(
      `Skill detail classes are missing from the pinned renderer stylesheet: ${unresolved.join(", ")}`,
    );
  }
  return classNames.length;
}

export function patchOriginalSkillDetail(source) {
  // The bottom delete row goes first: it frees the memo slots the header actions
  // group reuses for its extra dependencies.
  let patched = replaceExactlyOnce(source, DELETE_ROW_BEFORE, "", "skill detail delete row");
  patched = replaceExactlyOnce(patched, COMPONENT_ANCHOR, COMPONENT_SOURCE + COMPONENT_ANCHOR, "skill detail recipe insertion");
  patched = replaceExactlyOnce(patched, ROOT_BEFORE, ROOT_AFTER, "skill detail root column");
  patched = replaceExactlyOnce(patched, HEADER_ACTIONS_BEFORE, HEADER_ACTIONS_AFTER, "skill detail header actions group");
  patched = replaceExactlyOnce(patched, FORM_GROUP_BEFORE, FORM_GROUP_AFTER, "skill detail form group");
  patched = replaceExactlyOnce(patched, SAVE_ROW_BEFORE, SAVE_ROW_AFTER, "skill detail action bar");
  patched = replaceExactlyOnce(patched, ROOT_RETURN_BEFORE, ROOT_RETURN_AFTER, "skill detail scroll region");
  patched = replaceExactlyOnce(patched, TEXTAREA_CLASS_BEFORE, TEXTAREA_CLASS_AFTER, "skill detail textarea recipe");
  patched = replaceExactlyOnce(patched, TEXTAREA_ELEMENT_BEFORE, TEXTAREA_ELEMENT_AFTER, "skill detail textarea min-height");
  patched = replaceExactlyOnce(patched, SKILL_BADGE_BEFORE, SKILL_BADGE_AFTER, "skill detail provenance badge labels");
  return replaceExactlyOnce(patched, PANE_SCROLL_BEFORE, PANE_SCROLL_AFTER, "skill detail pane scroll region");
}

export async function applyOriginalRendererSkillDetail({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(COMPONENT_ANCHOR)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one original skill-detail chunk for the 0.62.0 port, found ${candidates.length}.`);
  }
  const candidate = candidates[0];

  let checkedClasses = 0;
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".css")) continue;
    const cssText = await readFile(path.join(assetsRoot, name), "utf8");
    checkedClasses += assertSkillDetailClassesResolve(cssText);
    for (const unsupported of SKILL_DETAIL_UNSUPPORTED_CLASS_NAMES) {
      const escaped = unsupported.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\.${escaped}(?![\\w-])`).test(cssText)) {
        throw new Error(
          `0.62.0-only class ${unsupported} now exists in the pinned stylesheet; the inline-style fallback in the skill detail port should be retired.`,
        );
      }
    }
  }
  if (checkedClasses === 0) {
    throw new Error("Skill detail port found no renderer stylesheet to validate its classes against.");
  }

  // The injected recipes are plain strings, so any 0.62.0-only class landing in one
  // would render as a no-op. Refuse before the stage is written.
  for (const unsupported of SKILL_DETAIL_UNSUPPORTED_CLASS_NAMES) {
    if (COMPONENT_SOURCE.includes(unsupported) || TEXTAREA_CLASS.includes(unsupported)) {
      throw new Error(`Skill detail port references ${unsupported}, which the pinned 0.18 stylesheet does not define.`);
    }
  }

  const patched = patchOriginalSkillDetail(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-skill-detail",
    upstream: {
      version: "0.62.0",
      bundleId: "com.anysphere.sand",
      detailChunk: "dist/renderer/assets/chunk-view-CUl9t9OA.js",
      detailComponent: "mi",
      teachRecordingChunk: "dist/renderer/assets/index.eager-app-C20nv6Dx.js",
    },
    chunks: [
      {
        role: "skill-detail",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
        validatedStyleClasses: SKILL_DETAIL_CLASS_NAMES,
        inlineStyleFallbacks: {
          "textarea min-height": "sand-jgen18 has no 0.18 twin; min-height:106px rides the style prop",
          "action bar padding-inline-end": "sand-pdmqnj has no 0.18 twin; padding-inline-end:12px rides the style prop",
        },
      },
    ],
    features: ["skill-detail-0-62-layout"],
    transformations: [
      "textarea-content-sized-106-to-320px",
      "textarea-overflow-y-auto-thin-scrollbar",
      "textarea-resize-none",
      "detail-root-flex-grow-min-height-0",
      "detail-own-scroll-region",
      "detail-not-double-wrapped-in-pane-scroll",
      "delete-moved-to-header-actions-group",
      "delete-secondary-variant-danger-root-style",
      "save-moved-to-footer-action-bar",
      "action-bar-top-rule-and-padding",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-skill-detail-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
