// Grok Bot 0.71.2 "Download" / "Download all" message action, ported onto the checksum-pinned
// 0.18 renderer chunk (index-UbX-y3il.js).
//
// Evidence (byte-sourced 2026-10-16 from the 0.71.2 renderer extracted under
// rea-grokbot-0712/app/dist/renderer/assets/):
//
//   * Targets `SV` (index-wlkGG389.js @1185370): a user-attachment yields
//     [{path:file_path, suggestedName:file_name ?? basename(file_path)}]; a send-message
//     attachment yields [{path:url, suggestedName:message.file_name ?? basename(url)}] only when
//     `dRe(url)` (non-empty and `rRe(url) !== "remote"`, i.e. a bare path or a file: URL);
//     anything else yields []. `basename` is eager-app `cM` (@972376).
//   * Wrapper `rr` (index-wlkGG389.js @1218997): `k = downloadAttachments ?? SV(entry)`,
//     `onDownload = k.length===0 || h==null ? undefined : () => h(k)`, and it passes
//     `downloadCount:k.length` + `onDownload` to the hover actions `_V`. `h` is eager-app `uFe`
//     (@314845): null without a client, otherwise an async loop that awaits
//     `desktop.downloadAttachment({path, suggestedName})` once per file, in order. No folder
//     picker and no new main-process API: 0.18's preload already exposes the same per-file call.
//   * Image-group host (index-wlkGG389.js @1456874) passes
//     `downloadAttachments: entries.flatMap(SV)` so a grouped message downloads every image.
//   * Hover "more" menu (`_V`, index-wlkGG389.js @1194383): shown when onDownload/onCopy/request
//     id exist; first item is `desktop-download` with onSelect `()=>{onDownload(),dismiss()}` and
//     label `(downloadCount??0)>1 ? "3YP/Ra" : "mzI/c+"`, placed before Copy.
//   * Right-click menu (index-wlkGG389.js @1199046): the same item with onSelect `onDownload`,
//     after Reply and before Copy.
//   * Copy: "3YP/Ra" en "Download all" / zh-Hans "全部下载"; "mzI/c+" en "Download" / zh-Hans
//     "下载" (zh in chunk-chat-oYCOIqHR.js).
//
// 0.18 mapping: `_V` = `mCn` (already has the "More message actions" menu and the right-click
// menu), `rr` = `Roe`, image-group host = `hMn`. No new UI surface is invented — the item is
// added to the two menus 0.18 already renders.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const HOVER_ACTIONS_ANCHOR = "function mCn(n){";

