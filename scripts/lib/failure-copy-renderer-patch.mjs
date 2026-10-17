// Grok Bot 0.71.2 turn-failure copy, ported onto the checksum-pinned 0.18 renderer.
//
// The host (commits 2288040 / 53572cd) now sends, for a failed turn:
//   * an error tray with `titleKind` (model_provider_overloaded | bot_failed_to_respond),
//     `errorKind` and, for unknown_failure, `errorParams.technicalDetail`;
//   * a transcript `kind:"notice"` entry with
//     `failure: {errorKind?, titleKind, title:{id,message,zh}, detail?:{id,message,zh}}`.
//
// Where 0.71.2 shows this (evidence, byte offsets in the 0.71.2 asar):
//   * The error tray `_J` (index-wlkGG389.js @2204500) renders its title as `Kge(n)`
//     and its body as `n.errorKind==="provider_overloaded" ? f({id:"cg5y8u"}) : Hge(n)`.
//     `Kge`/`Hge` are index.eager-app-DSuGVQNC.js's `S2e` (@1229240: titleKind → `zg`
//     id, else `n.title`) and `G0` (@864973: errorKind == null → detail;
//     known kind → `Cu` id; unknown_failure → `jcTFBf` with `technicalDetail`).
//     0.18's tray `yzn` renders `n.title` verbatim and shows the overloaded copy only
//     behind the `sandModelExperiment` snapshot (`oJt()`), which this build never has.
//   * The transcript notice card (chunk-view-Dh6NA3C5.js) renders only the entry text
//     (localised by its team-bot `copy`); 0.71.2 has no failure title/detail card in the
//     transcript. The notice change below therefore keeps 0.18's card and styles byte-
//     for-byte and only swaps the text for the host-supplied localized copy (whose ids
//     and zh strings are 0.71.2's own), falling back to `text` when `failure.detail` is
//     absent.
//
// Copy (en from index.eager-app-DSuGVQNC.js, zh-Hans from chunk-shared-DwNCHcV3.js):
//   Rdu4z7 Model provider is overloaded / 模型提供方已过载
//   Uq1VXs Bot failed to respond / Bot 未能回复
//   Ly7/5m, 5wdRDj, tixDan (Cu detail ids), jcTFBf (technical-detail wrapper).
// cg5y8u stays the existing 0.18 literal so main-i18n's FULL pair keeps its anchor.
// backend_unreachable is not mapped: its 0.71.2 copy (u6fkmt) names the Cursor backend,
// which the host deliberately omits too; the tray then keeps the host detail.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const TRAY_SIGNATURE = "function yzn({tray:n,onDismiss:e}){";
const OVERLOADED_LITERAL =
  '"The model provider is under heavy load right now. This is usually temporary — try again shortly."';
const TRAY_DETAIL_BEFORE = `o=n.errorKind==="provider_overloaded"&&i?${OVERLOADED_LITERAL}:n.detail,`;
const TRAY_DETAIL_AFTER = `o=n.errorKind==="provider_overloaded"?${OVERLOADED_LITERAL}:RFailTrayDetail(n),`;
const TRAY_TITLE_BEFORE = 'className:re("sand-tray__title","sand-1wd3ewq"),size:"sm",weight:"medium",children:n.title}';
const TRAY_TITLE_AFTER = 'className:re("sand-tray__title","sand-1wd3ewq"),size:"sm",weight:"medium",children:RFailTrayTitle(n)}';
const EXPORT_BEFORE = "export{";
const EXPORT_AFTER = "export{RFailNoticeText,";

const HELPERS =
  "const RFailTitleCopy={"
  + 'model_provider_overloaded:["Model provider is overloaded","模型提供方已过载"],'
  + 'bot_failed_to_respond:["Bot failed to respond","Bot 未能回复"]};'
  + "const RFailDetailCopy={"
  + 'first_token_stall:["The model didn\'t start responding in time. Try again.","模型未能及时开始响应。请重试。"],'
  + 'conversation_too_large:["This conversation is too large to continue. Start a new conversation with this agent.","此对话过长，无法继续。请与该 Bot 开始新的对话。"],'
  + 'opaque_wire_failure:["Something went wrong while generating the reply. Try again.","生成回复时出错了。请重试。"]};'
  + "function RFailOwn(t,k){return typeof k==\"string\"&&Object.prototype.hasOwnProperty.call(t,k)?t[k]:null}"
  + "function RFailTrayTitle(n){const c=n.titleKind==null?null:RFailOwn(RFailTitleCopy,n.titleKind);"
  + "return c==null?n.title:RLocT(c[0],c[1])}"
  + "function RFailTechnical(t){return t==null?RLocT(RFailDetailCopy.opaque_wire_failure[0],RFailDetailCopy.opaque_wire_failure[1])"
  + ':RLocT("Something went wrong. Technical details: "+t,"出现问题。技术详细信息："+t)}'
  + "function RFailTrayDetail(n){const t=n.detail!=null&&n.detail.length>0?n.detail:null;"
  + "if(n.errorKind==null)return t;"
  + 'if(n.errorKind==="unknown_failure"){const d=n.errorParams?.technicalDetail;return RFailTechnical(typeof d=="string"&&d.length>0?d:t)}'
  + "const c=RFailOwn(RFailDetailCopy,n.errorKind);return c==null?t:RLocT(c[0],c[1])}"
  + "function RFailCopyOk(c){return c!=null&&typeof c.message==\"string\"&&typeof c.zh==\"string\"}"
  + "function RFailNoticeText(n){const f=n.failure;"
  + "if(f==null||!RFailCopyOk(f.title)||!RFailCopyOk(f.detail))return n.text;"
  + 'return RLocT(f.title.message+": "+f.detail.message,f.title.zh+"："+f.detail.zh)}';

