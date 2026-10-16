// Grok Bot 0.71.2 inline "Hidden Bots" sidebar section + "Show in sidebar" context-menu
// item, ported onto the checksum-pinned 0.18 renderer chunk (index-UbX-y3il.js).
//
// 0.18 ships hide/unhide (`setAgentHiddenFromSidebar`) and a dialog-backed "Hidden Bots"
// standalone row (`Zbe` + `hiddenChatsShellValue`). 0.71.2 replaced that dialog entry with
// an in-list foldable section (`YD` @522653, label `JuesWZ`) and a context-menu flip
// (`ND`/`ID` @467505, `rf+5cn` "Show in sidebar" when `isHidden`). This patch recreates
// that shape with 0.18 primitives (`Zbe` header + `Crn` reveal) and does not invent backend
// surface. Must run AFTER `applyOriginalRendererSidebarRenameMenu` (shares `fcn` / `udn`).

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const SIDEBAR_HIDDEN_SECTION_EVIDENCE = Object.freeze({
  reference: "Grok Bot 0.71.2 renderer, dist/renderer/assets/index-wlkGG389.js",
  section:
    "@522653 function YD: foldable section label ke/JuesWZ \"Hidden Bots\", header qg, body zb/Crn reveal, agents via renderAgent; mounted from gq @564609 when !isCollapsed && hiddenAgents.length>0; fold state useState(!0) toggled by d9e=t=>!t",
  showInSidebar:
    "@467505 ID + ND: when isHidden render In.Item leading eye + ke/rf+5cn \"Show in sidebar\"; else Kv hide (k+okA8). zh-Hans chunk-agents-Dl43u0z-.js rf+5cn=[\"在侧边栏显示\"], JuesWZ=[\"已隐藏的 Bot\"], k+okA8 zero=[\"从侧边栏隐藏\"]",
  removedDialogEntry:
    "0.71.2 has 0× hiddenChats / onOpenHidden / Unhide dialog strings in the main chunk; the sidebar no longer opens a Hidden Bots dialog. Command-palette openHiddenChats is left intact.",
  featureGate: "none",
});

const RHIDDEN_SECTION_SOURCE = [
  "function RHiddenSection(n){",
  "const e=he.c(16),{agents:t,isDragActive:s,isFolded:r,renderAgent:i,onToggleFolded:o}=n;",
  'const l=RLocT("Hidden Bots","已隐藏的 Bot"),c=!r;',
  "let u;e[0]!==t.length||e[1]!==r||e[2]!==o||e[3]!==l?(u=p.jsx(Zbe,{\"aria-expanded\":c,count:t.length,isFolded:r,isLocked:!0,label:l,onClick:o}),e[0]=t.length,e[1]=r,e[2]=o,e[3]=l,e[4]=u):u=e[4];",
  'const d={0:{},1:{className:"sand-1n2onr6 sand-1vjfegm"}}[!!s<<0];',
  'let m;e[5]!==t||e[6]!==i?(m=p.jsx("div",{role:"list",className:"sand-78zum5 sand-dt5ytf sand-1jnr06f sand-euugli sand-1iorvi4",children:t.map(f=>i(f))}),e[5]=t,e[6]=i,e[7]=m):m=e[7];',
  'let h;e[8]!==m||e[9]!==s||e[10]!==c?(h=p.jsx(Crn,{...d,className:"sand-agents-section__reveal",expanded:c,children:m}),e[8]=m,e[9]=s,e[10]=c,e[11]=h):h=e[11];',
  'let y;return e[12]!==l||e[13]!==h||e[14]!==u?(y=p.jsxs("section",{"aria-label":l,className:"sand-78zum5 sand-dt5ytf sand-euugli sand-1n2onr6 sand-xhr3t sand-1k70j0n",children:[u,h]}),e[12]=l,e[13]=h,e[14]=u,e[15]=y):y=e[15],y}',
].join("");

const RSHOW_ITEM_SOURCE =
  'function RShowInSidebarItem(n){const e=he.c(4),{id:t,onShowInSidebar:s}=n;let r;e[0]===Symbol.for("react.memo_cache_sentinel")?(r=p.jsx(bt,{name:"eye",size:"base"}),e[0]=r):r=e[0];let i;return e[1]!==t||e[2]!==s?(i=p.jsx(It.Item,{leading:r,onSelect:()=>s(t),children:RLocT("Show in sidebar","在侧边栏显示")}),e[1]=t,e[2]=s,e[3]=i):i=e[3],i}';

