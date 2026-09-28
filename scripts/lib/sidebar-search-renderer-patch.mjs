// Grok Bot 0.61.0 sidebar top-bar search, ported onto the checksum-pinned 0.18 renderer chunk.
//
// Evidence (byte-sourced 2026-09-28 from the official Grok Bot 0.61.0 macOS app,
// bundle com.anysphere.sand at /Applications/Grok Bot.app, renderer chunk
// dist/renderer/assets/index-DIQ9cJ4R.js inside its app.asar):
//   * `agents-sidebar__search` occurs exactly once in that chunk — the control is a
//     top-bar icon button, not a field. There is no full-width search bar anywhere in
//     0.61.0's sidebar, and none in the collapsed (narrow) rail either.
//   * The component is `goe`, referenced exactly once: inside the titlebar header's
//     `sand-agents-sidebar__new-actions` group, immediately before the "+" button:
//       o.jsx(goe,{onOpenSearch:m,style:Ir.topBarButton}), o.jsx(Zn,{content:g({id:"hIQkLb"}),children:o.jsx(In,{…icon:"plus",iconSize:"lg",shape:"circle",style:Ir.topBarButton,variant:"elevated"})})
//   * `goe` itself is a Tooltip (Zn) wrapping an IconButton (In):
//       {icon:"search", iconSize:"lg", shape:"circle", variant:"elevated", className:"sand-agents-sidebar__search", onClick:onOpenSearch, onKeyDown:<type-to-open handler>, style:[poe.button, Ir.topBarButton]}
//     so the search and the "+" are a matched pair of elevated circles.
//   * Ir.topBarButton = { width: 36px, height: 36px, -webkit-app-region: no-drag }.
//   * The header group carries gap 8px (sand-167g77z) so the pair sits apart; it is
//     `display:none` only inside `@container sand-sidebar (max-width: 130px)`, which is
//     exactly the width at which 0.18 stops rendering the bar as well (c0n: isCollapsed
//     is `clientWidth <= 130`). Collapsed-rail behaviour is therefore unchanged.
//
// 0.18 renders the same control as `a0n` (i0n.bar): a full-width bar directly under the
// titlebar row — margin-inline 12px, margin-block spacing-1, height spacing-8, radius 8px,
// inset .5px border, fill-secondary, with a "Search" label next to the glyph — while the
// header group holds the "+" alone. This patch moves the control into the header group and
// drops the bar. The 0.18 `a0n` definition is deliberately left in place: it becomes dead
// code, which keeps this patch a pure relocation rather than a deletion, and keeps an
// extra anchor for the main-i18n "Search" pair.
//
// Design-system delta. 0.18 ships an older IconButton than 0.61, so three props are
// translated rather than copied. Each substituted class was resolved in the pinned 0.18
// stylesheet (index-lCyB53CO.css); assertTopBarClassesResolve() re-checks them at build
// time so a stylesheet change fails the build instead of shipping an unstyled button.
//   * `variant:"elevated"` does not exist in 0.18 (uin = ghost / primary / secondary), so
//     0.61's Ka.elevated recipe is injected as a stylex style object. `fr` merges the
//     `style` prop last (after Mm.root, the control ring, size and variant), so the
//     injected declarations win without depending on stylesheet source order:
//       border-width 1px (sand-mkeg23) + border-style solid (sand-1y0btm7)
//       + border-color --sand-border-weak (sand-q03nf1)
//       + background-color --sand-bg-elevated (sand-10e981r), background-image none
//         (sand-18o3ruo), hover background-color --sand-fill-elevated-hover (sand-kxk3po)
//       + color --sand-text-primary (sand-tyxrsu)
//     0.61 paints its hover as a gradient (sand-z3v7j3) that 0.18 has never shipped; the
//     flat hover uses the identical token, --sand-fill-elevated-hover.
//   * 0.61's `iconSize:"lg"` maps through its Yae table to icon "xl"; 0.18's IconButton
//     has no such table, so the equivalent is `iconSize:"xl"` (TBt: 18px).
//   * 0.61's group gap is 8px; 0.18 shipped gap 2px (sand-195vfkc) for a single button.
// Strings are the raw upstream `"Search"` literal so main-i18n's existing
// ["Search","搜索","A1taO8","PANEL"] pair localises the new label and tooltip exactly as
// it localises the bar being removed; English is the fallback if that pair is ever dropped.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { DISPLAY_PROPS } from "./i18n-patch-engine.mjs";

