// 0.70.2 / 0.71.2 fullscreen Watching → Take control (P0 computer-line).
//
// Evidence (official 0.71.2):
//   index-wlkGG389.js: useState(!1) hasControl; takeControl/stopControl
//   chunk-box-desktop-modal--0USskmH.js: sand-computer-control-bar;
//     stage class bit !hasControl → sand-47corl (pointer-events:none);
//     VNC viewer gets isInteractive:!0 ALWAYS + acceptsInput:hasControl
//   teach An: E=isInteractive&&acceptsInput → tabIndex; IPC sand:vnc-accepts-input
//   zh-Hans: 仅观看 / 取得控制权 / 你正在控制 / …
//
// 0.18 trap: toggling isInteractive alone only drops sandInteractive=1 (clipboard
// bridges). noVNC still accepts mouse/keyboard. Match official: keep
// isInteractive:!0, gate with acceptsInput + sand-47corl + tabIndex.
// Owner is `bbn` (not `gbn`). Order: after computer-sleep (preview wraps DAe),
// before i18n (emits RLocT).

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const BBN_HEAD =
  "function bbn({isOpen:n,agentId:e,isScreenLoading:t,isScreenUnavailable:s,onRetryScreen:r,monitors:i,focusMonitorId:o,subjectLabel:l,recordingAgentName:c,setupVncUrl:u,emptyMessage:d,isEmptyLoading:m=!0,pullPercent:f=null,baseHandoff:h,onMinimize:y,onHandBackHandoff:k,onDismissHandoff:v,onRequestComposerFocus:b,openedAtMs:x,openTrigger:N}){const{desktop:E}=Qe(),A=ENe(),I=Ftt(),P=Fde(),J=i4e(),[O,_]=S.useState(null),[B,R]=S.useState(null);";

const STATE_AFTER = BBN_HEAD + "const[RHasControl,RSetControl]=S.useState(!1);";

// Official keeps isInteractive:!0 so the webview URL/session stay interactive;
// acceptsInput (hasControl) is what actually gates click/type.
const CALL_BEFORE = "p.jsx(DAe,{isInteractive:!0,isViewerVisible:n,onHostKey:ge";
const CALL_AFTER = "p.jsx(DAe,{isInteractive:!0,acceptsInput:RHasControl,isViewerVisible:n,onHostKey:ge";

const DAE_DESTRUCTURE_BEFORE =
  "{src:r,className:i,isInteractive:o,onReadyChange:l,onConnectedChange:c,onCrashedChange:u,onHostKey:d,isViewerVisible:m,openedAtMs:f}=e,h=o===void 0?!1:o";
const DAE_DESTRUCTURE_AFTER =
  "{src:r,className:i,isInteractive:o,acceptsInput:RAcceptsInput,onReadyChange:l,onConnectedChange:c,onCrashedChange:u,onHostKey:d,isViewerVisible:m,openedAtMs:f}=e,h=o===void 0?!1:o,RAccepts=RAcceptsInput===void 0?!0:RAcceptsInput";

// After the memoised base className, append sand-47corl when input is off and
// drive tabIndex from the same gate (official E=isInteractive&&acceptsInput).
const DAE_GATE_BEFORE =
  's[13]!==i?(E=re("sand-box-vnc",i,"sand-3nfvp2 sand-h8yej3 sand-5yr21d sand-ng3xce"),s[13]=i,s[14]=E):E=s[14];let A;s[15]!==h||s[16]!==r?(A=abn(r,h),s[15]=h,s[16]=r,s[17]=A):A=s[17];const I=h?void 0:-1;';
const DAE_GATE_AFTER =
  's[13]!==i?(E=re("sand-box-vnc",i,"sand-3nfvp2 sand-h8yej3 sand-5yr21d sand-ng3xce"),s[13]=i,s[14]=E):E=s[14];'
  // Only block the interactive fullscreen surface while Watching.
  // Preview tiles (h=false) must not get sand-47corl — that would freeze pan/hover.
  + "const RCanInput=!!(h&&RAccepts);E=h&&!RAccepts?E+\" sand-47corl\":E;"
  + "let A;s[15]!==h||s[16]!==r?(A=abn(r,h),s[15]=h,s[16]=r,s[17]=A):A=s[17];"
  + "const I=RCanInput?void 0:-1;";

