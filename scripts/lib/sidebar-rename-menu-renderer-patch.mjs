// Grok Bot 0.71.2 "Rename chat / Rename Bot" sidebar context-menu item, ported onto the
// checksum-pinned 0.18 renderer chunk (index-UbX-y3il.js).
//
// 0.18 already ships the whole rename mechanism inline in the sidebar row `udn`: a
// `[Ae,oe]=S.useState(!1)` editing flag, the `yut` name editor (label "Rename agent"), a commit
// that calls `roster.updateAgent(id,{name,description})`, and a double-click handler that only
// starts editing for expanded rows (`c||G||(…oe(!0))`, c = collapsed, G = pinned tile). What
// 0.18 lacks is the context-menu entry that starts the same editor. All evidence lives in the
// provenance record below; this patch adds no backend surface.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const SIDEBAR_RENAME_MENU_EVIDENCE = Object.freeze({
  reference: "Grok Bot 0.71.2 renderer, dist/renderer/assets/index-wlkGG389.js",
  rowRenameLabel:
    "@498091 ue=s.isGroup?S({id:\"6PsaMr\"}):S({id:\"b4Apmt\"}) — en index.eager-app-DSuGVQNC.js \"6PsaMr\":[\"Rename chat\"], \"b4Apmt\":[\"Rename Bot\"]; zh-Hans chunk-agents-Dl43u0z-.js 重命名聊天 / 重命名 Bot",
  rowRenameGate:
    "@498091 de=o===\"expanded\"&&s.viewerIsOwner!==!1; @507137 Kt=de?{label:ce,onStart:xe}:void 0 passed as AD({rename:Kt}); xe=()=>{re(!0)} flips the same inline-editor flag the row's double-click uses",
  menuItem:
    "@460549 function jD: In.Item{leading:et{name:\"pencil-square\",size:\"base\"},onSelect:onStart,children:label}",
  menuPlacement:
    "@474600 AD renders L?In.Section{[d==null?null:jD{label:d.label,onStart:M(\"rename\",d.onStart)}, copy-link]}:null as the section right after the pin/mark section",
  featureGate:
    "none. AD reads w=rn(\"grok_bot_multiplayer\") @469558 but only feeds E=!P&&w&&Oae(n) (pin eligibility) and the non-owner branch; the rename section depends on d (the rename prop) alone",
  notPorted:
    "viewerIsOwner — 0.18 roster rows carry no viewerIsOwner field (0 occurrences in index-UbX-y3il.js), so the owner term is always true there and is omitted. 0.71.2's commit-error alert (Vae code) is a separate behaviour and the 0.18 commit is left as-is.",
});

const ROW_MEMO_BEFORE = "const udn=function(e){const t=he.c(132),";
const ROW_MEMO_AFTER = "const udn=function(e){const t=he.c(137),";
const ROW_EDIT_STATE = "[Ae,oe]=S.useState(!1)";

const ROW_MENU_BEFORE = "let Rn;t[105]!==s||";
const ROW_MENU_AFTER =
  "let RRenameMenu;t[132]!==c||t[133]!==G||t[134]!==s.isGroup?(RRenameMenu=c||G?void 0:{label:s.isGroup?RLocT(\"Rename chat\",\"重命名聊天\"):RLocT(\"Rename Bot\",\"重命名 Bot\"),onStart:()=>{oe(!0)}},t[132]=c,t[133]=G,t[134]=s.isGroup,t[135]=RRenameMenu):RRenameMenu=t[135];let Rn;t[136]!==RRenameMenu||t[105]!==s||";

const ROW_MENU_PROPS_BEFORE = "onTogglePin:I,...Es,...Sr})}),t[105]=s,";
const ROW_MENU_PROPS_AFTER = "onTogglePin:I,rename:RRenameMenu,...Es,...Sr})}),t[136]=RRenameMenu,t[105]=s,";

const MENU_HEAD_BEFORE =
  "function fcn(n){const e=he.c(67),{agent:t,isAnysphereUser:s,batchCount:r,sectionBatchCount:i,isPinned:o,areSectionsSupported:l,sectionOptions:c,currentSectionId:u,onMoveToSection:d,onMoveToNewSection:m,onOpenProfile:f,onTogglePin:h,onMarkRead:y,onMarkUnread:k,onCopyConversationId:v,onShowFullConversation:b,onShowAsyncTasks:x,onDuplicate:N,onHideFromSidebar:E,onRequestDelete:A,onShareAgent:I,onLeaveSharedRoom:P}=n,";
