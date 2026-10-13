// 强调色 = Bot 颜色 — phase 2: the Settings → 通用 → Appearance (外观) row.
//
// Official 0.70.2 renders the accent row next to the theme row (settings component st():
// `z = m || f ? <le anchorId="accent"><Oe aria-label options={black|bot-color}
// onValueChange: U => setEnabled(U === "bot-color")} value={fn(p)} .../>` — a two-value
// dropdown whose UI enum collapses to the stored boolean). This pass reproduces exactly
// that row inside 0.18's Appearance section, reusing the section's OWN row component (ie),
// dropdown component (ye) and section wrapper (re) through shared module scope — the same
// discipline the injected main-bot sidebar follows: no authored styles, only the baseline's
// own kit.
//
// Language: 0.18's settings surface is English-native hardcoded ("Appearance", "Theme",
// "Follow System") and is NOT covered by the RLocT i18n passes (they only process the main
// chunk), so the row's labels are English too — "Accent", "Black", "Bot color" — matching
// both the surrounding settings surface and upstream's own English strings.
//
// Fail-closed: the anchor is pa()'s full return statement (byte-verified against the
// pristine chunk), must be unique, and the patched chunk must still parse. The row degrades
// to disabled (not absent) when the bridge is unreachable, so the settings surface never
// shows a dead control.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const hash = text => createHash("sha256").update(text).digest("hex");

// The Appearance section factory in 0.18's settings chunk, ending in its full return.
const ANCHOR_RETURN = `return s[2]!==n||s[3]!==e||s[4]!==d?(l=a.jsx(re,{title:"Appearance",children:a.jsx(ie,{label:"Theme",variant:"card",children:a.jsx(ye,{"aria-label":"Theme",disabled:n,onValueChange:d,options:ba,placement:"bottom-end",size:"lg",value:e,variant:"filled"})})}),s[2]=n,s[3]=e,s[4]=d,s[5]=l):l=s[5],l}`;
const REPLACEMENT = `return s[2]!==n||s[3]!==e||s[4]!==d?(l=a.jsxs(re,{title:"Appearance",children:[a.jsx(ie,{label:"Theme",variant:"card",children:a.jsx(ye,{"aria-label":"Theme",disabled:n,onValueChange:d,options:ba,placement:"bottom-end",size:"lg",value:e,variant:"filled"})}),a.jsx(RbcAccentRow,{})]}),s[2]=n,s[3]=e,s[4]=d,s[5]=l):l=s[5],l}`;

// Which lazy chunk owns the settings surface: identified by its palette table, not its
// content-hashed filename.
const CHUNK_MARKER = `const ha={system:"Follow System",light:"Light",dark:"Dark"}`;

const APPEND = `
/* grok-node bot-color settings row (强调色=Bot 颜色) — official 0.70.2 dropdown, English labels to match the 0.18 settings surface. */
const RBC_OPTIONS=[{value:"black",label:"Black"},{value:"bot-color",label:"Bot color"}];
function RbcAccentRow(){
  const[enabled,setEnabled]=de.useState(null);
  const[pending,setPending]=de.useState(false);
  de.useEffect(function(){
    let live=true;
    const read=function(){
      const bridge=window.desktop&&window.desktop.agent;
      if(bridge==null||typeof bridge.getBotColorInChat!=="function")return;
      bridge.getBotColorInChat().then(function(v){if(live)setEnabled(v===true)}).catch(function(){});
    };
    read();
    const timer=setInterval(read,2500);
    return function(){live=false;clearInterval(timer)};
  },[]);
  const change=function(u){
    if(u===null||pending)return;
    const bridge=window.desktop&&window.desktop.agent;
    if(bridge==null||typeof bridge.setBotColorInChat!=="function")return;
    setPending(true);
    bridge.setBotColorInChat(u==="bot-color").then(function(v){setEnabled(v===true)}).catch(function(){}).then(function(){setPending(false)});
  };
  return a.jsx(ie,{label:"Accent",variant:"card",children:a.jsx(ye,{"aria-label":"Accent",disabled:pending||enabled===null,onValueChange:change,options:RBC_OPTIONS,placement:"bottom-end",size:"lg",value:enabled===true?"bot-color":"black",variant:"filled"})});
}
`;

export function patchBotColorSettings(source) {
  if (source.includes("RbcAccentRow(")) return { text: source, applied: false, reason: "already-present" };
  const occurrences = source.split(ANCHOR_RETURN).length - 1;
  if (occurrences === 0) return { text: source, applied: false, reason: "anchor-missing" };
  if (occurrences > 1) return { text: source, applied: false, reason: `anchor-ambiguous:${occurrences}` };
  const patched = source.replace(ANCHOR_RETURN, REPLACEMENT) + APPEND;
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return { text: patched, applied: true, reason: "patched" };
}

export async function applyBotColorSettingsPatch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const files = (await readdir(assets)).filter(file => file.endsWith(".js"));
  const candidates = [];
  for (const file of files) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes(CHUNK_MARKER)) candidates.push({ file, source });
  }
  if (candidates.length !== 1) throw new Error(`Bot-color settings patch: expected exactly one settings chunk carrying the theme palette, found ${candidates.length}.`);
  const { file, source } = candidates[0];
  const result = patchBotColorSettings(source);
  if (!result.applied) {
    console.log(`Bot-color settings row: skipped (${result.reason})`);
    return { mode: "bot-color-settings", applied: false, reason: result.reason };
  }
  await writeFile(path.join(assets, file), result.text);
  console.log(`Bot-color settings row: accent dropdown added to the Appearance section of ${file}`);
  const provenance = {
    mode: "bot-color-settings-row",
    evidence: "Grok Bot 0.70.2 settings accent row (black|bot-color dropdown storing a boolean)",
    file,
    files: [{ file, originalSha256: hash(source), patchedSha256: hash(result.text) }],
  };
  await writeFile(path.join(stageRoot, "dist", "renderer-bot-color-settings-extension.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
