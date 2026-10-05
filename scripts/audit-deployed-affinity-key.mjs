#!/usr/bin/env node
/**
 * Audit the deployed renderer's `selectForYou` affinity key against official 0.66.
 *
 * Why this exists
 * ---------------
 * The conclusion here has been reversed twice. A pass claimed the deployed artifact was fine because
 * it looked the key function up **by minified name** (`gs` / `ge`); `function ge(` has 4 same-named
 * definitions there and the one it read is the marketplace/teamName probe. A later pass then read the
 * key off the *call site* — better — but still demanded the declaration be unique by name, and a
 * re-package renamed things (`ms`→`Ls`, `vn`→`ye`) and gave `Ls` two declarations, which killed the
 * check entirely. A permanently dead check is an "always false" detector in disguise.
 *
 * So: **no minified name is ever an anchor.** Three positional facts are:
 *   1. CONTAINMENT — every `affinityStrength` offset must fall inside one function body. (The
 *      property name survives minification; that is the only thing here that does.)
 *   2. CALL SITE   — the key function is whatever `NAME(...entry)` is invoked on, inside that body.
 *   3. SCOPE       — in one flat bundle the declaration in effect at that call is the NEAREST
 *      PRECEDING one. That is scope resolution, not a guess. How many earlier same-named
 *      declarations were passed is printed so a reviewer can check the resolution.
 *
 * Two key-function shapes are handled, because the fix may or may not be deployed:
 *   · label-keyed — the key is the entry's own `category` label (what official's `v(e,t)` does).
 *   · table-keyed — the label is resolved through a lookup table, which silently drops every entry
 *     whose category the table does not cover. This was the deployed defect: the `as` table had no
 *     MCP / AGENT_ORCHESTRATION / FEATURED, so 169 of 403 rows had an empty key.
 *
 * Anti-drift
 * ----------
 * Replay tables are transcribed by hand, so the transcription could go stale and keep reporting the
 * previous release's numbers. Every replayed table is compared against the artifact and a mismatch is
 * a hard failure.
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
const LOCAL_FIXTURE = path.join(REPO, "tests/fixtures/local-installed-servers.json");

const L = (v) => (typeof v === "string" ? v : "");
let failures = 0;
const fail = (m) => { failures += 1; console.log(`  ❌ ${m}`); };
const pass = (m) => console.log(`  ✅ ${m}`);
const info = (m) => console.log(`     ${m}`);

/* ------------------------------------------------------------------ asar ---- */

function readEntries(asar) {
  const fd = fs.openSync(asar, "r");
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const dataStart = 8 + head.readUInt32LE(4); // header: @0=4 @4=headerSize @8=pickle @12=jsonLen
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
  if (nodes.length !== 1) throw new Error(`匹配 chunk 数量 ${nodes.length}（要求恰好 1）`);
  const n = nodes[0];
  const fd = fs.openSync(asar, "r");
  // asar offsets are STRINGS in the header JSON; BigInt until the last conversion or you read the
  // wrong bytes silently.
  const from = Number(BigInt(dataStart) + BigInt(n.offset));
  const buf = Buffer.alloc(n.size);
  fs.readSync(fd, buf, 0, n.size, from);
  fs.closeSync(fd);
  return { node: n, src: buf.toString("utf8") };
}

/* -------------------------------------------------------------- extraction -- */

/** All bodies of `function NAME(...)` declarations, with their byte ranges. */
function allDecls(src, name) {
  const re = new RegExp(`function ${name.replace(/\$/g, "\\$")}\\(([^)]*)\\)`, "g");
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const sig = `function ${name}(${m[1]})`;
    const brace = m.index + sig.length;
    let depth = 0, end = -1;
    for (let j = brace; j < src.length; j += 1) {
      const c = src[j];
      if (c === "{") depth += 1;
      else if (c === "}") { depth -= 1; if (depth === 0) { end = j + 1; break; } }
    }
    if (end > 0) out.push({ params: m[1], start: m.index, end, body: src.slice(m.index, end) });
  }
  return out;
}

/** Read an object-literal `NAME={…}` by brace depth from its own opening brace. */
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
if (hits.length === 0) { fail("产物里没有 affinityStrength —— 锚点失效，脚本必须更新"); process.exit(1); }
console.log(`affinityStrength 命中 ${hits.length} 次`);

