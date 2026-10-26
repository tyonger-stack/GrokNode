// Official 0.75.8 confirmation card on the existing Auto-review lifecycle.
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

export const MCP_ELICITATION_STRINGS = Object.freeze([
  ["Allowed", "已允许", "joLIQz"],
  ["Denied", "已拒绝", "JsY1p5"],
  ["Expired", "已过期", "M1RnFv"],
  ["While running {toolName}", "运行 {toolName} 时", "6+2WKR"],
  ["View the full request", "查看完整请求", "5+TRII"],
  ["{connector} needs your confirmation", "{connector} 需要你确认", "HB0Zic"],
  ["Allow", "允许", "h7peZQ"],
  ["Deny", "拒绝", "cFCKYZ"],
  ["Your answer didn't go through. Check your connection and try again.", "你的回答未发送成功。请检查网络连接后重试。", "sSMHtl"],
]);

const sha256 = value => createHash("sha256").update(value).digest("hex");

export const OFFICIAL_EVIDENCE = Object.freeze({
  version: "0.75.8",
  minified: "rea-grokbot-0758/app/dist/renderer/assets/chunk-unrequested-meeting-approval-DJ_BNQSG.js",
  minifiedBytes: 21368,
  minifiedSha256: "24f495f64fbe3d61e68451cab829f89732c3ed868b5b7859de22efffde1aee25",
  readable: "rea-grokbot-0758/frontend/chunk-unrequested-meeting-approval-DJ_BNQSG.mjs",
  readableBytes: 29518,
  readableSha256: "1966261d22e996677be6e9fe363cb5e83e1ade6980a97af9e0688aa667ec7b2e",
  component: "ce",
  truncation: "H=8; ae=600; se(message)=length>ae || split('\\n').length>H",
  summaryBranch: "je: summaryCopy.kind === 'mcp_elicitation'",
  messageIds: Object.freeze([
    "joLIQz",
    "JsY1p5",
    "M1RnFv",
    "6+2WKR",
    "5+TRII",
    "HB0Zic",
    "h7peZQ",
    "cFCKYZ",
    "sSMHtl",
  ]),
});

const TARGET_FILE = "view-QqBtBG74.js";
const SHELL_FILE = "index-UbX-y3il.js";
const COMPONENT_MARKER = "function RMcpElicitation0758(";
const SHELL_DISCLOSURE_BEFORE = "}),J?`Hide the ${u.kind}`:`Show the ${u.kind}`]}";
const SHELL_DISCLOSURE_AFTER = "}),u.label??(J?`Hide the ${u.kind}`:`Show the ${u.kind}`)]}";

function importVariant(before, after, label) {
  return { before, after, label };
}

// The router patch adds RArIcon. Pin the post-router import exactly; relocation
// is intentionally unsupported so a future chunk split fails closed.
const IMPORT_VARIANTS = [
  importVariant(
    'import{c as P,w as F,O,K as U,R as V,j as C,V as q,W as z,X as D,Y as H,Z as W,g as Y,M as K,E as X,I as RArIcon}from"./index-UbX-y3il.js";',
    'import{c as P,w as F,O,K as U,R as V,n as RMcpText,j as C,V as q,W as z,X as D,Y as H,Z as W,g as Y,M as K,E as X,I as RArIcon}from"./index-UbX-y3il.js";',
    "main import after router/auto-review",
  ),
];

