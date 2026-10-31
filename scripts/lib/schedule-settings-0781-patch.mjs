// Settings → General → timezone (40Gx0U / TO/JdP, picker with Auto-detect pEb1UY
// writing overrideTimeZone:null) + spell-check (hzdQ0D / AQEPsg) rows, ported onto
// the 0.18 General section after the notification-sound section.
//
// Official evidence (rea-grokbot-0781): timezone panel `hr()` in
// chunk-general-pane-Bc92miZv.js @47,657 — card anchorId `timezone`, option list
// `[auto] + Intl.supportedValuesOf('timeZone')`, Auto-detect writes null
// (`onValueChange g=e=>{p(e),o(e===rr?null:e)}`); effective zone consumers read
// `overrideTimeZone ?? detectedTimeZone ?? "UTC"`. Spell-check panel `Cr()` @50,470 —
// card anchorId `spell-check`, boolean over `getSpellCheckEnabled` /
// `setSpellCheckEnabled({enabled})`; the applier lives main-process-side (Electron
// session spell checker), which this build wires in main-edge + startup.
// zh labels verbatim from the official zh pack `chunk-settings-BbrFWJId.js`.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const hash = (text) => createHash("sha256").update(text).digest("hex");

// After the notification-sound pass: Sa's `r` slot Fragment is
// [RLangSection, RHwAccelSection, RNotificationSoundSection].
const SLOT_BEFORE = "a.jsx(RHwAccelSection,{}),a.jsx(RNotificationSoundSection,{})]})";
const SLOT_AFTER = "a.jsx(RHwAccelSection,{}),a.jsx(RNotificationSoundSection,{}),a.jsx(RScheduleTimezoneSection,{}),a.jsx(RSpellCheckSection,{})]})";

const CHUNK_MARKER = "function RNotificationSoundSection(){";

const APPEND = `
/* grok-node schedule timezone + spell check (0.78.1 general settings rows) — labels from official i18n. */
function RScheduleSettingsLocale(){
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
var RScheduleTimezoneAuto="__auto__";
function RTimezoneOptions(detected){
  const autoLabel=(function(){var loc=RScheduleSettingsLocale();return loc==="zh-CN"?"自动检测":"Auto-detect"})();
  var options=[{value:RScheduleTimezoneAuto,label:detected?autoLabel+" ("+detected+")":autoLabel}];
  var zones;
  try{zones=Intl.supportedValuesOf("timeZone")}catch(_e){zones=[]}
  for(var i=0;i<zones.length;i++)options.push({value:zones[i],label:zones[i]});
  return options;
}
function RScheduleTimezoneSection(){
  const bridge=window.desktop&&window.desktop.timeZone;
  const[state,setState]=de.useState(function(){return {detected:null,override:null,loaded:false}});
  const[pending,setPending]=de.useState(false);
  de.useEffect(function(){
    let live=true;
    if(bridge==null||typeof bridge.get!=="function")return;
    bridge.get().then(function(v){
      if(live&&v&&typeof v==="object")setState({detected:v.detectedTimeZone??null,override:v.overrideTimeZone??null,loaded:true});
    }).catch(function(){});
    return function(){live=false};
  },[]);
  if(bridge==null||typeof bridge.setOverride!=="function")return null;
  const loc=RScheduleSettingsLocale();
  const title=loc==="zh-CN"?"时区":"Timezone";
  const titleDesc=loc==="zh-CN"?"设置 Grok Bot 用于日程和提醒的时区":"Set the time zone Grok Bot uses for schedules and reminders";
  const change=function(next){
    if(pending)return;
    setPending(true);
    setState(function(prev){return {...prev,override:next===RScheduleTimezoneAuto?null:next}});
    bridge.setOverride(next===RScheduleTimezoneAuto?null:next).catch(function(){}).then(function(){setPending(false)});
  };
  return a.jsx(re,{title:title,children:a.jsx(ie,{description:titleDesc,label:title,variant:"card",children:a.jsx(ye,{"aria-label":title,disabled:pending||!state.loaded,onValueChange:change,options:RTimezoneOptions(state.detected),placement:"bottom-end",size:"lg",value:state.override==null?RScheduleTimezoneAuto:state.override,variant:"filled"})})});
}
function RSpellCheckSection(){
  const bridge=window.desktop&&window.desktop.desktop0721;
  const[enabled,setEnabled]=de.useState(true);
  const[pending,setPending]=de.useState(false);
  de.useEffect(function(){
    let live=true;
    if(bridge==null||typeof bridge.getSpellCheckEnabled!=="function")return;
    bridge.getSpellCheckEnabled().then(function(v){if(live&&typeof v==="boolean")setEnabled(v)}).catch(function(){});
    return function(){live=false};
  },[]);
  if(bridge==null||typeof bridge.setSpellCheckEnabled!=="function")return null;
  const loc=RScheduleSettingsLocale();
  const title=loc==="zh-CN"?"输入时检查拼写":"Check Spelling While Typing";
  const titleDesc=loc==="zh-CN"?"输入时为拼写错误的单词加下划线":"Underline misspelled words as you type";
  const toggle=function(){
    if(pending)return;
    setPending(true);
    const next=!enabled;
    setEnabled(next);
    bridge.setSpellCheckEnabled({enabled:next}).catch(function(){}).then(function(){setPending(false)});
  };
  return a.jsx(re,{title:title,children:a.jsx(ie,{description:titleDesc,label:title,variant:"card",children:a.jsx(Ne,{isChecked:enabled===true,isDisabled:pending,label:title,onToggle:toggle})})});
}
`;

export function patchScheduleSettings0781(source) {
  if (source.includes("RScheduleTimezoneSection(")) {
    return { text: source, applied: false, reason: "already-present" };
  }
  if (!source.includes(CHUNK_MARKER)) return { text: source, applied: false, reason: "not-settings-chunk" };
  const occurrences = source.split(SLOT_BEFORE).length - 1;
  if (occurrences === 0) return { text: source, applied: false, reason: "anchor-missing" };
  if (occurrences > 1) return { text: source, applied: false, reason: `anchor-ambiguous:${occurrences}` };
  const patched = source.replace(SLOT_BEFORE, SLOT_AFTER) + APPEND;
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return { text: patched, applied: true };
}

export async function applyScheduleSettings0781Patch({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    const outcome = patchScheduleSettings0781(source);
    if (outcome.applied) {
      await writeFile(target, outcome.text);
      const record = {
        schemaVersion: 1,
        mode: "original-renderer-schedule-settings-0781",
        chunk: { path: `dist/renderer/assets/${name}`, bytes: Buffer.byteLength(outcome.text), sha256: hash(outcome.text) },
        evidence: {
          timezone: "Grok Bot 0.78.1 Settings → General → timezone row (40Gx0U/TO/JdP, auto → overrideTimeZone:null)",
          spellCheck: "Grok Bot 0.78.1 Settings → General → spell-check row (hzdQ0D/AQEPsg, desktop RPC get/setSpellCheckEnabled)",
        },
      };
      const provenancePath = path.join(stageRoot, "dist", "renderer-schedule-settings-extension.json");
      await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
      return { ...record, provenancePath };
    }
    if (outcome.reason !== "not-settings-chunk") return { reason: outcome.reason, applied: false };
  }
  return { reason: "no-candidate-chunk", applied: false };
}
