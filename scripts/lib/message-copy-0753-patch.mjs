import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const REQUEST_ID = '(t.kind==="message"||t.kind==="send-message")&&t.requestId!=null&&t.requestId.length>0?t.requestId:null';
const legacyRequestItem = component => `RMsgRequestId==null?null:p.jsx(${component}.Item,{leading:p.jsx(bt,{name:"copy",size:"base"}),onSelect:()=>{RMsgCopyRequest(RMsgRequestId)${component === "It" ? ",_()" : ""}},children:RLocT("Copy request ID","复制请求 ID")})`;
const requestItem = component => `(t.kind==="message"||t.kind==="send-message")?p.jsx(${component}.Item,{disabled:RMsgRequestId==null,leading:p.jsx(bt,{name:"copy",size:"base"}),onSelect:()=>{if(RMsgRequestId==null)return;RMsgCopyRequest(RMsgRequestId)${component === "It" ? ",_()" : ""}},children:RLocT("Copy request ID","复制请求 ID")}):null`;
const hash = source => createHash("sha256").update(source).digest("hex");

// Official 0.75.3 index.eager-app-DjFE9lSq.js VX reads entry.requestId and
// appends its copy item to both menus. 0.18 mCn already owns those menus.
const EDITS = [
  ['function mCn(n){const e=he.c(160),', 'function mCn(n){const e=he.c(168),'],
  ['onDownload:RDlOn,downloadCount:RDlCount}=n,', `onDownload:RDlOn,downloadCount:RDlCount}=n,RMsgRequestId=${REQUEST_ID},[,RMsgCopyRequest]=ome(),`],
  ['if(!l&&RDlOn==null){', 'if(!l&&RDlOn==null&&RMsgRequestId==null){'],
  ['e[149]!==RDlOn||e[150]!==RDlCount){', 'e[149]!==RDlOn||e[150]!==RDlCount||e[160]!==RMsgRequestId||e[161]!==RMsgCopyRequest){'],
  ['e[149]=RDlOn,e[150]=RDlCount,', 'e[149]=RDlOn,e[150]=RDlCount,e[160]=RMsgRequestId,e[161]=RMsgCopyRequest,'],
  ['e[151]!==RDlOn||e[152]!==RDlCount){', 'e[151]!==RDlOn||e[152]!==RDlCount||e[162]!==RMsgRequestId||e[163]!==RMsgCopyRequest){'],
  ['e[151]=RDlOn,e[152]=RDlCount,', 'e[151]=RDlOn,e[152]=RDlCount,e[162]=RMsgRequestId,e[163]=RMsgCopyRequest,'],
  ['(i||r!=null||RDlOn!=null)&&!f', '(i||r!=null||RDlOn!=null||RMsgRequestId!=null)&&!f'],
  ['else if(i||r!=null||RDlOn!=null){', 'else if(i||r!=null||RDlOn!=null||RMsgRequestId!=null){'],
  ['e[108]!==ct||e[157]!==RDlItem?', 'e[108]!==ct||e[157]!==RDlItem||e[164]!==RMsgRequestId||e[165]!==RMsgCopyRequest?'],
  ['children:[tt,RDlItem,ct]', `children:[tt,RDlItem,ct,${requestItem("It")}]`],
  ['e[157]=RDlItem,e[109]=lt', 'e[157]=RDlItem,e[164]=RMsgRequestId,e[165]=RMsgCopyRequest,e[109]=lt'],
  ['e[158]!==RDlOn||e[159]!==RDlCount?', 'e[158]!==RDlOn||e[159]!==RDlCount||e[166]!==RMsgRequestId||e[167]!==RMsgCopyRequest?'],
  ['):null]})}):null,e[133]=z,', `):null,${requestItem("no")}]})}):null,e[133]=z,`],
  ['e[158]=RDlOn,e[159]=RDlCount,e[144]=Je', 'e[158]=RDlOn,e[159]=RDlCount,e[166]=RMsgRequestId,e[167]=RMsgCopyRequest,e[144]=Je'],
];

export function patchMessageCopy0753(source) {
  if (source.includes("RMsgRequestId=")) {
    if (source.includes(requestItem("It")) && source.includes(requestItem("no"))) return { text: source, applied: false };
    let text = source;
    for (const component of ["It", "no"]) {
      const before = legacyRequestItem(component);
      if (text.split(before).length !== 2) throw new Error("Message copy patch: existing request ID item changed.");
      text = text.replace(before, requestItem(component));
    }
    return { text, applied: true };
  }
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const matches = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === "mCn");
  if (matches.length !== 1) throw new Error(`Message copy patch: expected one action component, found ${matches.length}.`);
  const [node] = matches;
  let component = source.slice(node.start, node.end);
  for (const [before, after] of EDITS) {
    if (component.split(before).length !== 2) throw new Error(`Message copy patch anchor missing or ambiguous: ${before}`);
    component = component.replace(before, after);
  }
  for (const [start, end, replacement] of [
    ["let tt;e[100]", ":tt=e[103];", "let tt=null;"],
    ['i?p.jsx(no.Item,{leading:p.jsx(bt,{name:"chat-bubbles",size:"base"}),onSelect:u,children:', "):null,", ""],
  ]) {
    const from = component.indexOf(start);
    const to = component.indexOf(end, from + start.length);
    if (from < 0 || to < 0 || component.indexOf(start, from + start.length) >= 0) throw new Error("Message copy patch: legacy thread menu anchor missing or ambiguous.");
    component = component.slice(0, from) + replacement + component.slice(to + end.length);
  }
  parse(component, { ecmaVersion: "latest", sourceType: "module" });
  return { text: source.slice(0, node.start) + component + source.slice(node.end), applied: true };
}

export async function applyMessageCopy0753Patch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist/renderer/assets");
  const candidates = [];
  for (const file of (await readdir(assets)).filter(name => name.endsWith(".js"))) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes("function mCn(n){")) candidates.push({ file, source });
  }
  if (candidates.length !== 1) throw new Error(`Message copy patch: expected one renderer chunk, found ${candidates.length}.`);
  const [{ file, source }] = candidates;
  const result = patchMessageCopy0753(source);
  if (!result.applied) return { applied: false };
  await writeFile(path.join(assets, file), result.text);
  const provenance = {
    mode: "message-copy-0753",
    reference: "0.75.3 index.eager-app-DjFE9lSq.js VX",
    features: ["copy-message", "copy-request-id", "legacy-request-id-disabled", "hover-and-context-menus", "no-legacy-thread-item"],
    files: [{ file, originalSha256: hash(source), patchedSha256: hash(result.text) }],
  };
  await writeFile(path.join(stageRoot, "dist/renderer-message-copy-0753-extension.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
