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
// isInteractive:!0, gate with acceptsInput + sand-47corl + tabIndex +
// webview.send("sand:vnc-accepts-input") so preload gates IME/clipboard/Mac keys.
//
// Visual (kn / footer / hint) — separate from the gate, same patch file:
//   portal bar into sand-computer-stage as 52px chrome footer (official flex child);
//   kn pill classes; computer-watch-hint only after Watching click (2500ms);
//   stage frame width min(100cqw, calc((100cqh - 52px) * 1920 / 1200)).
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
// Default acceptsInput=false (view-only) when the prop is omitted — matches official
// preload boot and keeps preview tiles from advertising control they do not have.
const DAE_DESTRUCTURE_AFTER =
  "{src:r,className:i,isInteractive:o,acceptsInput:RAcceptsInput,onReadyChange:l,onConnectedChange:c,onCrashedChange:u,onHostKey:d,isViewerVisible:m,openedAtMs:f}=e,h=o===void 0?!1:o,RAccepts=RAcceptsInput===void 0?!1:RAcceptsInput";

// Mirror G8n/obn (viewer-visible): host → webview.send("sand:vnc-accepts-input", bool).
// Must land AFTER the full `const G8n=…,W8n=…,K8n=…;` statement — splicing into the
// declarator list leaves `function RVncAcceptsSend` mid-const and fails parse.
const VNC_ACCEPTS_HELPER_BEFORE = 'const G8n="sand:vnc-viewer-visible",W8n=1280,K8n=800;';
const VNC_ACCEPTS_HELPER_AFTER =
  'const G8n="sand:vnc-viewer-visible",W8n=1280,K8n=800;'
  + 'const RVncAcceptsCh="sand:vnc-accepts-input";'
  + "function RVncAcceptsSend(n,e){const t=n.send?.(RVncAcceptsCh,e);t!=null&&jAe(t)}";

// Sync accepts-input whenever the effect re-runs (dom-ready / take-control / stop).
const VNC_ACCEPTS_SYNC_BEFORE = "z=()=>{m==null||!q.isReady||obn(_,m)}";
const VNC_ACCEPTS_SYNC_AFTER =
  "z=()=>{m==null||!q.isReady||obn(_,m);q.isReady&&RVncAcceptsSend(_,!!RAccepts)}";

// he.c(26) leaves s[18]..s[25] free; pin RAccepts on s[18] so take/stop re-runs the effect.
const VNC_ACCEPTS_DEPS_BEFORE =
  "s[0]!==y||s[1]!==h||s[2]!==m||s[3]!==c||s[4]!==u||s[5]!==d||s[6]!==l||s[7]!==f||s[8]!==r?(k=_=>{";
const VNC_ACCEPTS_DEPS_AFTER =
  "s[0]!==y||s[1]!==h||s[2]!==m||s[3]!==c||s[4]!==u||s[5]!==d||s[6]!==l||s[7]!==f||s[8]!==r||s[18]!==RAccepts?(k=_=>{";
const VNC_ACCEPTS_DEPS_ASSIGN_BEFORE =
  "s[0]=y,s[1]=h,s[2]=m,s[3]=c,s[4]=u,s[5]=d,s[6]=l,s[7]=f,s[8]=r,s[9]=k):k=s[9];";
