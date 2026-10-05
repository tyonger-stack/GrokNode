#!/usr/bin/env node
/**
 * Audit the deployed renderer's `selectForYou` affinity key against official 0.66.
 *
 * Why this exists
 * ---------------
 * The conclusion has already been reversed once. A 16:25 pass claimed the deployed artifact was
 * fine because it looked the key function up **by minified name** (`gs` / `ge`) — `function ge(` has
 * 4 same-named definitions in that chunk and the one it read is the marketplace/teamName probe.
 * The stable way in is a string that must exist: `affinityStrength` (esbuild keeps object property
 * names), then the *call-site offset inside that function* for the callee, with a uniqueness check.
 *
 * What it reports
 * ---------------
 *   deployed  = /Applications/Grok Node.app  → key goes through the `as` mapping table
 *   official  = /Applications/Grok Bot.app    → key is the raw `category` label
 * and how many of the official 403 real catalog rows end up with an EMPTY affinity key on each side.
 *
 * Anti-drift
 * ----------
 * The replay below transcribes the deployed algorithm by hand, so the transcription itself could go
 * stale and silently keep reporting last release's numbers. Every table it replays against is
 * extracted from the artifact and compared to the transcription; a mismatch is a hard failure, not a
 * warning. If upstream changes, this script says so instead of lying.
 *
 *   node scripts/audit-deployed-affinity-key.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const DEPLOYED_ASAR = "/Applications/Grok Node.app/Contents/Resources/app.asar";
const FIXTURE = path.join(REPO, "tests/fixtures/official-foryou-attribution.json");

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  ❌ ${msg}`); };
const pass = (msg) => console.log(`  ✅ ${msg}`);

/* ------------------------------------------------------------------ asar ---- */

function readEntries(asar) {
  const fd = fs.openSync(asar, "r");
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  // Header is four uint32: @0=4, @4=headerSize, @8=pickle size, @12=JSON byte length.
  const dataStart = 8 + head.readUInt32LE(4);
  const jsonLength = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonLength);
  fs.readSync(fd, json, 0, jsonLength, 16);
  fs.closeSync(fd);
  const entries = [];
  (function walk(node, prefix) {
    for (const name of Object.keys(node.files ?? {})) {
      const child = node.files[name];
      const full = prefix ? `${prefix}/${name}` : name;
      if (child.files) walk(child, full);
      else entries.push({ full, size: child.size, offset: child.offset, unpacked: !!child.unpacked });
    }
  })(JSON.parse(json.toString("utf8")), "");
  return { entries, dataStart };
}

function readChunk(asar, predicate) {
  const { entries, dataStart } = readEntries(asar);
  const nodes = entries.filter((e) => !e.unpacked && e.offset !== undefined && predicate(e));
  if (nodes.length !== 1) throw new Error(`匹配 chunk 数量 ${nodes.length}（要求恰好 1）：${nodes.map((n) => n.full).join(", ")}`);
  const n = nodes[0];
  const fd = fs.openSync(asar, "r");
  // asar offsets are STRINGS in the header JSON; BigInt until the final conversion or you read the
  // wrong bytes silently (this bit us once).
  const from = Number(BigInt(dataStart) + BigInt(n.offset));
  const buf = Buffer.alloc(n.size);
  fs.readSync(fd, buf, 0, n.size, from);
  fs.closeSync(fd);
  return { node: n, src: buf.toString("utf8") };
}

/* -------------------------------------------------------------- extraction -- */

/** Read `function NAME(params){…}` by brace depth, starting at the function's OWN brace.
 *  Signature omits the trailing `{`. Fails closed unless the declaration is unique. */
function readFn(src, name) {
  const re = new RegExp(`function ${name.replace(/\$/g, "\\$")}\\(([^)]*)\\)`, "g");
  const defs = [];
  let m;
  while ((m = re.exec(src)) !== null) defs.push(m[1]);
  if (defs.length !== 1) return { error: `function ${name} 定义 ${defs.length} 次（要求恰好 1）` };
  const start = src.indexOf(`function ${name}(${defs[0]})`);
  const brace = start + `function ${name}(${defs[0]})`.length;
  let depth = 0, end = -1;
  for (let j = brace; j < src.length; j += 1) {
    const c = src[j];
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) { end = j + 1; break; } }
  }
  if (end < 0) return { error: "括号不平衡" };
  return { body: src.slice(start, end) };
}

/** Read an object-literal declaration `NAME={…}` by brace depth from its own opening brace. */
function readObjectLiteral(src, name) {
  const re = new RegExp(`(?:const|let|var)?\\s*${name.replace(/\$/g, "\\$")}\\s*=\\s*\\{`, "g");
  const hits = [];
  let m;
  while ((m = re.exec(src)) !== null) hits.push(m.index);
  if (hits.length !== 1) return { error: `${name}={…} 命中 ${hits.length} 次（要求恰好 1）` };
  const brace = src.indexOf("{", hits[0]);
  let depth = 0, end = -1;
  for (let j = brace; j < src.length; j += 1) {
    const c = src[j];
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) { end = j + 1; break; } }
  }
  if (end < 0) return { error: "括号不平衡" };
  return { literal: src.slice(hits[0], end).replace(/^(?:const|let|var)\s*/, "") };
}

