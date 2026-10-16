// Settings → General → hardware acceleration toggle + "Restart to Apply".
//
// Evidence: Grok Bot 0.71.2 chunk-view-CnDIh4nG.js `ut()` — toggle card
// (`anchorId:"hardware-acceleration"`, Ne/Re switch) plus a restart card when
// `enabled !== enabledAtLaunch` (`anchorId:"hardware-acceleration-restart"`).
// i18n: gkVAUt / uGmpY+ / ZFmUzi / jZlVjK / u6QeR6 (zh in chunk-settings-B31Ra5H2.js).
//
// 0.18's settings surface is English-native (same as Language / bot-color rows) and
// is not covered by main-chunk RLocT passes, so labels are bilingual inline like
// `language-renderer-patch.mjs`. The toggle reuses the chunk's own `Ne` switch and
// `oe` primary button; the section uses `re`/`ie` like Appearance / Auto-review.
//
// Placement: after Language in Sa()'s `r` slot (Fragment). Fail-closed if the
// language-patched Sa anchor is missing or ambiguous.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const hash = (text) => createHash("sha256").update(text).digest("hex");

// After language-renderer-patch: Sa mounts RLangSection in slot `r`.
const SA_LANG_SLOT = "r=a.jsx(RLangSection,{})";
const SA_LANG_PLUS_HW = "r=a.jsxs(a.Fragment,{children:[a.jsx(RLangSection,{}),a.jsx(RHwAccelSection,{})]})";

const CHUNK_MARKER = `const ha={system:"Follow System",light:"Light",dark:"Dark"}`;

const APPEND = `
/* grok-node hardware acceleration (0.71.2 general setting) — bilingual labels from official i18n. */
function RHwAccelLocale(){
  try{
    const tags=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];
    for(const raw of tags){
      const tag=String(raw||"").trim().toLowerCase();
      if(tag==="zh"||tag.indexOf("zh-")===0)return "zh-CN";
      if(tag==="en"||tag.indexOf("en-")===0)return "en";
    }
  }catch(_e){}
  return "en";
}
function RHwAccelSection(){
  const loc=RHwAccelLocale();
  const title=loc==="zh-CN"?"使用硬件加速":"Use hardware acceleration";
  const description=loc==="zh-CN"?"让显卡来绘制应用；如果窗口闪烁或一直空白，请关闭此选项":"Let your graphics card draw the app, or turn it off if the window flickers or stays blank";
  const restartLabel=loc==="zh-CN"?"重启以应用":"Restart to Apply";
  const restartNow=loc==="zh-CN"?"立即重启":"Restart Now";
  const restartNote=loc==="zh-CN"?"硬件加速的更改将在 Grok Bot 重启后生效":"Hardware acceleration changes take effect after Grok Bot restarts";
  const[snapshot,setSnapshot]=de.useState(null);
  const[pending,setPending]=de.useState(false);
  const[relaunching,setRelaunching]=de.useState(false);
  de.useEffect(function(){
    let live=true;
    const read=function(){
      const bridge=window.desktop&&window.desktop.agent;
      if(bridge==null||typeof bridge.getHardwareAcceleration!=="function")return;
      bridge.getHardwareAcceleration().then(function(v){if(live&&v&&typeof v.enabled==="boolean")setSnapshot(v)}).catch(function(){});
    };
    read();
    const timer=setInterval(read,2500);
    return function(){live=false;clearInterval(timer)};
  },[]);
  const toggle=function(){
    if(snapshot==null||pending)return;
    const bridge=window.desktop&&window.desktop.agent;
    if(bridge==null||typeof bridge.setHardwareAccelerationEnabled!=="function")return;
    setPending(true);
    bridge.setHardwareAccelerationEnabled(!snapshot.enabled).then(function(v){if(v&&typeof v.enabled==="boolean")setSnapshot(v)}).catch(function(){}).then(function(){setPending(false)});
  };
  const relaunch=function(){
    if(relaunching)return;
    const bridge=window.desktop&&window.desktop.agent;
    if(bridge==null||typeof bridge.relaunchDesktop!=="function")return;
    setRelaunching(true);
    bridge.relaunchDesktop().catch(function(){setRelaunching(false)});
  };
  const needsRestart=snapshot!=null&&snapshot.enabled!==snapshot.enabledAtLaunch;
  return a.jsxs(re,{title:title,children:[
    a.jsx(ie,{description:description,label:title,variant:"card",children:a.jsx(Ne,{isChecked:snapshot!=null&&snapshot.enabled===true,isDisabled:pending||snapshot===null,label:title,onToggle:toggle})}),
    needsRestart?a.jsx(ie,{description:restartNote,label:restartLabel,variant:"card",children:a.jsx(oe,{disabled:relaunching,onClick:relaunch,sentiment:"accent",size:"md",type:"button",variant:"primary",children:restartNow})}):null
  ]});
}
`;

export function patchHardwareAccelerationSettings(source) {
  if (source.includes("RHwAccelSection(")) return { text: source, applied: false, reason: "already-present" };
  if (!source.includes(CHUNK_MARKER)) return { text: source, applied: false, reason: "not-settings-chunk" };
  const occurrences = source.split(SA_LANG_SLOT).length - 1;
  if (occurrences === 0) return { text: source, applied: false, reason: "anchor-missing" };
  if (occurrences > 1) return { text: source, applied: false, reason: `anchor-ambiguous:${occurrences}` };
  const patched = source.replace(SA_LANG_SLOT, SA_LANG_PLUS_HW) + APPEND;
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return { text: patched, applied: true, reason: "patched" };
}

export async function applyHardwareAccelerationSettingsPatch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const files = (await readdir(assets)).filter((file) => file.endsWith(".js"));
  const candidates = [];
  for (const file of files) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes(CHUNK_MARKER) && source.includes(SA_LANG_SLOT)) candidates.push({ file, source });
  }
  if (candidates.length === 0) {
    // Language patch may not have landed; fail closed with a clear skip reason for the report.
    console.log("Hardware-acceleration settings: skipped (anchor-missing — Language Sa slot not present)");
    return { mode: "hardware-acceleration-settings", applied: false, reason: "anchor-missing" };
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Hardware-acceleration settings patch: expected exactly one settings chunk with the Language Sa slot, found ${candidates.length}.`,
    );
  }
  const { file, source } = candidates[0];
  const result = patchHardwareAccelerationSettings(source);
  if (!result.applied) {
    console.log(`Hardware-acceleration settings: skipped (${result.reason})`);
    return { mode: "hardware-acceleration-settings", applied: false, reason: result.reason };
  }
  await writeFile(path.join(assets, file), result.text);
  console.log(`Hardware-acceleration settings: toggle + restart added to General of ${file}`);
  const provenance = {
    mode: "hardware-acceleration-settings",
    evidence: "Grok Bot 0.71.2 hardware-acceleration / hardware-acceleration-restart under general (gkVAUt, uGmpY+, ZFmUzi, jZlVjK, u6QeR6)",
    file,
    files: [{ file, originalSha256: hash(source), patchedSha256: hash(result.text) }],
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-hardware-acceleration-settings-extension.json"),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  return provenance;
}