const VNC_ACCEPTS_DEPS_ASSIGN_AFTER =
  "s[0]=y,s[1]=h,s[2]=m,s[3]=c,s[4]=u,s[5]=d,s[6]=l,s[7]=f,s[8]=r,s[18]=RAccepts,s[9]=k):k=s[9];";

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
// Official kn pill + 52px stage footer + click-hint. No String.raw backticks (parse hazard).
const COMPONENT_SOURCE = [
  "function RComputerControlBar(n){",
  "const{hasControl:e,onTakeControl:t,onStopControl:s}=n;",
  "const[host,setHost]=S.useState(null);",
  "const[hintOn,setHintOn]=S.useState(!1);",
  "const hasControlRef=S.useRef(e);",
  "const hintTimerRef=S.useRef(null);",
  "hasControlRef.current=e;",
  "S.useEffect(function(){if(e){setHintOn(!1);if(hintTimerRef.current){clearTimeout(hintTimerRef.current);hintTimerRef.current=null}}},[e]);",
  "S.useEffect(function(){",
  'if(!document.getElementById("rcompctl-style")){const st=document.createElement("style");st.id="rcompctl-style";',
  'st.textContent=".rcompctl-footer{height:52px;background-color:var(--cursor-chrome);flex-shrink:0;display:flex;align-items:center;width:100%;box-sizing:border-box;padding-inline:12px;}.rcompctl-bar{border-color:color-mix(in srgb,var(--sand-text-on-primary) 28%,transparent);flex:1;min-width:0;}";',
  "document.head.appendChild(st)}",
  // Footer mounts on stage alone; frame (VNC) often arrives after the placeholder
  // phase — requiring both made attach() exhaust 60×50ms and leave the bar absent.
  "let cancelled=!1,stage=null,frame=null,footer=null,prevW=\"\",prevAR=\"\",timer=null,obs=null,frameBound=!1;",
  'const STAGE_W="min(100cqw, calc((100cqh - 52px) * 1920 / 1200))";',
  'const STAGE_AR="1920 / 1200";',
  "function onFramePointerDown(){",
  "if(hasControlRef.current)return;",
  "setHintOn(!0);",
  "if(hintTimerRef.current)clearTimeout(hintTimerRef.current);",
  "hintTimerRef.current=setTimeout(function(){setHintOn(!1);hintTimerRef.current=null},2500)",
  "}",
  "function bindFrame(next){",
  "if(!next||frameBound&&frame===next)return;",
  "if(frame&&frame!==next){frame.removeEventListener(\"pointerdown\",onFramePointerDown);frame.style.width=prevW;frame.style.aspectRatio=prevAR}",
  "frame=next;prevW=frame.style.width;prevAR=frame.style.aspectRatio;",
  "frame.style.width=STAGE_W;frame.style.aspectRatio=STAGE_AR;",
  'frame.addEventListener("pointerdown",onFramePointerDown);',
  "frameBound=!0;",
  // Official stage children order is [frame, footer] (chunk-box-desktop-modal kn mount).
  // Early attach during placeholder can leave footer first after React swaps the frame in.
  "ensureFooterLast()",
  "}",
  "function ensureFooterLast(){",
  "if(!stage||!footer)return;",
  "if(stage.lastElementChild!==footer)stage.appendChild(footer)",
  "}",
  "function attach(){",
  'const box=document.querySelector(".sand-computer-fullscreen");',
  "if(!box)return!1;",
  'stage=box.querySelector(".sand-computer-stage");',
  "if(!stage)return!1;",
  'stage.classList.add("sand-dt5ytf");',
  'footer=stage.querySelector(":scope > .rcompctl-footer");',
  "if(!footer){",
  'footer=document.createElement("div");',
  // Match official footer recipe: 52px + chrome fill (0.71 sand-1qj4qm9 / --sand-bg-chrome;
  // 0.18 has no that class/token — --cursor-chrome is the local chrome fill).
  'footer.className="rcompctl-footer sand-78zum5 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-h8yej3 sand-dd8jsf";',
  "stage.appendChild(footer)}",
  "ensureFooterLast();",
  'bindFrame(box.querySelector(".sand-computer-stage__frame"));',
  "if(!cancelled)setHost(footer);",
  "return!0",
  "}",
  "function tick(){",
  "if(cancelled)return;",
  "if(!attach()){timer=setTimeout(tick,50);return}",
  "obs=new MutationObserver(function(){",
  "if(cancelled)return;",
  'bindFrame(stage&&stage.querySelector(".sand-computer-stage__frame"));',
  "ensureFooterLast()",
  "});",
  "obs.observe(stage,{childList:!0,subtree:!1});",
  "ensureFooterLast()",
  "}",
  "tick();",
  "return function(){",
  "cancelled=!0;if(timer)clearTimeout(timer);if(obs)obs.disconnect();",
  "if(hintTimerRef.current)clearTimeout(hintTimerRef.current);",
  'if(frame)frame.removeEventListener("pointerdown",onFramePointerDown);',
  "if(footer)footer.remove();",
  'if(stage)stage.classList.remove("sand-dt5ytf");',
  "if(frame){frame.style.width=prevW;frame.style.aspectRatio=prevAR}",
  "setHost(null)",
  "}",
  "},[]);",
  'const status=e?(RLocT("You\'re in control","你正在控制")):(RLocT("Watching","仅观看"));',
  'const hint=(!e&&hintOn)?p.jsx("span",{className:"ui-11wthnw ui-1ja60sm ui-vu1jfw sand-1o0liin sand-uxw1ft",children:(RLocT("Take control to click and type","取得控制权后即可点击和输入"))}):null;',
  'const btn=e?p.jsx(As,{onClick:function(){setHintOn(!1);s()},size:"sm",type:"button",variant:"secondary",children:(RLocT("Stop","停止"))}):p.jsx(As,{onClick:function(){setHintOn(!1);t()},size:"sm",type:"button",variant:"primary",children:(RLocT("Take control","取得控制权"))});',
  'const bar=p.jsxs("div",{"aria-label":(RLocT("Computer control","电脑控制")),className:"sand-computer-control-bar rcompctl-bar sand-1n2onr6 sand-9f619 sand-3nfvp2 sand-2lah0s sand-6s0dn4 sand-883omv sand-c9qbxq sand-exx8yu sand-18d9i69 sand-1g0dm76 sand-qjedn3 sand-1y0btm7 sand-149ho13 sand-10e981r sand-1z0g938 sand-tyxrsu sand-uxw1ft sand-qrzla8",role:"status",style:{justifyContent:"space-between",alignItems:"center",paddingInline:"12px"},children:[p.jsxs("span",{"aria-live":"polite",className:"sand-3nfvp2 sand-6s0dn4 sand-17d4w8g sand-1o0liin"+(e?" sand-tyxrsu":""),style:{alignItems:"center"},children:[p.jsx(bt,{name:e?"window-pointer-arrow":"eye",size:"sm","aria-hidden":!0}),status,hint]}),p.jsx("span",{className:"sand-1n2onr6 sand-3nfvp2",children:btn})]});',
  "if(host==null)return null;",
  "return Wr.createPortal(bar,host)",
  "}",
].join("");

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
  patched = replaceExactlyOnce(patched, VNC_ACCEPTS_HELPER_BEFORE, VNC_ACCEPTS_HELPER_AFTER, "webview accepts-input helper");
  patched = replaceExactlyOnce(patched, VNC_ACCEPTS_SYNC_BEFORE, VNC_ACCEPTS_SYNC_AFTER, "webview accepts-input sync");
  patched = replaceExactlyOnce(patched, VNC_ACCEPTS_DEPS_BEFORE, VNC_ACCEPTS_DEPS_AFTER, "DAe effect deps include acceptsInput");
  patched = replaceExactlyOnce(patched, VNC_ACCEPTS_DEPS_ASSIGN_BEFORE, VNC_ACCEPTS_DEPS_ASSIGN_AFTER, "DAe effect deps assign acceptsInput");
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
  if (!patched.includes('RVncAcceptsCh="sand:vnc-accepts-input"') || !patched.includes("RVncAcceptsSend(_,!!RAccepts)")) {
    throw new Error("computer-control missing sand:vnc-accepts-input webview.send bridge.");
  }
  if (!patched.includes("s[18]!==RAccepts") || !patched.includes("s[18]=RAccepts")) {
    throw new Error("computer-control must re-run DAe effect when acceptsInput flips.");
  }
  if (patched.includes("isInteractive:RHasControl")) {
    throw new Error("computer-control must not toggle isInteractive (remounts URL; does not block RFB).");
  }
  if (!patched.includes("isInteractive:!0,acceptsInput:RHasControl")) {
    throw new Error("computer-control must keep isInteractive:!0 with acceptsInput gate.");
  }
  if (!patched.includes("Wr.createPortal(bar,host)")) {
    throw new Error("computer-control kn bar must portal into the stage footer host.");
  }
  if (!patched.includes("rcompctl-footer") || !patched.includes('STAGE_W="min(100cqw, calc((100cqh - 52px) * 1920 / 1200))"')) {
    throw new Error("computer-control missing official 52px stage footer / frame width recipe.");
  }
  if (!patched.includes(",2500)") || !patched.includes("onFramePointerDown")) {
    throw new Error("computer-control missing computer-watch-hint (2500ms on Watching click).");
  }
  if (!patched.includes("if(!stage)return!1;") || patched.includes("if(!stage||!frame)return!1;")) {
    throw new Error("computer-control footer must attach on stage without waiting for the VNC frame.");
  }
  if (!patched.includes("new MutationObserver") || !patched.includes("function bindFrame(")) {
    throw new Error("computer-control must observe late VNC frame mount for STAGE_W / watch-hint.");
  }
  if (!patched.includes("function ensureFooterLast(") || !patched.includes("stage.lastElementChild!==footer")) {
    throw new Error("computer-control footer must stay after the frame (official [frame, footer] order).");
  }
  if (patched.includes('opacity:.75,fontSize:"12px"') && patched.includes("Take control to click and type")) {
    // Old always-visible hint styling — official only flashes after a Watching click.
    throw new Error("computer-control must not keep the always-visible Watching hint.");
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
      gate: "acceptsInput + sand-47corl + sand:vnc-accepts-input webview.send (keep isInteractive:!0)",
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
      "sand-vnc-accepts-input-webview-send",
      "sand-computer-control-bar",
      "kn-footer-portal-52px",
      "computer-watch-hint-2500ms",
      "stage-frame-1920x1200-recipe",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-computer-control-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Computer-control: Watching/Take control + kn/footer/hint on ${candidate.name} (bbn).`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