export const SIDEBAR_HIDDEN_SECTION_ANCHORS = Object.freeze([
  [
    "inject RHiddenSection before Wpn",
    "function Wpn(n){const e=he.c(194),{agents:t,listRows:s,pinnedAgents:r,isCollapsed:i,isSectioned:o,resolvedSections:l,renameSectionId:c,composeDraftLabel:u,pendingCreation:d,revealAgentId:m,isAccessBlocked:f,isPrivacyBlocked:h,loadState:y,isRetrying:k,canRecover:v,isRecovering:b,onRecoverComputer:x,hiddenCount:N,onJoinSharedRoom:E,onNewSharedRoom:A,onOpenHiddenChats:I,onRetryLoad:P,",
    RHIDDEN_SECTION_SOURCE +
      "function Wpn(n){const e=he.c(210),{agents:t,listRows:s,pinnedAgents:r,isCollapsed:i,isSectioned:o,resolvedSections:l,renameSectionId:c,composeDraftLabel:u,pendingCreation:d,revealAgentId:m,isAccessBlocked:f,isPrivacyBlocked:h,loadState:y,isRetrying:k,canRecover:v,isRecovering:b,onRecoverComputer:x,hiddenAgents:RHiddenAgents,onJoinSharedRoom:E,onNewSharedRoom:A,onRetryLoad:P,",
  ],
  [
    "Wpn fold state + hidden count",
    "renderAgent:F}=n,[z,V]=S.useState(null);let W;",
    "renderAgent:F}=n,[z,V]=S.useState(null),[RHiddenFolded,RSetHiddenFolded]=S.useState(!0);const N=RHiddenAgents.length;let W;",
  ],
  [
    "inline Hidden section replaces dialog row",
    'e[116]!==N||e[117]!==I?(ze=N>0?p.jsx(Zbe,{"aria-haspopup":"dialog",count:N,isFolded:!1,isStandalone:!0,label:"Hidden Bots",onClick:I}):null,e[116]=N,e[117]=I,e[118]=ze):ze=e[118];',
    "e[116]!==RHiddenAgents||e[117]!==RHiddenFolded||e[194]!==i||e[195]!==F||e[196]!==be?(ze=!i&&N>0?p.jsx(RHiddenSection,{agents:RHiddenAgents,isDragActive:be!=null,isFolded:RHiddenFolded,onToggleFolded:()=>RSetHiddenFolded(RPrev=>!RPrev),renderAgent:F}):null,e[116]=RHiddenAgents,e[117]=RHiddenFolded,e[194]=i,e[195]=F,e[196]=be,e[118]=ze):ze=e[118];",
  ],
  [
    "drop empty-state Show Hidden Bots CTA",
    "Vr=E!=null||A!=null||N>0;let si=null;if(N>0){let Bt;e[61]!==I?(Bt=p.jsx(spn,{onOpenHiddenChats:I}),e[61]=I,e[62]=Bt):Bt=e[62],si=Bt}else if(d==null&&u==null){",
    "Vr=E!=null||A!=null;let si=null;if(d==null&&u==null&&N===0){",
  ],
  [
    "Qhn drops Hidden Bots dialog item",
    'function Qhn(n){const e=he.c(11),{hiddenCount:t,onJoinSharedRoom:s,onNewSharedRoom:r,onOpenHiddenChats:i}=n;let o;e[0]!==s?(o=s!=null?p.jsx(no.Item,{leading:p.jsx(bt,{name:"link",size:"base"}),onSelect:s,children:"Join shared room…"}):null,e[0]=s,e[1]=o):o=e[1];let l;e[2]!==r?(l=r!=null?p.jsx(no.Item,{leading:p.jsx(bt,{name:"agents",size:"base"}),onSelect:r,children:"New shared room…"}):null,e[2]=r,e[3]=l):l=e[3];let c;e[4]!==t||e[5]!==i?(c=t>0?p.jsx(no.Item,{leading:p.jsx(bt,{name:"eye-slash",size:"base"}),onSelect:i,children:`Hidden Bots (${t})`}):null,e[4]=t,e[5]=i,e[6]=c):c=e[6];let u;return e[7]!==o||e[8]!==l||e[9]!==c?(u=p.jsx(no.Content,{"aria-label":"Sidebar actions",minWidth:160,size:"md",children:p.jsxs(no.Section,{children:[o,l,c]})}),e[7]=o,e[8]=l,e[9]=c,e[10]=u):u=e[10],u}',
    'function Qhn(n){const e=he.c(8),{onJoinSharedRoom:s,onNewSharedRoom:r}=n;let o;e[0]!==s?(o=s!=null?p.jsx(no.Item,{leading:p.jsx(bt,{name:"link",size:"base"}),onSelect:s,children:"Join shared room…"}):null,e[0]=s,e[1]=o):o=e[1];let l;e[2]!==r?(l=r!=null?p.jsx(no.Item,{leading:p.jsx(bt,{name:"agents",size:"base"}),onSelect:r,children:"New shared room…"}):null,e[2]=r,e[3]=l):l=e[3];let u;return e[4]!==o||e[5]!==l?(u=p.jsx(no.Content,{"aria-label":"Sidebar actions",minWidth:160,size:"md",children:p.jsxs(no.Section,{children:[o,l]})}),e[4]=o,e[5]=l,e[6]=u):u=e[6],u}',
  ],
  [
    "Qhn call site",
    "e[159]!==Vr||e[160]!==N||e[161]!==E||e[162]!==A||e[163]!==I?(_r=Vr?p.jsx(Qhn,{hiddenCount:N,onJoinSharedRoom:E,onNewSharedRoom:A,onOpenHiddenChats:I}):null,e[159]=Vr,e[160]=N,e[161]=E,e[162]=A,e[163]=I,e[164]=_r):_r=e[164];",
    "e[159]!==Vr||e[161]!==E||e[162]!==A?(_r=Vr?p.jsx(Qhn,{onJoinSharedRoom:E,onNewSharedRoom:A}):null,e[159]=Vr,e[161]=E,e[162]=A,e[164]=_r):_r=e[164];",
  ],
  [
    "shell passes hiddenAgents array",
    "hiddenCount:pt.length,",
    "hiddenAgents:pt,",
  ],
  [
    "bRn exports unhideFromSidebar",
    "hideFromSidebar:J,requestDeleteAgents:_,",
    "hideFromSidebar:J,unhideFromSidebar:O,requestDeleteAgents:_,",
  ],
  [
    "shell wires onShowInSidebar",
    "onHideFromSidebar:$i.hideFromSidebar,onOpenHiddenChats:KWe,",
    "onHideFromSidebar:$i.hideFromSidebar,onShowInSidebar:$i.unhideFromSidebar,",
  ],
  [
    "u0n props: hiddenAgents + onShowInSidebar",
    "hiddenCount:j,onHideFromSidebar:Z,onOpenHiddenChats:X,",
    "hiddenAgents:j,onHideFromSidebar:Z,onShowInSidebar:X,",
  ],
  [
    "u0n → Wpn call props",
    "composeDraftLabel:z,hiddenCount:j,isAccessBlocked:ue,",
    "composeDraftLabel:z,hiddenAgents:j,isAccessBlocked:ue,",
  ],
  [
    "u0n → Wpn drops onOpenHiddenChats",
    "onNewSharedRoom:Y,onOpenHiddenChats:X,onRecoverComputer:D,",
    "onNewSharedRoom:Y,onRecoverComputer:D,",
  ],
  [
    "u0n → Wpn memo drops X dep check",
    "e[158]!==Y||e[159]!==X||e[160]!==D||",
    "e[158]!==Y||e[160]!==D||",
  ],
  [
    "u0n → Wpn memo drops X store",
    "e[158]=Y,e[159]=X,e[160]=D,",
    "e[158]=Y,e[160]=D,",
  ],
  [
    "u0n row gets onShowInSidebar",
    "onHideFromSidebar:Z,onMarkRead:se,onMarkUnread:le,onMoveToNewSection:vn,",
    "onHideFromSidebar:Z,onShowInSidebar:X,onMarkRead:se,onMarkUnread:le,onMoveToNewSection:vn,",
  ],
  [
    "udn destructure onShowInSidebar",
    "onHideFromSidebar:R,onRequestDelete:q,",
    "onHideFromSidebar:R,onShowInSidebar:RShow,onRequestDelete:q,",
  ],
  [
    "udn memo cache bump",
    "const udn=function(e){const t=he.c(137),",
    "const udn=function(e){const t=he.c(138),",
  ],
  [
    "udn passes onShowInSidebar into fcn",
    "onTogglePin:I,rename:RRenameMenu,...Es,...Sr})}),t[136]=RRenameMenu,t[105]=s,",
    "onTogglePin:I,rename:RRenameMenu,onShowInSidebar:RShow,...Es,...Sr})}),t[136]=RRenameMenu,t[105]=s,",
  ],
  [
    "inject RShowInSidebarItem before ccn",
    "function ccn(n){const e=he.c(4),{id:t,onHideFromSidebar:s}=n;",
    RSHOW_ITEM_SOURCE + "function ccn(n){const e=he.c(4),{id:t,onHideFromSidebar:s}=n;",
  ],
  [
    "localize Hide from sidebar",
    'children:"Hide from sidebar"',
    'children:RLocT("Hide from sidebar","从侧边栏隐藏")',
  ],
  [
    "fcn accepts onShowInSidebar",
    "function fcn(n){const e=he.c(70),",
    "function fcn(n){const e=he.c(74),",
  ],
  [
    "fcn destructure onShowInSidebar",
    "onHideFromSidebar:E,onRequestDelete:A,",
    "onHideFromSidebar:E,onShowInSidebar:RShowIn,onRequestDelete:A,",
  ],
  [
    "fcn flips Hide/Show by isHiddenFromSidebar",
    "let U;e[52]!==t.id||e[53]!==E?(U=p.jsx(ccn,{id:t.id,onHideFromSidebar:E}),e[52]=t.id,e[53]=E,e[54]=U):U=e[54];",
    "let U;e[52]!==t.id||e[53]!==E||e[70]!==t.isHiddenFromSidebar||e[71]!==RShowIn?(U=t.isHiddenFromSidebar===!0?p.jsx(RShowInSidebarItem,{id:t.id,onShowInSidebar:RShowIn}):p.jsx(ccn,{id:t.id,onHideFromSidebar:E}),e[52]=t.id,e[53]=E,e[70]=t.isHiddenFromSidebar,e[71]=RShowIn,e[54]=U):U=e[54];",
  ],
]);

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer sidebar hidden section ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalSidebarHiddenSection(source) {
  if (source.includes("function RHiddenSection(")) {
    throw new Error("Sidebar hidden section patch was already applied.");
  }
  if (!source.includes("function RRenameMenuItem(") || !source.includes("const udn=function(e){const t=he.c(137),")) {
    throw new Error("Sidebar hidden section patch requires the sidebar rename menu patch to run first.");
  }
  let patched = source;
  for (const [label, before, after] of SIDEBAR_HIDDEN_SECTION_ANCHORS) {
    patched = replaceExactlyOnce(patched, before, after, label);
  }
  return patched;
}