/** Same, but resolved from a USAGE site: take the NEAREST preceding declaration.
 *  Short minified names are reused (`ts` appears as a whole-file identifier 22 times), so a
 *  whole-file uniqueness requirement is unusable. Nearest-preceding is the declaration the usage
 *  is actually bound to in a single top-level scope. `shape` then sanity-checks the literal. */
function readObjectLiteralNear(src, name, usageAbs, shape) {
  const re = new RegExp(`(?:const|let|var)?\\s*${name.replace(/\$/g, "\\$")}\\s*=\\s*\\{`, "g");
  const hits = [];
  let m;
  while ((m = re.exec(src)) !== null && m.index < usageAbs) hits.push(m.index);
  if (hits.length === 0) return { error: `使用点之前没有 ${name}={…} 声明` };
  const at = hits[hits.length - 1];
  const brace = src.indexOf("{", at);
  let depth = 0, end = -1;
  for (let j = brace; j < src.length; j += 1) {
    const c = src[j];
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) { end = j + 1; break; } }
  }
  if (end < 0) return { error: "括号不平衡" };
  const literal = src.slice(at, end).replace(
    new RegExp(`^(?:const|let|var)?\\s*${name.replace(/\$/g, "\\$")}\\s*=\\s*`),
    "",
  );
  if (shape && !shape.test(literal)) return { error: `最近的前置 ${name} 字面量形状不符：${literal.slice(0, 120)}` };
  return { literal, at, skipped: hits.length - 1 };
}

/* ---------------------------------------------------------------- deployed ---- */

console.log("== 已部署渲染器（/Applications/Grok Node.app）==\n");
const deployed = readChunk(DEPLOYED_ASAR, (e) => /renderer\/assets\/index-[A-Za-z0-9_-]{6,}\.js$/.test(e.full) && e.size > 5_000_000);
console.log(`主 chunk: ${deployed.node.full}  ${deployed.node.size} B`);

const hits = [];
for (let i = deployed.src.indexOf("affinityStrength"); i >= 0; i = deployed.src.indexOf("affinityStrength", i + 1)) hits.push(i);
console.log(`affinityStrength 命中 ${hits.length} 次`);
if (hits.length === 0) { fail("产物里没有 affinityStrength —— 锚点失效，脚本必须更新"); process.exit(1); }

// Which named function each hit sits in — this is the check the 16:25 pass got wrong.
const owners = new Set();
for (const h of hits) {
  const def = deployed.src.lastIndexOf("function ", h);
  owners.add(def < 0 ? "?" : deployed.src.slice(def + 9, deployed.src.indexOf("(", def)));
}
console.log(`这 ${hits.length} 次所在函数: ${[...owners].join(", ")}`);
if (owners.size !== 1) fail(`affinityStrength 跨越了 ${owners.size} 个函数（${[...owners].join(", ")}）—— 锚点不再唯一，拒绝继续`);
else pass(`${hits.length} 次命中全部落在 \`${[...owners][0]}\` 内`);

const msName = [...owners][0];
const ms = readFn(deployed.src, msName);
if (ms.error) { fail(ms.error); process.exit(1); }
console.log(`\n${ms.body.slice(0, 120)}…  (${ms.body.length} 字节)`);

// Key function: by CALL SITE inside the body, not by name (names collide — `ge` has 4).
const keyCalls = [...ms.body.matchAll(/\b([A-Za-z_$][\w$]*)\(\s*\w+\.entry\s*\)/g)].map((m) => m[1]);
const keyName = [...new Set(keyCalls)][0];
console.log(`\n键函数（按调用点定位）: ${keyName}`);
if (!keyName) { fail("selectForYou 体内没有 .entry 形态的键函数调用"); process.exit(1); }

const keyCount = (deployed.src.match(new RegExp(`function ${keyName}\\(`, "g")) ?? []).length;
if (keyCount !== 1) { fail(`键函数 ${keyName} 有 ${keyCount} 个同名定义，无法唯一定位 —— 拒绝猜`); process.exit(1); }
const keyFn = readFn(deployed.src, keyName);
if (keyFn.error) { fail(keyFn.error); process.exit(1); }
console.log(`${keyFn.body}\n`);

