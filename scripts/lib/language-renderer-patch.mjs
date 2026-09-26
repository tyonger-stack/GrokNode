import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// The Settings → General → Appearance section in the upstream renderer only
// renders the Theme selector. Grok Node extends the same section with a
// Language preference that follows system / English / Simplified Chinese,
// backed by `sand:language-get-sync` (preload exposes `window.desktop.language`).
//
// This patch is intentionally narrow:
//   * `PA_ANCHOR`  — `function pa(){` immediately precedes the existing Theme
//                    render block; we insert a self-contained `RLangSection`
//                    component above it so the upstream React Compiler slot
//                    cache (`H.c(6)`) is not touched.
//   * `SA_SLOT_BEFORE` / `SA_SLOT_AFTER` — the second slot (`r`) inside the
//                    Settings → General `Sa()` function was rendered as
//                    `null` to make room for a future Security Key section;
//                    we fill it with `<RLangSection/>` instead so the
//                    Language picker appears under Appearance.

const PA_ANCHOR = "function pa(){";
const SA_SLOT_BEFORE = "l=a.jsx(pa,{}),r=null,i=a.jsx(oa,{}),o=a.jsx(va,{})";
const SA_SLOT_AFTER = "l=a.jsx(pa,{}),r=a.jsx(RLangSection,{}),i=a.jsx(oa,{}),o=a.jsx(va,{})";

// Labels follow Grok Bot 0.58's Settings → General → Language row: the row
// title and the "Follow System" option localise with the resolved locale
// (0.58 chunk-settings catalog: vXIe7J "Language"/"语言",
// Ea4oxV "Follow System"/"跟随系统"), while the explicit locales keep their
// endonyms ("English" / "简体中文") in both locales. Only en + zh-CN ship,
// so the resolver below mirrors `resolveSystemLocale` for those two tags.

const LANG_SECTION_SOURCE = String.raw`
function RLangLocale(pref){
  if(pref==="zh-CN")return "zh-CN";
  if(pref==="en")return "en";
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
function RLangSection(){
  const s=window.desktop?.language;
  const[e,t]=de.useState(()=>s?.initial?.preference??"follow-system");
  const[n,r]=de.useState(false);
  de.useEffect(()=>{
    if(!s||typeof s.onChanged!=="function")return;
    const i=state=>{t(state?.preference??e);r(false)};
    return s.onChanged(i);
  },[s]);
  if(!s)return null;
  const handleChange=async next=>{
    if(n)return;
    r(true);
    try{const state=await s.set(next);t(state?.preference??next)}catch(_e){}r(false)
  };
  const loc=RLangLocale(e);
  const title=loc==="zh-CN"?"语言":"Language";
  const followLabel=loc==="zh-CN"?"跟随系统":"Follow System";
  const options=[
    {value:"follow-system",label:followLabel},
    {value:"en",label:"English"},
    {value:"zh-CN",label:"简体中文"}
  ];
  return a.jsx(re,{title:title,children:a.jsx(ie,{label:title,variant:"card",children:a.jsx(ye,{"aria-label":title,disabled:n,onValueChange:handleChange,options,placement:"bottom-end",size:"lg",value:e,variant:"filled"})})});
}
`;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Original renderer ${label} anchor is missing.`);
  if (source.indexOf(before, first + 1) >= 0) throw new Error(`Original renderer ${label} anchor is ambiguous.`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalLanguagePanel(source) {
  let patched = replaceExactlyOnce(source, PA_ANCHOR, `${LANG_SECTION_SOURCE}${PA_ANCHOR}`, "Language section insertion");
  patched = replaceExactlyOnce(patched, SA_SLOT_BEFORE, SA_SLOT_AFTER, "Sa language slot");
  return patched;
}

export async function applyOriginalRendererLanguagePatch({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(PA_ANCHOR) && source.includes(SA_SLOT_BEFORE)) {
      candidates.push({ name, target, source });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one original Settings panel chunk for Language patch, found ${candidates.length}.`);
  }
  const candidate = candidates[0];
  const patched = patchOriginalLanguagePanel(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-language-extension",
    chunks: [{
      role: "panel",
      path: `dist/renderer/assets/${candidate.name}`,
      original: { bytes: Buffer.byteLength(candidate.source), sha256: sha256(candidate.source) },
      patched: { bytes: Buffer.byteLength(patched), sha256: sha256(patched) },
    }],
    features: ["settings-general-language"],
    transformations: ["language-section-insertion", "sa-slot-language-render"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-language-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}