const COMPONENT_ANCHOR = "function a0n(n){const e=he.c(12),{onOpenSearch:t}=n;";
const HEADER_PROPS_ANCHOR =
  "onRequestDeleteSelected:u,onClearSelection:d,onOpenNetwork:m,onOpenBroadcast:f,onNewChat:h}=n";
const HEADER_CALL_ANCHOR = "onOpenBroadcast:be,onOpenNetwork:ke,onRequestDeleteSelected:wt,";
const NEW_ACTIONS_PLUS_BEFORE =
  'p.jsx(yo,{content:"New chat",children:p.jsx(fr,{"aria-label":"New",className:"sand-agents-sidebar__new",focusAppearance:"none",icon:"plus",onClick:h,size:"sm",style:Ete.newButton})})';
const NEW_ACTIONS_GROUP_BEFORE = 'v={className:"sand-78zum5 sand-gjt6br sand-6s0dn4 sand-195vfkc sand-vc5jky"}';
const SIDEBAR_BAR_BEFORE = "ki=Hn?null:p.jsx(a0n,{onOpenSearch:V})";

const HEADER_PROPS_AFTER =
  "onRequestDeleteSelected:u,onClearSelection:d,onOpenNetwork:m,onOpenBroadcast:f,onNewChat:h,onOpenSearch:Op}=n";
const HEADER_CALL_AFTER = "onOpenBroadcast:be,onOpenNetwork:ke,onRequestDeleteSelected:wt,onOpenSearch:V,";
// The "+" is ported to the same topBarButton/elevated recipe as 0.61.0, so the two
// buttons read as the pair shown in 0.61.0 instead of a circle next to a bare plus.
const NEW_ACTIONS_PLUS_AFTER =
  'p.jsx(RSidebarSearchButton,{onOpenSearch:Op}),p.jsx(yo,{content:"New chat",children:p.jsx(fr,{"aria-label":"New",className:"sand-agents-sidebar__new",focusAppearance:"none",icon:"plus",iconSize:"xl",onClick:h,shape:"circle",style:[RSidebarElevated,RSidebarTopBarButton]})})';
const NEW_ACTIONS_GROUP_AFTER = 'v={className:"sand-78zum5 sand-gjt6br sand-6s0dn4 sand-167g77z sand-vc5jky"}';
const SIDEBAR_BAR_AFTER = "ki=null";

// Ir.topBarButton: width 36px, height 36px, -webkit-app-region no-drag.
const TOP_BAR_BUTTON_CLASSES = ["sand-14qfxbe", "sand-c9qbxq", "sand-lvsv26"];
// Ka.elevated (0.61) expressed with classes 0.18 also ships; see the header comment.
const ELEVATED_CLASSES = [
  "sand-mkeg23",
  "sand-1y0btm7",
  "sand-q03nf1",
  "sand-10e981r",
  "sand-18o3ruo",
  "sand-kxk3po",
  "sand-tyxrsu",
];
// sand-167g77z replaces sand-195vfkc in the group (gap 8px instead of gap 2px).
const GROUP_CLASSES = ["sand-167g77z", "sand-vc5jky"];

export const SIDEBAR_TOP_BAR_CLASS_NAMES = Object.freeze([
  ...new Set([...TOP_BAR_BUTTON_CLASSES, ...ELEVATED_CLASSES, ...GROUP_CLASSES]),
]);