const EDITS = Object.freeze([
  {
    label: "hover actions props + memo cache",
    before: "function mCn(n){const e=he.c(149),{entry:t,children:s,onCopy:r}=n,",
    after: "function mCn(n){const e=he.c(160),{entry:t,children:s,onCopy:r,onDownload:RDlOn,downloadCount:RDlCount}=n,",
  },
  {
    label: "hover actions early return",
    before: "if(!l){let Ie;return e[20]!==s?",
    after: "if(!l&&RDlOn==null){let Ie;return e[20]!==s?",
  },
  {
    label: "hover actions outer guard",
    before: "e[39]!==y||e[40]!==fe){ye=Symbol.for(\"react.early_return_sentinel\");",
    after: "e[39]!==y||e[40]!==fe||e[149]!==RDlOn||e[150]!==RDlCount){ye=Symbol.for(\"react.early_return_sentinel\");",
  },
  {
    label: "hover actions outer guard store",
    before: "e[39]=y,e[40]=fe,e[41]=ge,",
    after: "e[39]=y,e[40]=fe,e[149]=RDlOn,e[150]=RDlCount,e[41]=ge,",
  },
  {
    label: "hover actions inner guard",
    before: "e[59]!==y||e[60]!==fe){const Ue=",
    after: "e[59]!==y||e[60]!==fe||e[151]!==RDlOn||e[152]!==RDlCount){const Ue=",
  },
  {
    label: "hover actions inner guard store",
    before: "e[59]=y,e[60]=fe,e[61]=we,",
    after: "e[59]=y,e[60]=fe,e[151]=RDlOn,e[152]=RDlCount,e[61]=we,",
  },
  {
    label: "more menu trigger (closed)",
    before: "if(we=null,(i||r!=null)&&!f){",
    after: "if(we=null,(i||r!=null||RDlOn!=null)&&!f){",
  },
  {
    label: "more menu trigger (open)",
    before: "else if(i||r!=null){let ot;e[98]!==wt?",
    after: "else if(i||r!=null||RDlOn!=null){let ot;e[98]!==wt?",
  },
  {
    label: "more menu items",
    before:
      "let lt;e[107]!==tt||e[108]!==ct?(lt=p.jsxs(It.Content,{\"aria-label\":\"More message actions\",minWidth:200,ref:A,size:\"md\",children:[tt,ct]}),e[107]=tt,e[108]=ct,e[109]=lt):lt=e[109];",
    after:
      "let RDlItem;e[153]!==_||e[154]!==RDlOn||e[155]!==RDlCount?(RDlItem=RDlOn!=null?p.jsx(It.Item,{leading:p.jsx(bt,{name:\"desktop-download\",size:\"base\"}),onSelect:()=>{RDlOn(),_()},children:RDownloadLabel(RDlCount)}):null,e[153]=_,e[154]=RDlOn,e[155]=RDlCount,e[156]=RDlItem):RDlItem=e[156];" +
      "let lt;e[107]!==tt||e[108]!==ct||e[157]!==RDlItem?(lt=p.jsxs(It.Content,{\"aria-label\":\"More message actions\",minWidth:200,ref:A,size:\"md\",children:[tt,RDlItem,ct]}),e[107]=tt,e[108]=ct,e[157]=RDlItem,e[109]=lt):lt=e[109];",
  },
  {
    label: "context menu guard",
    before: "e[142]!==r||e[143]!==fe?(Je=f?p.jsx(no,",
    after: "e[142]!==r||e[143]!==fe||e[158]!==RDlOn||e[159]!==RDlCount?(Je=f?p.jsx(no,",
  },
  {
    label: "context menu items",
    before:
      "onSelect:u,children:\"Start a thread\"}):null,r!=null?p.jsx(no.Item,{leading:p.jsx(bt,{name:\"copy\",size:\"base\"}),onSelect:r,children:\"Copy\"}):null]})}):null,e[133]=z,",
    after:
      "onSelect:u,children:\"Start a thread\"}):null,RDlOn!=null?p.jsx(no.Item,{leading:p.jsx(bt,{name:\"desktop-download\",size:\"base\"}),onSelect:RDlOn,children:RDownloadLabel(RDlCount)}):null,r!=null?p.jsx(no.Item,{leading:p.jsx(bt,{name:\"copy\",size:\"base\"}),onSelect:r,children:\"Copy\"}):null]})}):null,e[133]=z,",
  },
  {
    label: "context menu store",
    before: "e[142]=r,e[143]=fe,e[144]=Je",
    after: "e[142]=r,e[143]=fe,e[158]=RDlOn,e[159]=RDlCount,e[144]=Je",
  },
  {
    label: "message wrapper props + memo cache",
    before: "function Roe(n){const e=he.c(37),{entry:t,children:s,onCopy:r}=n,i=r1(),",
    after: "function Roe(n){const e=he.c(39),{entry:t,children:s,onCopy:r,downloadAttachments:RDlAll}=n,i=r1(),RDl=RMessageDownloads(t,RDlAll),",
  },
  {
    label: "message wrapper renders hover actions",
    before: "e[0]!==s||e[1]!==t||e[2]!==r?(l=p.jsx(mCn,{entry:t,onCopy:r,children:s}),e[0]=s,e[1]=t,e[2]=r,e[3]=l):l=e[3]",
    after:
      "e[0]!==s||e[1]!==t||e[2]!==r||e[37]!==RDl.onDownload||e[38]!==RDl.downloadCount?(l=p.jsx(mCn,{downloadCount:RDl.downloadCount,entry:t,onCopy:r,onDownload:RDl.onDownload,children:s}),e[0]=s,e[1]=t,e[2]=r,e[37]=RDl.onDownload,e[38]=RDl.downloadCount,e[3]=l):l=e[3]",
  },
  {
    label: "image group host memo cache",
    before: "function hMn(n){const e=he.c(17),",
    after: "function hMn(n){const e=he.c(20),",
  },
  {
    label: "image group host passes every attachment",
    before:
      "let f;return e[13]!==o||e[14]!==u||e[15]!==m?(f=p.jsx(o,{entry:u,children:m}),e[13]=o,e[14]=u,e[15]=m,e[16]=f):f=e[16],f}",
    after:
      "let RDlAll;e[17]!==t?(RDlAll=t.flatMap(RDownloadTargetsOf),e[17]=t,e[18]=RDlAll):RDlAll=e[18];" +
      "let f;return e[13]!==o||e[14]!==u||e[15]!==m||e[19]!==RDlAll?(f=p.jsx(o,{downloadAttachments:RDlAll,entry:u,children:m}),e[13]=o,e[14]=u,e[15]=m,e[19]=RDlAll,e[16]=f):f=e[16],f}",
  },
]);