const BAR_BEFORE = 'p.jsx(pbn,{onExitFullscreen:W,...de?{onStartTeach:Te}:{}}),p.jsxs("div",{className:re("sand-computer-body",';
const BAR_AFTER =
  'p.jsx(pbn,{onExitFullscreen:W,...de?{onStartTeach:Te}:{}}),'
  + "p.jsx(RComputerControlBar,{hasControl:RHasControl,onTakeControl:()=>RSetControl(!0),onStopControl:()=>RSetControl(!1)}),"
  + 'p.jsxs("div",{className:re("sand-computer-body",';

const COMPONENT_INJECT_BEFORE = "function bbn({isOpen:n,agentId:e,";
const COMPONENT_SOURCE = String.raw`function RComputerControlBar(n){const{hasControl:e,onTakeControl:t,onStopControl:s}=n;const r=e?(RLocT("You're in control","你正在控制")):(RLocT("Watching","仅观看"));const i=e?null:p.jsx("span",{className:"sand-tfy4bk",style:{marginInlineStart:"8px",opacity:.75,fontSize:"12px"},children:(RLocT("Take control to click and type","取得控制权后即可点击和输入"))});const o=e?p.jsx(As,{onClick:s,size:"sm",type:"button",variant:"secondary",children:(RLocT("Stop","停止"))}):p.jsx(As,{onClick:t,size:"sm",type:"button",variant:"primary",children:(RLocT("Take control","取得控制权"))});return p.jsxs("div",{"aria-label":(RLocT("Computer control","电脑控制")),className:"sand-computer-control-bar sand-1n2onr6 sand-9f619 sand-78zum5 sand-6s0dn4 sand-2lah0s sand-167g77z sand-h8yej3 sand-n3w4p2 sand-163pfp",role:"status",style:{justifyContent:"space-between",alignItems:"center",paddingInline:"12px",paddingBlock:"8px",borderBottom:"0.5px solid var(--sand-border-default)",background:"var(--sand-bg-secondary)",zIndex:2},children:[p.jsxs("span",{"aria-live":"polite",className:"sand-78zum5 sand-6s0dn4 sand-1cy8zhl",style:{alignItems:"center",gap:"6px"},children:[p.jsx(bt,{name:e?"window-pointer-arrow":"eye",size:"sm","aria-hidden":!0}),r,i]}),o]})}
`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`computer-control ${label} anchor missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/**
 * Brace-balanced body of `function bbn(...){...}` for scope guards.
 * Must skip the parameter destructuring `{isOpen:n,...}` — the first `{`
 * after `function bbn(` is NOT the function body.
 */
export function extractBbnBody(source) {
  const start = source.indexOf("function bbn({isOpen:n,agentId:e,");
  if (start < 0) throw new Error("computer-control: bbn not found.");
  const openParen = source.indexOf("(", start);
  if (openParen < 0) throw new Error("computer-control: bbn params missing.");
  let parenDepth = 0;
  let bodyOpen = -1;
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") parenDepth += 1;
    else if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        let j = i + 1;
        while (j < source.length && /\s/.test(source[j])) j += 1;
        if (source[j] !== "{") {
          throw new Error("computer-control: bbn body brace missing.");
        }
        bodyOpen = j;
        break;
      }
    }
  }
  if (bodyOpen < 0) throw new Error("computer-control: bbn params unclosed.");
  let depth = 0;
  for (let i = bodyOpen; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("computer-control: bbn body unclosed.");
}

export function patchComputerControl(source) {
  let patched = source;
  patched = replaceExactlyOnce(patched, COMPONENT_INJECT_BEFORE, COMPONENT_SOURCE + COMPONENT_INJECT_BEFORE, "inject bar component");
  patched = replaceExactlyOnce(patched, BBN_HEAD, STATE_AFTER, "useState hasControl in bbn");
  patched = replaceExactlyOnce(patched, CALL_BEFORE, CALL_AFTER, "DAe acceptsInput");
  patched = replaceExactlyOnce(patched, DAE_DESTRUCTURE_BEFORE, DAE_DESTRUCTURE_AFTER, "DAe acceptsInput destructure");
  patched = replaceExactlyOnce(patched, DAE_GATE_BEFORE, DAE_GATE_AFTER, "DAe pointer-events + tabIndex gate");
  patched = replaceExactlyOnce(patched, BAR_BEFORE, BAR_AFTER, "control bar mount");
  if (!patched.includes("sand-computer-control-bar")) {
    throw new Error("computer-control patch did not mount the control bar.");
  }
  if (!patched.includes("acceptsInput:RHasControl")) {
    throw new Error("computer-control missing acceptsInput:RHasControl on fullscreen DAe.");
  }
  if (!patched.includes("h&&!RAccepts") || !patched.includes("sand-47corl")) {
    throw new Error("computer-control missing sand-47corl pointer-events gate.");
  }
  if (patched.includes("isInteractive:RHasControl")) {
    throw new Error("computer-control must not toggle isInteractive (remounts URL; does not block RFB).");
  }
  if (!patched.includes("isInteractive:!0,acceptsInput:RHasControl")) {
    throw new Error("computer-control must keep isInteractive:!0 with acceptsInput gate.");
  }
  const bbn = extractBbnBody(patched);
  if (!bbn.includes("const[RHasControl,RSetControl]=S.useState(!1)")) {
    throw new Error("computer-control: RHasControl state missing inside bbn.");
  }
  if ((bbn.match(/RHasControl/g) || []).length < 3) {
    throw new Error("computer-control: RHasControl uses escaped bbn scope.");
  }
  const gbnStart = patched.indexOf("function gbn(n){");
  if (gbnStart >= 0) {
    const gbnOpen = gbnStart + "function gbn(n)".length;
    let gbnDepth = 0;
    let gbnEnd = -1;
    for (let i = gbnOpen; i < patched.length; i += 1) {
      const ch = patched[i];
      if (ch === "{") gbnDepth += 1;
      else if (ch === "}") {
        gbnDepth -= 1;
        if (gbnDepth === 0) {
          gbnEnd = i + 1;
          break;
        }
      }
    }
    if (gbnEnd < 0) throw new Error("computer-control: gbn body unclosed.");
    if (patched.slice(gbnStart, gbnEnd).includes("RHasControl")) {
      throw new Error("computer-control: RHasControl leaked into gbn.");
    }
  }
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return patched;
}

export async function applyOriginalRendererComputerControl({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(BBN_HEAD) && source.includes(CALL_BEFORE) && source.includes(DAE_DESTRUCTURE_BEFORE)) {
      candidates.push({ name, target, source });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one chunk for computer-control (bbn+DAe), found ${candidates.length}.`);
  }
  const candidate = candidates[0];
  const patched = patchComputerControl(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-computer-control",
    upstream: {
      version: "0.71.2",
      controlBar: "dist/renderer/assets/chunk-box-desktop-modal--0USskmH.js",
      state: "index-wlkGG389.js hasControl useState(!1)",
      gate: "acceptsInput + sand-47corl pointer-events:none (keep isInteractive:!0)",
      ids: ["12cc1j", "cC22Hu", "Kmqs84", "qGXg6g", "ygCKqB"],
      owner: "bbn fullscreen modal (0.18)",
    },
    chunks: [
      {
        role: "computer-fullscreen",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
      },
    ],
    transformations: [
      "bbn-hasControl-useState-false",
      "acceptsInput-hasControl",
      "sand-47corl-pointer-events-none",
      "sand-computer-control-bar",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-computer-control-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Computer-control: Watching/Take control (acceptsInput+sand-47corl) on ${candidate.name} (bbn).`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