const COMPONENT_SOURCE = String.raw`function RMcpLoc(en,zh){return typeof RLocT==="function"?RLocT(en,zh):en}
function RMcpFill(text,values){return text.replace(/\{([A-Za-z0-9_]+)\}/g,function(_m,key){return String(values[key]??"")})}
function RMcpPickStatus(status){
switch(status){
case"approved":case"always":return RMcpLoc("Allowed","已允许");
case"denied":return RMcpLoc("Denied","已拒绝");
case"pending":return;
default:return RMcpLoc("Expired","已过期")
}
}
function RMcpStatusLabel(status){
const label=RMcpPickStatus(status);
return label===void 0?void 0:{kind:status==="denied"?"danger":status==="approved"||status==="always"?"success":"muted",label:label}
}
function RMcpSummaryParams(copy){
if(copy==null||copy.kind!=="mcp_elicitation"||typeof copy.params!=="object"||copy.params===null||Array.isArray(copy.params)||typeof copy.params.message!=="string")return null;
const server=typeof copy.params.serverDisplayName==="string"&&copy.params.serverDisplayName.length>0?copy.params.serverDisplayName:void 0;
const tool=typeof copy.params.toolName==="string"&&copy.params.toolName.length>0?copy.params.toolName:void 0;
return{message:copy.params.message,serverDisplayName:server,toolName:tool}
}
function RMcpElicitation0758(props){
const{approval:a,status:u,canAct:p,onResolve:r}=props;const copy=RMcpSummaryParams(a.summaryCopy);
const[submitting,setSubmitting]=F.useState(null),[failed,setFailed]=F.useState(false),inFlight=F.useRef(false);
if(copy==null)return null;
const server=copy.serverDisplayName,tool=copy.toolName,message=copy.message,collapsible=typeof message==="string"&&(message.length>600||message.split("\n").length>8);
const messageNode=message.length===0?null:C.jsx(RMcpText,{as:"div",dir:"auto",level:"body2",className:"sand-9f619 sand-h8yej3 sand-euugli sand-7z7khe sand-mkeg23 sand-1y0btm7 sand-5fd6op sand-4pepcl sand-10e981r sand-tyxrsu sand-126k92a sand-j0a0fe sand-104kibb sand-1ua5tub sand-1w5w6ud sand-e3flgd sand-b3r6kr",style:collapsible?{WebkitLineClamp:8,lineClamp:8,borderColor:"var(--sand-border-default)"}:{borderColor:"var(--sand-border-default)"},children:message});
const toolNode=tool===undefined?null:C.jsx(RMcpText,{as:"div",level:"body2",className:"sand-1o0liin sand-j0a0fe",children:RMcpFill(RMcpLoc("While running {toolName}","运行 {toolName} 时"),{toolName:tool})});
const body=C.jsxs(C.Fragment,{children:[messageNode,toolNode]});
const answer=function(resolution){if(!p||inFlight.current)return;inFlight.current=true;setFailed(false);setSubmitting(resolution);Promise.resolve().then(()=>r(resolution)).catch(function(){setFailed(true)}).finally(function(){inFlight.current=false;setSubmitting(null)})};
const actions=[{label:RMcpLoc("Allow","允许"),onClick:function(){answer("approved")},disabled:!p||submitting!==null,pending:submitting==="approved",variant:"primary"},{label:RMcpLoc("Deny","拒绝"),onClick:function(){answer("denied")},disabled:!p||submitting!==null,pending:submitting==="denied",variant:"tertiary"}];
const title=server===undefined?props.fallbackTitle:RMcpFill(RMcpLoc("{connector} needs your confirmation","{connector} 需要你确认"),{connector:server});
const settled=RMcpStatusLabel(u),disclosure=collapsible?{label:RMcpLoc("View the full request","查看完整请求"),isDetailCollapsed:!0,isLabeledWhenElevated:!0,detail:{kind:"text",text:message,copyText:message}}:void 0,source={icon:C.jsx(RArIcon,{name:"plug"}),label:server??props.fallbackTitle};
return C.jsx(q,{source:source,title:title,summary:body,...u==="pending"?{actions:actions}:{status:settled},...disclosure===void 0?{}:{disclosure:disclosure},...failed?{failureNote:RMcpLoc("Your answer didn't go through. Check your connection and try again.","你的回答未发送成功。请检查网络连接后重试。")}:{}})
}
`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error("MCP elicitation renderer " + label + " anchor must appear exactly once.");
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function projectMcpElicitationSummaryCopy(summaryCopy) {
  if (!isRecord(summaryCopy) || summaryCopy.kind !== "mcp_elicitation" || !isRecord(summaryCopy.params)) return undefined;
  const { message, serverDisplayName, toolName } = summaryCopy.params;
  if (typeof message !== "string") return undefined;
  const server = typeof serverDisplayName === "string" && serverDisplayName.length > 0 ? serverDisplayName : undefined;
  const tool = typeof toolName === "string" && toolName.length > 0 ? toolName : undefined;
  return {
    kind: "mcp_elicitation",
    params: {
      message,
      ...(server === undefined ? {} : { serverDisplayName: server }),
      ...(tool === undefined ? {} : { toolName: tool }),
    },
  };
}

export function mcpElicitationShouldCollapse(message) {
  if (typeof message !== "string") return false;
  return message.length > 600 || message.split("\n").length > 8;
}

export function patchOriginalMcpElicitationDisclosureShell(source) {
  if (source.includes(SHELL_DISCLOSURE_AFTER)) {
    throw new Error("MCP elicitation disclosure shell patch was already applied.");
  }
  const patched = replaceExactlyOnce(source, SHELL_DISCLOSURE_BEFORE, SHELL_DISCLOSURE_AFTER, "disclosure shell label");
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return patched;
}