export const DOWNLOAD_ALL_MEMO_CACHES = Object.freeze({
  mCn: { before: 149, after: 160 },
  Roe: { before: 37, after: 39 },
  hMn: { before: 17, after: 20 },
});

const INJECTED_SOURCE = String.raw`
function RDownloadBasename(n){const e=n.replace(/[/\\]+$/,""),t=Math.max(e.lastIndexOf("/"),e.lastIndexOf("\\")),s=t>=0?e.slice(t+1):e;return s.length>0?s:n}
function RDownloadIsLocal(n){if(n.length===0)return!1;let e;try{e=new URL(n)}catch{return!0}return e.protocol==="file:"}
function RDownloadTargetsOf(n){if(n.kind==="user-attachment")return[{path:n.file_path,suggestedName:n.file_name??RDownloadBasename(n.file_path)}];if(n.kind!=="send-message"||n.message.type!=="attachment")return[];const e=n.message.url;return RDownloadIsLocal(e)?[{path:e,suggestedName:n.message.file_name??RDownloadBasename(e)}]:[]}
async function RDownloadSequentially(n,e){for(const{path:t,suggestedName:s}of e)await n.downloadAttachment({path:t,suggestedName:s})}
function RDownloadLabel(n){return(n??0)>1?RLocT("Download all","全部下载"):RLocT("Download","下载")}
function RMessageDownloads(n,e){const t=S.useContext(ktt),s=t==null?null:t.desktop,r=S.useMemo(()=>e??RDownloadTargetsOf(n),[e,n]),i=S.useMemo(()=>r.length===0||s==null?void 0:()=>{RDownloadSequentially(s,r).catch(ykn)},[s,r]);return{onDownload:i,downloadCount:r.length}}
`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalDownloadAll(source) {
  let next = source;
  for (const edit of EDITS) next = replaceExactlyOnce(next, edit.before, edit.after, edit.label);
  return replaceExactlyOnce(next, HOVER_ACTIONS_ANCHOR, `${INJECTED_SOURCE}${HOVER_ACTIONS_ANCHOR}`, "hover actions component");
}

export async function applyOriginalRendererDownloadAll({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(EDITS[0].before)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one original renderer chunk for the download-all patch, found ${candidates.length}.`);
  }
  const candidate = candidates[0];
  const patched = patchOriginalDownloadAll(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-download-all",
    evidence: {
      reference: "Grok Bot 0.71.2 renderer (rea-grokbot-0712/app/dist/renderer/assets)",
      targets: "index-wlkGG389.js @1185370 SV (+ rRe/dRe), basename eager-app @972376 cM",
      wrapper: "index-wlkGG389.js @1218997 rr (downloadAttachments ?? SV(entry); downloadCount)",
      downloader: "index.eager-app-DSuGVQNC.js @314845 uFe (sequential desktop.downloadAttachment per file)",
      imageGroup: "index-wlkGG389.js @1456874 (downloadAttachments: entries.flatMap(SV))",
      hoverMenu: "index-wlkGG389.js @1194383 _V more menu (desktop-download item before Copy)",
      contextMenu: "index-wlkGG389.js @1199046 (desktop-download item after Reply, before Copy)",
      copy: [
        { id: "3YP/Ra", en: "Download all", zhHans: "全部下载 (chunk-chat-oYCOIqHR.js)" },
        { id: "mzI/c+", en: "Download", zhHans: "下载 (chunk-chat-oYCOIqHR.js)" },
      ],
      deviations: [
        "rejections are swallowed with 0.18's own no-op download catch (ykn), as 0.18's other downloadAttachment call sites do",
      ],
    },
    chunks: [
      {
        role: "message-hover-actions",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
        memoCaches: DOWNLOAD_ALL_MEMO_CACHES,
        anchors: EDITS.map(edit => edit.label),
      },
    ],
    features: ["message-download-attachments"],
    transformations: ["image-group-passes-all-attachments", "wrapper-computes-download-targets", "hover-and-context-menus-gain-download-item"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-download-all-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