const sha256 = text => createHash("sha256").update(text).digest("hex");

const REQUIRED_CLASSES = Object.freeze([
  "sand-78zum5",
  "sand-dt5ytf",
  "sand-euugli",
  "sand-1n2onr6",
  "sand-xhr3t",
  "sand-1k70j0n",
  "sand-1jnr06f",
  "sand-1iorvi4",
  "sand-1vjfegm",
]);

export function assertSidebarHiddenSectionStylesResolve(cssText) {
  for (const className of REQUIRED_CLASSES) {
    if (!cssText.includes(`.${className}`)) {
      throw new Error(`Sidebar hidden section: pinned CSS is missing .${className}`);
    }
  }
}

export async function applyOriginalRendererSidebarHiddenSection({ stageRoot }) {
  const assetsDir = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const file of (await readdir(assetsDir)).filter(name => name.endsWith(".js"))) {
    const source = await readFile(path.join(assetsDir, file), "utf8");
    if (source.includes("function Wpn(n){const e=he.c(194),") && source.includes('label:"Hidden Bots"')) {
      candidates.push({ file, source });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(`Sidebar hidden section patch: expected one main chunk with Wpn/Hidden Bots, found ${candidates.length}.`);
  }
  const [{ file, source }] = candidates;
  const cssFile = (await readdir(assetsDir)).find(name => name.startsWith("index") && name.endsWith(".css"));
  if (cssFile == null) throw new Error("Sidebar hidden section patch: pinned CSS missing.");
  assertSidebarHiddenSectionStylesResolve(await readFile(path.join(assetsDir, cssFile), "utf8"));
  const patched = patchOriginalSidebarHiddenSection(source);
  await writeFile(path.join(assetsDir, file), patched);
  const provenance = {
    mode: "sidebar-inline-hidden-section",
    file: `dist/renderer/assets/${file}`,
    evidence: SIDEBAR_HIDDEN_SECTION_EVIDENCE,
    anchors: SIDEBAR_HIDDEN_SECTION_ANCHORS.map(([label]) => label),
    requiredClasses: REQUIRED_CLASSES,
    memoCache: {
      Wpn: { before: 194, after: 210 },
      Qhn: { before: 11, after: 8 },
      udn: { before: 137, after: 138 },
      fcn: { before: 70, after: 74 },
    },
    original: { sha256: sha256(source), bytes: Buffer.byteLength(source) },
    patched: { sha256: sha256(patched), bytes: Buffer.byteLength(patched) },
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-sidebar-hidden-section-extension.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(`Sidebar hidden section: inline Hidden Bots + Show in sidebar in ${file}`);
  return provenance;
}