const COMPONENT_SOURCE = String.raw`
const RSidebarTopBarButton={kzqmXN:"sand-14qfxbe",kZKoxP:"sand-c9qbxq",kY4cRS:"sand-lvsv26",$$css:!0};
const RSidebarElevated={kMzoRj:"sand-mkeg23",ksu8eU:"sand-1y0btm7",kVAM5u:"sand-q03nf1",kWkggS:"sand-10e981r",kKwaWg:"sand-18o3ruo sand-kxk3po",kMwMTN:"sand-tyxrsu",$$css:!0};
function RSidebarSearchButton(n){const{onOpenSearch:t}=n,o=u=>{if(u.key==="Delete"||u.key==="Backspace"){u.stopPropagation();return}u.defaultPrevented||u.key.length!==1||u.key===" "||u.metaKey||u.ctrlKey||u.altKey||(u.preventDefault(),t())};return p.jsx(yo,{content:"Search",children:p.jsx(fr,{"aria-label":"Search",className:"sand-agents-sidebar__search",focusAppearance:"none",icon:"search",iconSize:"xl",onClick:t,onKeyDown:o,shape:"circle",style:[RSidebarElevated,RSidebarTopBarButton]})})}`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/**
 * Fail closed unless every class the injected top-bar buttons rely on is actually
 * defined by the pinned stylesheet. A hash change upstream would otherwise render the
 * buttons unstyled (no 36px box, no elevated fill) with nothing in the build failing.
 */
export function assertTopBarClassesResolve(cssText, classNames = SIDEBAR_TOP_BAR_CLASS_NAMES) {
  const unresolved = classNames.filter(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`\\.${escaped}(?![\\w-])`).test(cssText);
  });
  if (unresolved.length > 0) {
    throw new Error(
      `Sidebar top-bar classes are missing from the pinned renderer stylesheet: ${unresolved.join(", ")}`,
    );
  }
  return classNames.length;
}

export function patchOriginalSidebarTopBarSearch(source) {
  let patched = replaceExactlyOnce(source, COMPONENT_ANCHOR, COMPONENT_SOURCE + COMPONENT_ANCHOR, "sidebar search component insertion");
  patched = replaceExactlyOnce(patched, HEADER_PROPS_ANCHOR, HEADER_PROPS_AFTER, "sidebar header onOpenSearch prop");
  patched = replaceExactlyOnce(patched, HEADER_CALL_ANCHOR, HEADER_CALL_AFTER, "sidebar header onOpenSearch wiring");
  patched = replaceExactlyOnce(patched, NEW_ACTIONS_PLUS_BEFORE, NEW_ACTIONS_PLUS_AFTER, "sidebar top-bar search mount");
  patched = replaceExactlyOnce(patched, NEW_ACTIONS_GROUP_BEFORE, NEW_ACTIONS_GROUP_AFTER, "sidebar top-bar group spacing");
  return replaceExactlyOnce(patched, SIDEBAR_BAR_BEFORE, SIDEBAR_BAR_AFTER, "sidebar full-width search bar removal");
}

export async function applyOriginalRendererSidebarTopBarSearch({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(COMPONENT_ANCHOR)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one original sidebar chunk for the top-bar search patch, found ${candidates.length}.`);
  }
  const candidate = candidates[0];
  // The relocated label rides main-i18n's existing "Search" pair, so the injected
  // literals have to be reachable by it. The pair matches both the bare and the
  // JSON-quoted prop spelling (i18n-patch-engine tries `prop:"…"` and
  // `"prop":"…"`), so accept either — this is the same reachability the engine has.
  const reachable = DISPLAY_PROPS.filter(prop => COMPONENT_SOURCE.includes(`${prop}:"Search"`) || COMPONENT_SOURCE.includes(`"${prop}":"Search"`));
  if (!reachable.includes("aria-label") || !reachable.includes("content")) {
    throw new Error("Sidebar top-bar search lost its localizable Search literals.");
  }
  let checkedClasses = 0;
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".css")) continue;
    checkedClasses += assertTopBarClassesResolve(await readFile(path.join(assetsRoot, name), "utf8"));
  }
  if (checkedClasses === 0) {
    throw new Error("Sidebar top-bar search found no renderer stylesheet to validate its classes against.");
  }
  const patched = patchOriginalSidebarTopBarSearch(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-sidebar-top-bar-search",
    chunks: [
      {
        role: "sidebar",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
        validatedStyleClasses: SIDEBAR_TOP_BAR_CLASS_NAMES,
      },
    ],
    features: ["sidebar-top-bar-search"],
    transformations: [
      "insert-sidebar-search-button",
      "wire-header-on-open-search",
      "mount-search-left-of-new-chat",
      "new-chat-elevated-circle",
      "top-bar-group-gap-8px",
      "remove-full-width-search-bar",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-sidebar-search-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
