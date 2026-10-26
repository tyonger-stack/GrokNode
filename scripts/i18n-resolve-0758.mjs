// Build the 0.75.8 vs installed-Grok-Node i18n surface inventory.
// Official 0.75.8: one JSON locale table per language, id -> [text].
// Installed Grok Node (0.18 baseline): one JSON table with language keys
// {"en":{id:[text]},"zh":{...}}, plus inline RLocT("English","中文") pairs.
import fs from "node:fs";
import path from "node:path";

const OFF = "/Users/Apple/Documents/grokbot/rea-grokbot-0758/app/dist/renderer/assets";
const INSTALLED = "/Users/Apple/Documents/grokbot/rea-grokbot-0758/grok-node-installed/dist/renderer/assets";

function jsFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f));
}

function toText(v) {
  if (!Array.isArray(v)) return null;
  return v.map((x) => (typeof x === "string" ? x : Array.isArray(x) ? `{${x.join(",")}}` : "")).join("");
}

const CJK = /[一-鿿]/;

function parsePayload(raw) {
  for (const c of [raw, raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\")]) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object") return obj;
    } catch { /* next */ }
  }
  return null;
}

// Flatten either {id:[text]} or {lang:{id:[text]}} into zh id -> text.
function zhEntries(obj) {
  const out = new Map();
  const langKeys = Object.keys(obj).filter((k) => /^(en|zh|zh-Hans|zh_CN|zh-CN|ja|ko)$/i.test(k));
  const buckets = langKeys.length >= 1 && Object.values(obj)[0] && typeof Object.values(obj)[0] === "object"
    ? langKeys.map((k) => obj[k])
    : [obj];
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object") continue;
    let total = 0;
    let zh = 0;
    for (const v of Object.values(bucket)) {
      const t = toText(v);
      if (!t) continue;
      total += 1;
      if (CJK.test(t)) zh += 1;
      if (total >= 12) break;
    }
    if (total < 5 || zh / total < 0.6) continue; // not a zh-Hans table
    for (const [k, v] of Object.entries(bucket)) {
      const t = toText(v);
      if (t && !out.has(k)) out.set(k, t);
    }
  }
  return out;
}

function collectZh(dir) {
  const byId = new Map();
  const byText = new Map();
  for (const f of jsFiles(dir)) {
    const t = fs.readFileSync(f, "utf8");
    for (const re of [/JSON\.parse\(`(\{[\s\S]*?\})`\)/g, /JSON\.parse\("(\{[\s\S]*?\})"\)/g]) {
      let m;
      while ((m = re.exec(t)) !== null) {
        const obj = parsePayload(m[1]);
        if (!obj) continue;
        for (const [id, text] of zhEntries(obj)) {
          if (!byId.has(id)) byId.set(id, text);
          if (!byText.has(text)) byText.set(text, path.basename(f));
        }
      }
    }
    const re2 = /RLocT\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
    let m2;
    while ((m2 = re2.exec(t)) !== null) {
      let zh;
      try { zh = JSON.parse(`"${m2[2]}"`); } catch { zh = m2[2]; }
      if (!byText.has(zh)) byText.set(zh, path.basename(f));
    }
  }
  return { byId, byText };
}

const off = collectZh(OFF);
const inst = collectZh(INSTALLED);
console.log(`official 0.75.8 zh-Hans ids: ${off.byId.size} (zh texts ${off.byText.size})`);
console.log(`installed Grok Node zh-Hans ids: ${inst.byId.size} (zh texts ${inst.byText.size})`);

let sharedIds = 0;
for (const k of off.byId.keys()) if (inst.byId.has(k)) sharedIds += 1;
console.log(`ids present on both sides: ${sharedIds}`);

const missing = [];
for (const [id, text] of off.byId) {
  if (!text || text.length < 2) continue;
  if (!inst.byText.has(text)) missing.push({ id, zh: text });
}
console.log(`0.75.8 zh-Hans values absent from installed Grok Node: ${missing.length}`);

const outDir = "/Users/Apple/Documents/grokbot/rea-grokbot-0758/i18n";
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "official-zh.json"), JSON.stringify(Object.fromEntries(off.byId), null, 2));
fs.writeFileSync(path.join(outDir, "installed-zh.json"), JSON.stringify(Object.fromEntries(inst.byId), null, 2));
fs.writeFileSync(path.join(outDir, "missing-zh.json"), JSON.stringify(missing, null, 2));