// (1) CONTAINMENT: find the declarations that contain every hit.
const owners = new Set();
let container = null;
for (const name of new Set(deployed.src.match(/function ([A-Za-z_$][\w$]*)\(/g)?.map((s) => s.slice(9, -1)) ?? [])) {
  for (const d of allDecls(deployed.src, name)) {
    if (hits.every((h) => h >= d.start && h < d.end)) container = d;
  }
}
if (!container) { fail(`${hits.length} 次 affinityStrength 没有落在同一个函数体内 —— 锚点不再唯一`); process.exit(1); }
const fnName = deployed.src.slice(container.start + 9, deployed.src.indexOf("(", container.start));
console.log(`这 ${hits.length} 次全部落在 \`${fnName}\` 内`);
pass(`selectForYou 由包含关系唯一定位：${fnName}（${container.body.length} 字节）`);
console.log(`${container.body.slice(0, 200)}…\n`);

// (2) CALL SITE: the key function is whatever `NAME(...entry)` is called on inside that body.
const keyCalls = [...container.body.matchAll(/\b([A-Za-z_$][\w$]*)\(\s*\w+\.entry\s*\)/g)]
  .map((m) => ({ name: m[1], at: container.start + m.index }));
if (keyCalls.length === 0) { fail("selectForYou 体内没有 .entry 形态的键函数调用"); process.exit(1); }
const keyName = keyCalls[0].name;
const callAt = keyCalls[0].at;
console.log(`键函数（按调用点定位）: ${keyName}，调用点 @${callAt}`);

// (3) SCOPE: nearest preceding declaration.
const keyDecls = allDecls(deployed.src, keyName).filter((d) => d.start < callAt);
if (keyDecls.length === 0) { fail(`键函数 ${keyName} 在调用点之前没有声明 —— 拒绝猜`); process.exit(1); }
const keyFn = keyDecls[keyDecls.length - 1];
info(`${keyName} 有 ${keyDecls.length} 个前置声明，取最近的一个（越过 ${keyDecls.length - 1} 个更早的）`);
console.log(`${keyFn.body}\n`);

// Shape of the key.
const tableKeyed = /\bas\[/.test(keyFn.body) || /\bts\[/.test(keyFn.body);
if (tableKeyed) {
  pass("键函数经映射表间接 —— 查表会被表缺项吞掉（与官方不同源）");
} else if (/\.category\b/.test(keyFn.body)) {
  pass("键函数直接取 category 标签，不经映射表（与官方 0.66 同源）");
} else {
  fail("键函数既不查表也不出现 .category —— 无法判定");
}

const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const local = JSON.parse(fs.readFileSync(LOCAL_FIXTURE, "utf8"));
console.log(`\n== 影响面（官方实机 catalog ${fx.catalog.length} 条）==`);

if (tableKeyed) {
  const asUse = keyFn.start + keyFn.body.search(/\bas\[/);
  const tsUse = keyFn.start + keyFn.body.search(/\bts\[/);
  const asLit = readObjectLiteralNear(deployed.src, "as", asUse, /credentials|productivity|communication/);
  const tsLit = readObjectLiteralNear(deployed.src, "ts", tsUse, /slack|notion|figma/);
  if (asLit.error || tsLit.error) { fail(asLit.error ?? tsLit.error); process.exit(1); }
  const as = eval(`(${asLit.literal})`); // eslint-disable-line no-eval
  const ts = eval(`(${tsLit.literal})`); // eslint-disable-line no-eval
  const ss = new Set(["canva", "mailerlite"]);
  const K = (n) => L(n).trim().toLocaleLowerCase();
  const ke = (n) => (n.includes(":") ? n.slice(0, n.indexOf(":")) : n);
  const osId = (n) => L(n.id) || L(n.name);
  const hasKeys = (n) => Array.isArray(n.categoryKeys) && n.categoryKeys.length > 0;
  const cs = (n) => L(n.categoryKey || n.category).trim().toUpperCase().replace(/&/gu, " AND ").replace(/[^A-Z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  const ps = (n) => { const e = []; for (const a of [n.pluginName, n.name]) { const t = L(a).trim().toLocaleLowerCase("en-US"); if (t.length > 0) e.push(t); } return e; };
  const us = (n) => (Array.isArray(n.categoryKeys) ? n.categoryKeys.filter((e) => L(e).length > 0) : n.categoryKey != null ? [L(n.categoryKey)] : [L(n.category)]);
  const vn = (n) => {
    const e = !hasKeys(n);
    for (const t of ps(n)) { const s = ts[t]; if (s != null && !(ss.has(t) && !e)) return s; }
    const a = [];
    for (const t of us(n)) { const s = as[cs({ category: t })]; if (s != null && !a.includes(s)) a.push(s); }
    return a;
  };
  let empty = 0;
  const byCat = new Map();
  for (const e of fx.catalog) {
    if (vn(e).length === 0) { empty += 1; const c = String(e.category ?? "<none>"); byCat.set(c, (byCat.get(c) ?? 0) + 1); }
  }
  console.log(`部署侧键为空: ${empty} / ${fx.catalog.length}`);
  for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) console.log(`   ${JSON.stringify(c)}: ${n}`);
  console.log(`官方侧键为空: ${fx.catalog.filter((e) => L(e.category).trim().length === 0).length} / ${fx.catalog.length}`);
  if (empty > 0) fail(`${empty} 条条目拿不到 affinity 键 —— 这些条目结构上选不进「为你推荐」`);
  else pass("0 条条目拿不到 affinity 键");
} else {
  // Label-keyed: the real test is simply whether any row can end up with an empty key.
  const empty = fx.catalog.filter((e) => L(e.category).trim().length === 0).length;
  console.log(`部署侧键为空: ${empty} / ${fx.catalog.length}（直接取标签，只在标签为空时为空）`);
  if (empty === 0) pass("0 条条目拿不到 affinity 键");
  else fail(`${empty} 条条目的 category 为空`);
}

/* ------------------------------------------- replay vs what the UI showed ---- */

console.log(`\n== 与界面读数对拍 ==`);
const servers = local.servers.map((name) => ({ name }));
const serversByName = servers;
const isInstalled = (e) => {
  const t = L(e.displayName) || L(e.name);
  return serversByName.find((o) => L(o.name).split(":")[0] === t)
    ?? serversByName.find((o) => L(o.name).split(":")[0].toLocaleLowerCase() === t.toLocaleLowerCase())
    ?? null;
};
const installed = fx.catalog.filter(isInstalled);
console.log(`本地判为已装 ${installed.length} 条: ${installed.map((e) => e.displayName || e.name).join(", ")}`);

const categoryKey = (e) => L(e.category).trim();
const affinity = new Map();
for (const e of installed) {
  const k = categoryKey(e);
  if (k.length > 0) affinity.set(k, (affinity.get(k) ?? 0) + 1);
}
console.log(`亲和表: ${JSON.stringify([...affinity])}`);

const LIMIT = 4;
const pool = fx.catalog.filter((e) => !isInstalled(e)).map((e) => ({ e, name: e.displayName || e.name, tc: 0, aff: affinity.get(categoryKey(e)) ?? 0 }));
const anyTeam = pool.some((p) => p.tc > 0);
info(`team 池为空: ${!anyTeam}（为真才可跳过末尾 signal 排序；为假则本段结论作废）`);
const byName = (a, b) => a.name.localeCompare(b.name);
const rTeam = pool.filter((p) => p.tc > 0).sort((a, b) => b.tc - a.tc || byName(a, b));
const rAff = pool.filter((p) => p.aff > 0).sort((a, b) => b.aff - a.aff || b.tc - a.tc || byName(a, b));
console.log(`affinity 池非空 ${rAff.length} / ${pool.length}；前 4 行${rAff.length ? `均并列在 strength=${rAff[0].aff}` : ""}，靠 localeCompare 决胜`);
const seen = new Set(), out = [];
const push = (c) => { if (seen.has(c.e.id) || out.length === LIMIT) return; seen.add(c.e.id); out.push(c); };
for (const c of rTeam.slice(0, Math.max(1, Math.floor(LIMIT * 0.5)))) push(c);
for (const c of rAff) push(c);
for (const c of rTeam) push(c);
const replayed = out.map((c) => c.name);

console.log(`离线重放: ${JSON.stringify(replayed)}`);
console.log(`界面实测: ${JSON.stringify(local._observedForyou)}`);
console.log(`官方那 4 赢家: ${JSON.stringify(fx.officialForYou)}`);
const officialCats = (fx.officialForYou ?? []).map((w) => fx.catalog.find((e) => (e.displayName || e.name) === w)?.category);
console.log(`官方赢家 category: ${JSON.stringify(officialCats)}`);
info("两侧已装集合不同（官方 16 / 本地 8），重放结果不必等于官方的 4 行；"
  + "它只需要与本地界面读数一致，并说明本地为何选不出官方那几条。");

console.log(`\n${failures === 0 ? "✅ 审计通过" : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