export function patchOriginalMcpElicitation0758(source) {
  // Must run after main-i18n (RLocT), extra-i18n, and router (RArRuleNotice).
  if (!source.includes("function RLocT(")) throw new Error("MCP elicitation renderer patch must run after the i18n passes.");
  if (!source.includes("function RArRuleNotice(")) throw new Error("MCP elicitation renderer patch must run after the Auto-review pass.");
  if (source.includes(COMPONENT_MARKER)) throw new Error("MCP elicitation renderer patch was already applied.");
  const imports = IMPORT_VARIANTS.filter(variant => source.includes(variant.before));
  if (imports.length !== 1) throw new Error("MCP elicitation renderer main import anchor must match one pinned dialect; found " + imports.length + ".");
  let patched = replaceExactlyOnce(source, imports[0].before, imports[0].after, imports[0].label);
  const componentAt = source.indexOf("function me(t){");
  if (componentAt < 0 || source.indexOf("function me(t){", componentAt + 1) >= 0) throw new Error("MCP elicitation renderer component anchor must appear exactly once.");
  patched = replaceExactlyOnce(patched, "function me(t){", COMPONENT_SOURCE + "function me(t){", "component insertion");
  const branchBefore = "const m=I,v=a.command??RArSum(a.summary);let c,w,d,_;";
  patched = replaceExactlyOnce(
    patched,
    branchBefore,
    branchBefore.replace(
      "let c,w,d,_;",
      "if(a.summaryCopy?.kind===\"mcp_elicitation\"){const mcpAnswer=L=>{if(!p||s==null)return Promise.resolve();return pe({agentId:s,entryId:n,requestId:a.requestId,resolution:L,loadAlwaysAllow:()=>Promise.resolve(L),resolveAutoReviewApproval:o})};return C.jsx(RMcpElicitation0758,{approval:a,status:u,canAct:p,fallbackTitle:m.title,onResolve:mcpAnswer})}let c,w,d,_;",
    ),
    "approval branch",
  );
  for (const error of [
    "a.mcp_elicitation_summary_missing",
    "window.desktop.invoke",
    "elicitation/create",
  ]) if (patched.includes(error)) throw new Error("MCP elicitation renderer patch introduced an invented host path: " + error);
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return patched;
}

export async function applyMcpElicitation0758Patch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const entries = await readdir(assets);
  if (!entries.includes(TARGET_FILE)) throw new Error("MCP elicitation renderer patch target is missing: " + TARGET_FILE);
  if (!entries.includes(SHELL_FILE)) throw new Error("MCP elicitation disclosure shell target is missing: " + SHELL_FILE);
  const target = path.join(assets, TARGET_FILE);
  const shellTarget = path.join(assets, SHELL_FILE);
  const original = await readFile(target, "utf8");
  const shellOriginal = await readFile(shellTarget, "utf8");
  if (!original.includes("function RLocT(")) throw new Error("MCP elicitation renderer patch requires the i18n RLocT runtime first.");
  if (!original.includes("function RArRuleNotice(")) throw new Error("MCP elicitation renderer patch requires the Auto-review approval pass first.");
  const patched = patchOriginalMcpElicitation0758(original);
  const shellPatched = patchOriginalMcpElicitationDisclosureShell(shellOriginal);
  await writeFile(target, patched);
  await writeFile(shellTarget, shellPatched);
  const provenance = {
    schemaVersion: 1,
    mode: "mcp-elicitation-0758",
    referenceVersion: "0.75.8",
    official: OFFICIAL_EVIDENCE,
    hostSeam: {
      status: "connected",
      channel: "auto-review-approval",
      summaryCopyKind: "mcp_elicitation",
      writer: "LocalHttpMcpExec -> AutoReviewService.requestMcpElicitation",
      reason: "HTTP/SSE confirmation-only form requests carry an owning agent and return accept, decline, or cancel; forms with fields are declined.",
    },
    files: [
      {
        role: "approval-card",
        path: TARGET_FILE,
        original: { bytes: Buffer.byteLength(original), sha256: sha256(original) },
        patched: { bytes: Buffer.byteLength(patched), sha256: sha256(patched) },
      },
      {
        role: "disclosure-label",
        path: SHELL_FILE,
        original: { bytes: Buffer.byteLength(shellOriginal), sha256: sha256(shellOriginal) },
        patched: { bytes: Buffer.byteLength(shellPatched), sha256: sha256(shellPatched) },
      },
    ],
    features: ["mcp-elicitation-approval-card", "mcp-elicitation-truncation", "mcp-elicitation-auto-review-lifecycle"],
    transformations: ["import-body-text", "inject-RMcpElicitation0758", "route-mcp_elicitation-summaryCopy", "allow-deny-only", "official-disclosure-label"],
  };
  await writeFile(path.join(stageRoot, "dist", "renderer-mcp-elicitation-0758.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}

export const MCP_ELICITATION_ANCHORS = Object.freeze({
  component: COMPONENT_SOURCE,
  importBefore: IMPORT_VARIANTS[0].before,
  importAfter: IMPORT_VARIANTS[0].after,
  approvalBranchBefore: "const m=I,v=a.command??RArSum(a.summary);let c,w,d,_;",
  shellDisclosureBefore: SHELL_DISCLOSURE_BEFORE,
  shellDisclosureAfter: SHELL_DISCLOSURE_AFTER,
});