const NOTICE_MARKER = 'l("sand-notice",s.className)';
const NOTICE_IMPORT_BEFORE = 'import{c as r,f as l,j as c,T as o}from"./index-UbX-y3il.js";';
const NOTICE_IMPORT_AFTER = 'import{c as r,f as l,j as c,T as o,RFailNoticeText as RFailNoticeText}from"./index-UbX-y3il.js";';
const NOTICE_TEXT_BEFORE = 'c.jsx(o,{color:"tertiary",size:"sm",children:n.text})';
const NOTICE_TEXT_AFTER = 'c.jsx(o,{color:"tertiary",size:"sm",children:RFailNoticeText(n)})';

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer failure-copy ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchFailureCopyMainChunk(source) {
  let patched = replaceExactlyOnce(source, TRAY_DETAIL_BEFORE, TRAY_DETAIL_AFTER, "tray detail");
  patched = replaceExactlyOnce(patched, TRAY_TITLE_BEFORE, TRAY_TITLE_AFTER, "tray title");
  patched = replaceExactlyOnce(patched, TRAY_SIGNATURE, HELPERS + TRAY_SIGNATURE, "tray helpers");
  patched = replaceExactlyOnce(patched, EXPORT_BEFORE, EXPORT_AFTER, "helper export");
  return patched;
}

export function patchFailureCopyNoticeChunk(source) {
  let patched = replaceExactlyOnce(source, NOTICE_IMPORT_BEFORE, NOTICE_IMPORT_AFTER, "notice import");
  patched = replaceExactlyOnce(patched, NOTICE_TEXT_BEFORE, NOTICE_TEXT_AFTER, "notice text");
  return patched;
}

function digest(text) {
  return { bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") };
}

export async function applyOriginalRendererFailureCopy({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const mains = [];
  const notices = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(TRAY_SIGNATURE)) mains.push({ name, target, source });
    if (source.includes(NOTICE_MARKER)) notices.push({ name, target, source });
  }
  if (mains.length !== 1 || notices.length !== 1) {
    throw new Error(`Expected one tray chunk and one notice chunk for the failure-copy port, found ${mains.length}/${notices.length}.`);
  }
  const [main] = mains;
  const [notice] = notices;
  const patchedMain = patchFailureCopyMainChunk(main.source);
  const patchedNotice = patchFailureCopyNoticeChunk(notice.source);
  await writeFile(main.target, patchedMain);
  await writeFile(notice.target, patchedNotice);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-failure-copy",
    upstream: {
      version: "0.71.2",
      trayComponent: { chunk: "dist/renderer/assets/index-wlkGG389.js", name: "_J", offset: 2204500 },
      titleResolver: { chunk: "dist/renderer/assets/index.eager-app-DSuGVQNC.js", name: "S2e", offset: 1229240 },
      detailResolver: { chunk: "dist/renderer/assets/index.eager-app-DSuGVQNC.js", name: "G0", offset: 864973 },
      noticeCard: "dist/renderer/assets/chunk-view-Dh6NA3C5.js",
      zhHansTable: "dist/renderer/assets/chunk-shared-DwNCHcV3.js",
      messageIds: ["Rdu4z7", "Uq1VXs", "cg5y8u", "Ly7/5m", "5wdRDj", "tixDan", "jcTFBf"],
    },
    chunks: [
      { role: "tray", path: `dist/renderer/assets/${main.name}`, original: digest(main.source), patched: digest(patchedMain) },
      { role: "notice", path: `dist/renderer/assets/${notice.name}`, original: digest(notice.source), patched: digest(patchedNotice) },
    ],
    transformations: [
      "tray-title-from-titleKind",
      "tray-detail-from-errorKind-ungated",
      "notice-text-from-host-failure-copy",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-failure-copy-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
