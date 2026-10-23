// Settings → Updates, ported from the official Grok Bot 0.75.3 update pane
// (`chunk-view-DROqRPMJ.js`): Automatic Updates + Version/status row, with the
// update-track row hidden because the reconstructed GitHub feed has one track.
// The component uses the 0.18 settings kit already in the chunk (SettingsGroup,
// SettingsRow, Button, Switch) and the existing update controller hooks.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const hash = text => createHash("sha256").update(text).digest("hex");

const PANEL_MARKERS = ["Update Track", "Grok Bot Updates", "Check for Updates"];

const REPLACEMENT = `function MA_PLACEHOLDER(){
  const {status:e,isLoading:t}=us();
  const {check:n,isPending:d}=ms();
  const {setTrack:l,isPending:r}=fs();
  const {setAutoUpdateWhenIdleOptIn:i,isPending:o}=hs();
  const {quitAndInstall:c}=bs();
  const f=ps();
  const {externalLinkHandlers:h}=Fe();
  const m=ys(),u=gs(),p=vs(),b=xs();
  const {setEnabled:y,isPending:j}=ks();
  const v=m&&u;
  let E;
  if(p){E=ca(b)}else if(v){E="Route web traffic from Grok Bot's computer out through this desktop instead of the cloud. Applies to new connections."}else{E="Grok Bot's computer wasn't provisioned with the egress tunnel — start a new one to use this."}
  const C=(m||p)?a.jsx(re,{title:"Egress",children:a.jsx(ie,{description:E,label:"Route egress through this desktop",variant:"card",children:a.jsx(Ne,{isChecked:p,isDisabled:j||!v&&!p,label:"Route egress through this desktop",onToggle:()=>y(!p)})})}):null;
  if(e==null){
    const msg=t?RLocT("Loading update status…","正在加载更新状态…"):RLocT("Grok Bot couldn't load update status. Check again to retry.","Grok Bot 无法加载更新状态。请再次检查以重试。");
    const btn=a.jsx(oe,{disabled:t,onClick:()=>n(),shape:"rectangular",size:"md",style:[ke.body2,pe.checkWeakBorder],variant:"secondary",children:RLocT("Check for Updates","检查更新")});
    return a.jsxs(a.Fragment,{children:[C,a.jsx(re,{title:RLocT("Grok Bot Updates","Grok Bot 更新"),children:a.jsx(ie,{description:msg,label:RLocT("Grok Bot Updates","Grok Bot 更新"),variant:"card",children:btn})})]});
  }
  const st=e.state;
  const I=st.type==="disabled";
  const M=st.type==="checking";
  const P=M||st.type==="available"||st.type==="downloading"||st.type==="staging";
  const ready=st.type==="ready";
  const status=RCompUpdateStatusText(e);
  const checkLabel=t||d||M?RLocT("Checking…","检查中…"):RLocT("Check for Updates","检查更新");
  const autoRow=a.jsx(ie,{description:RLocT("Automatically update your client while you're away.","在你离开时自动更新客户端。"),label:RLocT("Automatic Updates","自动更新"),variant:"card",children:a.jsx(Ne,{isChecked:e.autoUpdateWhenIdleOptIn,isDisabled:I||o,label:RLocT("Automatic Updates","自动更新"),onToggle:()=>i(!e.autoUpdateWhenIdleOptIn)})});
  const versionLabel=RLocT("Version ","版本 ")+e.currentVersion;
  const extra=a.jsx("a",{href:"https://github.com/tyonger-stack/GrokNode/releases",rel:"noopener noreferrer",target:"_blank",children:"GitHub Releases"});
  const action=ready?a.jsx(Ns,{onClick:()=>{we({surface:"settings",action:"clicked",kind:"ready",targetVersion:st.version});c()},size:"md",variant:"primary",children:RLocT("Restart to Update","更新并重启")}):a.jsx(oe,{disabled:I||P||d,onClick:()=>{we({surface:"settings",action:"clicked",kind:"check"});n()},shape:"rectangular",size:"md",style:[ke.body2,pe.checkWeakBorder],variant:"secondary",children:checkLabel});
  const versionRow=a.jsx(ie,{description:status,extraCopy:extra,label:versionLabel,variant:"card",children:action});
  const group=a.jsx(re,{title:RLocT("Grok Bot Updates","Grok Bot 更新"),children:[autoRow,versionRow]});
  return a.jsxs(a.Fragment,{children:[C,group]});
}
function RCompUpdateStatusText(s){
  const st=s.state;
  if(st.type==="disabled"){
    if(st.reason==="disabled-by-env")return RLocT("Updates are disabled by SAND_DISABLE_UPDATES","更新已被 SAND_DISABLE_UPDATES 停用");
    if(st.reason==="lab-build")return RLocT("Grok Bot Lab is a one-off test build and never auto-updates","Grok Bot Lab 是一次性测试构建，绝不会自动更新");
    if(st.reason==="not-packaged")return RLocT("Updates are disabled in dev builds","开发构建中已停用更新");
    return RLocT("Updates aren't available on this platform","此平台不支持更新");
  }
  if(st.type==="checking")return RLocT("Checking for updates…","正在检查更新…");
  if(st.type==="available")return RLocT("Grok Bot ","Grok Bot ")+st.version+RLocT(" is available"," 可用");
  if(st.type==="downloading")return RLocT("Downloading Grok Bot ","正在下载 Grok Bot ")+st.version+"…";
  if(st.type==="staging")return RLocT("Preparing Grok Bot ","正在准备 Grok Bot ")+st.version+"…";
  if(st.type==="ready")return RLocT("Grok Bot ","Grok Bot ")+st.version+RLocT(" is ready. Restart to apply."," 已就绪，重启以应用。");
  if(st.type==="idle"){
    const lc=st.lastCheck;
    if(lc==null)return "";
    if(lc.result==="up-to-date")return RLocT("You're up to date","已是最新版本");
    return RLocT("Update check failed: ","更新检查失败：")+(lc.errorMessage||RLocT("unknown error","未知错误"));
  }
  return "";
}
`;