// Resolve each table from where `vn` USES it, not by whole-file name (see readObjectLiteralNear).
const keyStart = deployed.src.indexOf(keyFn.body);
if (keyStart < 0) { fail("无法把键函数体定位回 chunk（indexOf 失败）"); process.exit(1); }
const asUse = keyStart + keyFn.body.search(/\bas\[/);
const tsUse = keyStart + keyFn.body.search(/\bts\[/);
const asLit = readObjectLiteralNear(deployed.src, "as", asUse, /credentials|productivity|communication/);
const tsLit = readObjectLiteralNear(deployed.src, "ts", tsUse, /slack|notion|figma/);
if (asLit.error) { fail(`as: ${asLit.error}`); process.exit(1); }
if (tsLit.error) { fail(`ts: ${tsLit.error}`); process.exit(1); }
console.log(`as 使用点 @${asUse} → 声明 @${asLit.at}（越过 ${asLit.skipped} 个更早的同名声明）`);
console.log(`ts 使用点 @${tsUse} → 声明 @${tsLit.at}（越过 ${tsLit.skipped} 个更早的同名声明）`);
console.log(`\nas = ${asLit.literal}\n`);
console.log(`ts = ${tsLit.literal.slice(0, 200)}…\n`);

/* ---------------------------------------- anti-drift: transcription vs artifact -- */

// Replay tables, transcribed from the bytes printed above. Compared against the artifact below.
const TRANSCRIBED_AS = {
  LOGIN_AND_CREDENTIAL_MANAGEMENT: "credentials", PRODUCTIVITY: "productivity",
  INBOX_AND_COLLABORATION: "communication", SCHEDULING: "communication", SALES: "sales",
  CUSTOMER_SUPPORT: "support", PAYMENTS: "finance", FINANCE_AND_LEGAL: "finance",
  DATA_ANALYTICS: "data", DESIGN: "design", CANVAS: "design",
  DOCUMENTS_AND_FILES: "productivity", INFRASTRUCTURE: "code", RESEARCH: "research",
};
const asFromArtifact = eval(`(${asLit.literal})`); // eslint-disable-line no-eval
const driftAs = Object.keys({ ...asFromArtifact, ...TRANSCRIBED_AS })
  .filter((k) => asFromArtifact[k] !== TRANSCRIBED_AS[k]);
if (driftAs.length) {
  fail(`转写与产物漂移：${driftAs.map((k) => `${k}: 产物=${asFromArtifact[k]} 转写=${TRANSCRIBED_AS[k]}`).join("; ")}`);
} else {
  pass(`\`as\` 转写与产物一致（${Object.keys(TRANSCRIBED_AS).length} 个键）`);
}
for (const missing of ["MCP", "AGENT_ORCHESTRATION", "FEATURED"]) {
  if (missing in asFromArtifact) fail(`\`as\` 竟然有 ${missing} —— 本文结论需重新评估`);
}
if (!("MCP" in asFromArtifact)) pass("`as` 表确实没有 MCP 键 —— 这是 MCP 类条目失格的原因");

/* ------------------------------------------------------------------- replay ---- */

const as = asFromArtifact;
const ts = eval(`(${tsLit.literal})`); // eslint-disable-line no-eval
const ss = new Set(["canva", "mailerlite"]);
const L = (v) => (typeof v === "string" ? v : "");
const ds = (n) => Array.isArray(n.categoryKeys) && n.categoryKeys.length > 0;
const cs = (n) => L(n.categoryKey || n.category).trim().toUpperCase().replace(/&/gu, " AND ").replace(/[^A-Z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
const ps = (n) => { const e = []; for (const a of [n.pluginName, n.name]) { const t = L(a).trim().toLocaleLowerCase("en-US"); if (t.length > 0) e.push(t); } return e; };
const us = (n) => (Array.isArray(n.categoryKeys) ? n.categoryKeys.filter((e) => L(e).length > 0) : n.categoryKey !== undefined && n.categoryKey !== null ? [L(n.categoryKey)] : [L(n.category)]);
function vn(n) {
  const e = !ds(n);
  for (const t of ps(n)) { const s = ts[t]; if (s != null && !(ss.has(t) && !e)) return s; }
  const a = [];
  for (const t of us(n)) { const s = as[cs({ category: t })]; if (s != null && !a.includes(s)) a.push(s); }
  return a;
}
const vOfficial = (n) => L(n.category).trim(); // official `v`: j(n.category.trim(), locale) — label itself

const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
console.log(`\n== 影响面（官方实机 catalog ${fx.catalog.length} 条）==`);
let empty = 0;
const byCat = new Map();
for (const e of fx.catalog) {
  if (vn(e).length === 0) { empty += 1; const c = String(e.category ?? "<none>"); byCat.set(c, (byCat.get(c) ?? 0) + 1); }
}
const officialEmpty = fx.catalog.filter((e) => vOfficial(e).length === 0).length;

console.log(`部署侧键为空: ${empty} / ${fx.catalog.length}`);
for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) console.log(`   ${JSON.stringify(c)}: ${n}`);
console.log(`官方侧键为空: ${officialEmpty} / ${fx.catalog.length}`);
console.log(`\n夹具记录的官方 forYou: ${JSON.stringify(fx.officialForYou)}`);

if (officialEmpty !== 0) fail(`官方侧应有 0 条键为空，实测 ${officialEmpty} —— 官方侧模型变了，本脚本需更新`);
else pass("官方侧 0 条键为空（直接取标签，符合预期）");

console.log(`\n${failures === 0 ? "✅ 审计通过" : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
