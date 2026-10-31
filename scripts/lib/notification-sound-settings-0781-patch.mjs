// Settings → General → notification sound: official `notification-sound-enabled`
// (6EhUT7 / 0+TImd) + `notification-sound` (wm7RV4 / KXGrZy) rows, ported onto the
// 0.18 General section right after the hardware-acceleration section.
//
// Official evidence (rea-grokbot-0781): panel `kr()` in chunk-general-pane-Bc92miZv.js
// @61,016 — toggle card anchorId `notification-sound-enabled` (switch `SD`), dropdown
// card anchorId `notification-sound` (select `Iv`, options from `$$t`, instant preview
// on selection, disabled when sound is off). Persistence is the structured desktop
// preference `{playSound, sound:"ping-N-*"}` over `get/setDesktopNotificationPreferences`
// — the exact bridge our 0.72.1 port already ships (preload desktop0721).
// zh labels verbatim from the official zh pack `chunk-settings-BbrFWJId.js`.
//
// Notification playback: official main emits a `notification-sound` event and the
// renderer plays the wav (eager-app `r1t`); this build wires the same event name over
// `desktop0721.onNotificationSound` (preload subscribe) and plays through the staged
// renderer assets next to this chunk. Sound selection preview plays locally the same way.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { NOTIFICATION_SOUNDS_0781 } from "./notification-sounds-0781.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");

// After the hardware-acceleration pass: Sa's `r` slot is a Fragment of
// [RLangSection, RHwAccelSection]; this pass appends RNotificationSoundSection.
const SLOT_BEFORE = "a.jsxs(a.Fragment,{children:[a.jsx(RLangSection,{}),a.jsx(RHwAccelSection,{})]})";
const SLOT_AFTER = "a.jsxs(a.Fragment,{children:[a.jsx(RLangSection,{}),a.jsx(RHwAccelSection,{}),a.jsx(RNotificationSoundSection,{})]})";

const CHUNK_MARKER = "function RHwAccelSection(){";

const SOUND_TABLE = NOTIFICATION_SOUNDS_0781.map((sound) =>
  `{id:${JSON.stringify(sound.id)},file:${JSON.stringify(sound.file)},en:${JSON.stringify(sound.en)},zh:${JSON.stringify(sound.zh)}}`,
).join(",");

const APPEND = `
/* grok-node notification sound (0.78.1 notification-sound rows) — labels from official i18n. */
function RNotificationSoundLocale(){
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
var RNotificationSounds=[${SOUND_TABLE}];
var RNotificationAudio=null;
function RNotificationSoundPlay(id){
  try{
    const entry=RNotificationSounds.find(function(s){return s.id===id});
    if(entry==null)return;
    if(RNotificationAudio!=null){RNotificationAudio.pause()}
    RNotificationAudio=new Audio(new URL(entry.file,import.meta.url).href);
    RNotificationAudio.play().catch(function(){});
  }catch(_e){}
}
function RNotificationSoundSection(){
  const bridge=window.desktop&&window.desktop.desktop0721;
  const[ state,setState]=de.useState(function(){return {playSound:false,sound:"ping-1-open-blip",loaded:false}});
  const[pending,setPending]=de.useState(false);
  de.useEffect(function(){
    let live=true;
    if(bridge==null||typeof bridge.getDesktopNotificationPreferences!=="function")return;
    bridge.getDesktopNotificationPreferences().then(function(v){
      if(live&&v&&typeof v.playSound==="boolean"&&typeof v.sound==="string")setState({playSound:v.playSound,sound:v.sound,loaded:true});
    }).catch(function(){});
    if(bridge==null||typeof bridge.onNotificationSound!=="function")return;
    const off=bridge.onNotificationSound(function(id){RNotificationSoundPlay(id)});
    return function(){live=false;if(typeof off==="function")off()};
  },[]);
  if(bridge==null||typeof bridge.setDesktopNotificationPreferences!=="function")return null;
  const loc=RNotificationSoundLocale();
  const title=loc==="zh-CN"?"为通知播放声音":"Play Sound for Notifications";
  const titleDesc=loc==="zh-CN"?"开启或关闭 Grok Bot 给你发消息时播放的声音":"Turn the sound that plays when Grok Bot sends you a message on or off";
  const pickTitle=loc==="zh-CN"?"通知声音":"Notification Sound";
  const pickDesc=loc==="zh-CN"?"选择 Grok Bot 给你发消息时播放的声音":"Pick the sound that plays when Grok Bot sends you a message";
  const save=function(next){
    if(pending)return;
    setPending(true);
    setState(function(prev){return {...prev,...next}});
    bridge.setDesktopNotificationPreferences({preferences:{playSound:next.playSound===true,sound:next.sound}}).catch(function(){}).then(function(){setPending(false)});
  };
  const options=RNotificationSounds.map(function(s){return {value:s.id,label:loc==="zh-CN"?s.zh:s.en}});
  return a.jsxs(re,{title:title,children:[
    a.jsx(ie,{description:titleDesc,label:title,variant:"card",children:a.jsx(Ne,{isChecked:state.playSound===true,isDisabled:pending||!state.loaded,label:title,onToggle:function(){save({playSound:!state.playSound,sound:state.sound})}})}),
    a.jsx(ie,{description:pickDesc,label:pickTitle,variant:"card",children:a.jsx(ye,{"aria-label":pickTitle,disabled:pending||state.playSound!==true,onValueChange:function(v){if(v!=null){save({playSound:state.playSound===true,sound:v});RNotificationSoundPlay(v)}},options:options,placement:"bottom-end",size:"lg",value:state.sound,variant:"filled"})})
  ]});
}
`;

export function patchNotificationSoundSettings0781(source) {
  if (source.includes("RNotificationSoundSection(")) {
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

export async function applyNotificationSoundSettingsPatch({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    const outcome = patchNotificationSoundSettings0781(source);
    if (outcome.applied) {
      await writeFile(target, outcome.text);
      const record = {
        schemaVersion: 1,
        mode: "original-renderer-notification-sound-0781",
        chunk: { path: `dist/renderer/assets/${name}`, bytes: Buffer.byteLength(outcome.text), sha256: hash(outcome.text) },
        sounds: NOTIFICATION_SOUNDS_0781.map(({ id, file, sha256 }) => ({ id, file, sha256 })),
        evidence: { upstream: "Grok Bot 0.78.1 Settings → General → notification sound rows (6EhUT7/0+TImd/wm7RV4/KXGrZy)" },
      };
      const provenancePath = path.join(stageRoot, "dist", "renderer-notification-sound-settings-extension.json");
      await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
      return { ...record, provenancePath };
    }
    if (outcome.reason !== "not-settings-chunk") return { reason: outcome.reason, applied: false };
  }
  return { reason: "no-candidate-chunk", applied: false };
}