const RENAME_ITEM_SOURCE =
  "function RRenameMenuItem(n){const e=he.c(4),{label:t,onStart:s}=n;let r;e[0]===Symbol.for(\"react.memo_cache_sentinel\")?(r=p.jsx(bt,{name:\"pencil-square\",size:\"base\"}),e[0]=r):r=e[0];let i;return e[1]!==t||e[2]!==s?(i=p.jsx(It.Item,{leading:r,onSelect:s,children:t}),e[1]=t,e[2]=s,e[3]=i):i=e[3],i}";
const MENU_HEAD_AFTER =
  RENAME_ITEM_SOURCE +
  "function fcn(n){const e=he.c(70),{agent:t,isAnysphereUser:s,batchCount:r,sectionBatchCount:i,isPinned:o,areSectionsSupported:l,sectionOptions:c,currentSectionId:u,onMoveToSection:d,onMoveToNewSection:m,onOpenProfile:f,onTogglePin:h,onMarkRead:y,onMarkUnread:k,onCopyConversationId:v,onShowFullConversation:b,onShowAsyncTasks:x,onDuplicate:N,onHideFromSidebar:E,onRequestDelete:A,onShareAgent:I,onLeaveSharedRoom:P,rename:RRename}=n,";

const MENU_TAIL_BEFORE =
  "let ne;return e[62]!==Y||e[63]!==te||e[64]!==L||e[65]!==W?(ne=p.jsxs(p.Fragment,{children:[L,W,Y,te]}),e[62]=Y,e[63]=te,e[64]=L,e[65]=W,e[66]=ne):ne=e[66],ne}";
const MENU_TAIL_AFTER =
  "let RRenameSection;e[67]!==RRename?(RRenameSection=RRename==null?null:p.jsx(It.Section,{children:p.jsx(RRenameMenuItem,{label:RRename.label,onStart:RRename.onStart})}),e[67]=RRename,e[68]=RRenameSection):RRenameSection=e[68];let ne;return e[62]!==Y||e[63]!==te||e[64]!==L||e[65]!==W||e[69]!==RRenameSection?(ne=p.jsxs(p.Fragment,{children:[L,RRenameSection,W,Y,te]}),e[62]=Y,e[63]=te,e[64]=L,e[65]=W,e[69]=RRenameSection,e[66]=ne):ne=e[66],ne}";

export const SIDEBAR_RENAME_MENU_ANCHORS = Object.freeze([
  ["row memo cache", ROW_MEMO_BEFORE, ROW_MEMO_AFTER],
  ["row rename prop", ROW_MENU_BEFORE, ROW_MENU_AFTER],
  ["row menu props", ROW_MENU_PROPS_BEFORE, ROW_MENU_PROPS_AFTER],
  ["menu head", MENU_HEAD_BEFORE, MENU_HEAD_AFTER],
  ["menu sections", MENU_TAIL_BEFORE, MENU_TAIL_AFTER],
]);

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer sidebar rename ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalSidebarRenameMenu(source) {
  if (source.includes("function RRenameMenuItem(")) {
    throw new Error("Sidebar rename menu patch was already applied.");
  }
  replaceExactlyOnce(source, ROW_EDIT_STATE, ROW_EDIT_STATE, "row edit state");
  let patched = source;
  for (const [label, before, after] of SIDEBAR_RENAME_MENU_ANCHORS) {
    patched = replaceExactlyOnce(patched, before, after, label);
  }
  return patched;
}

const sha256 = text => createHash("sha256").update(text).digest("hex");

export async function applyOriginalRendererSidebarRenameMenu({ stageRoot }) {
  const assetsDir = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const file of (await readdir(assetsDir)).filter(name => name.endsWith(".js"))) {
    const source = await readFile(path.join(assetsDir, file), "utf8");
    if (source.includes(MENU_HEAD_BEFORE)) candidates.push({ file, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Sidebar rename menu patch: expected one chunk with the sidebar context menu, found ${candidates.length}.`);
  }
  const [{ file, source }] = candidates;
  const patched = patchOriginalSidebarRenameMenu(source);
  await writeFile(path.join(assetsDir, file), patched);
  const provenance = {
    mode: "sidebar-context-menu-rename-entry",
    file: `dist/renderer/assets/${file}`,
    evidence: SIDEBAR_RENAME_MENU_EVIDENCE,
    anchors: SIDEBAR_RENAME_MENU_ANCHORS.map(([label]) => label),
    memoCache: { udn: { before: 132, after: 137 }, fcn: { before: 67, after: 70 } },
    original: { sha256: sha256(source), bytes: Buffer.byteLength(source) },
    patched: { sha256: sha256(patched), bytes: Buffer.byteLength(patched) },
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-sidebar-rename-menu-extension.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(`Sidebar rename menu: added Rename chat/Bot to the row context menu in ${file}`);
  return provenance;
}