function findPanel(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const found = [];
  for (const node of ast.body) {
    if (node.type !== "FunctionDeclaration" || node.id == null) continue;
    const body = source.slice(node.start, node.end);
    if (PANEL_MARKERS.every(marker => body.includes(marker))) found.push({ node, name: node.id.name });
  }
  return found;
}

export function patchSettingsUpdate0753(source) {
  if (source.includes("RCompUpdateStatusText(")) return { text: source, applied: false, reason: "already-present" };
  const candidates = findPanel(source);
  if (candidates.length !== 1) throw new Error(`Update panel patch: expected one settings panel, found ${candidates.length}.`);
  const { node, name } = candidates[0];
  const replacement = REPLACEMENT.replace("MA_PLACEHOLDER", name);
  let patched = source.slice(0, node.start) + replacement + source.slice(node.end);
  const computerCall = /,a\.jsx\(qs,\{[^{}]*\}\)/;
  if (!computerCall.test(patched)) throw new Error("Update panel patch: computer section call not found.");
  patched = patched.replace(computerCall, "");
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return { text: patched, applied: true, reason: "patched", name };
}

export async function applySettingsUpdate0753Patch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const files = (await readdir(assets)).filter(file => file.endsWith(".js"));
  const candidates = [];
  for (const file of files) {
    const source = await readFile(path.join(assets, file), "utf8");
    // The main renderer also carries the update-pill copy. The settings chunk is
    // the one that owns the Appearance section and the bot-color row.
    if (source.includes("function pa(){") && source.includes("RbcAccentRow(") && PANEL_MARKERS.every(marker => source.includes(marker))) candidates.push({ file, source });
  }
  if (candidates.length !== 1) throw new Error(`Update panel patch: expected one settings chunk, found ${candidates.length}.`);
  const { file, source } = candidates[0];
  const result = patchSettingsUpdate0753(source);
  if (!result.applied) { console.log(`Update panel: skipped (${result.reason})`); return { mode: "settings-update-0753", applied: false, reason: result.reason }; }
  await writeFile(path.join(assets, file), result.text);
  console.log(`Update panel: ported official 0.75.3 Automatic Updates + Version card (${file}).`);
  const provenance = {
    mode: "settings-update-0753",
    referenceVersion: "0.75.3",
    reference: "chunk-view-DROqRPMJ.js",
    file,
    files: [{ file, originalSha256: hash(source), patchedSha256: hash(result.text) }],
    features: ["automatic-updates-row", "version-status-check-row", "single-github-releases-track", "no-computer-section-in-updates"],
  };
  await writeFile(path.join(stageRoot, "dist", "renderer-settings-update-0753-extension.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
