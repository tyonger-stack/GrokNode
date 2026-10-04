#!/usr/bin/env node
/**
 * Re-verify the App-marketplace port against the official 0.66 build, end to end.
 *
 * The parity claims in docs/MARKETPLACE-066-*.md were, until now, only re-checkable by hand and had
 * already gone stale twice — once because the deployed app ran older bytes than the source, once
 * because `categoryKeys` was dropped between the two host-side projections. This script is the
 * reproducible form of those checks, so a reviewer can run one command instead of re-deriving them.
 *
 * It needs BOTH apps running with a CDP port:
 *   /Applications/Grok Bot.app/Contents/MacOS/Grok Bot --remote-debugging-port=9224
 *   open -a "/Applications/Grok Node.app" --args --remote-debugging-port=9232
 *
 *   node scripts/verify-marketplace-parity.mjs
 *
 * Static half (no app required): upstream tables vs our transcription, deployed-asar content.
 * Live half: the homepage section-by-section diff. Exits non-zero if the static half fails.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OFFICIAL_ASAR = "/Applications/Grok Bot.app/Contents/Resources/app.asar";
const DEPLOYED_ASAR = "/Applications/Grok Node.app/Contents/Resources/app.asar";
const UPSTREAM_MODEL_CHUNK = "dist/renderer/assets/chunk-marketplace-browse-model-DoOY91TS.js";
const OFFICIAL_CDP = "9224";
const DEPLOYED_CDP = "9232";
const OFFICIAL_URL_HINT = "Grok%20Bot.app";
const DEPLOYED_URL_HINT = "Grok%20Node.app";

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures += 1;
  console.log(`  ${pass ? "✅" : "❌"} ${label}${detail ? `  — ${detail}` : ""}`);
};

/* ---------------------------------------------------------------- asar ---- */

function readEntries(asar) {
  const fd = fs.openSync(asar, "r");
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  // Header is four uint32: @0 = 4, @4 = headerSize, @8 = pickle size, @12 = JSON byte length.
  // The data section starts at 8 + headerSize, and the JSON starts at 16.
  const dataStart = 8 + head.readUInt32LE(4);
  const jsonLength = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonLength);
  fs.readSync(fd, json, 0, jsonLength, 16);
  const header = JSON.parse(json.toString("utf8"));
  const entries = [];
  (function walk(node, prefix) {
    for (const name of Object.keys(node.files ?? {})) {
      const child = node.files[name];
      const full = prefix ? `${prefix}/${name}` : name;
      if (child.files) walk(child, full);
      else entries.push([full, child]);
    }
  })(header, "");
  return {
    read(entryPath) {
      const entry = entries.find(([p]) => p === entryPath)?.[1];
      if (entry == null || entry.offset === undefined) return null;
      const size = entry.size ?? 0;
      const out = Buffer.alloc(size);
      // `offset` is a STRING in the header; add as BigInt or it concatenates instead of adding.
      fs.readSync(fd, out, 0, size, Number(BigInt(dataStart) + BigInt(entry.offset)));
      return out.toString("utf8");
    },
    paths: entries.map(([p]) => p),
  };
}

/* ------------------------------------------------------- static checks ---- */

console.log("\n■ 上游真源（本机 0.66 的 browse-model chunk）");
if (!fs.existsSync(OFFICIAL_ASAR)) {
  console.log(`  ⚠️  未安装 ${OFFICIAL_ASAR}，跳过上游对照`);
} else {
  const official = readEntries(OFFICIAL_ASAR);
  const chunk = official.read(UPSTREAM_MODEL_CHUNK);
  ok(`chunk 存在且为 12,928 字节`, chunk?.length === 12928, `实际 ${chunk?.length} 字节`);

  // The whole point of the port: these tables are transcribed, not fitted. Parse them straight out
  // of upstream so the comparison is against the artifact, not against our own comments.
  const grab = (source, name) => {
    const at = source.search(new RegExp("(^|[,;])" + name + "\\s*=\\s*\\{"));
    if (at < 0) return null;
    const open = source.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(open, i + 1);
      }
    }
    return null;
  };
  const pairs = (body) =>
    Object.fromEntries(
      [...body.matchAll(/(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*(\[[^\]]*\]|"[^"]*")/g)].map((m) => [
        m[1] ?? m[2],
        m[3].replace(/\s+/g, ""),
      ]),
    );

  const upstreamLe = chunk && grab(chunk, "Le");
  const upstreamTe = chunk && grab(chunk, "Te");
  const upstreamCe = chunk?.match(/Ce=\[([^\]]*)\]/)?.[1].replace(/\s+/g, "");

  const model = fs.readFileSync(
    path.join(import.meta.dirname, "..", "frontend/src/extensions/marketplace/model.ts"),
    "utf8",
  );
  const grabLocal = (name) => {
    const at = model.indexOf(`const ${name}: Readonly<Record<`);
    if (at < 0) return null;
    const open = model.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < model.length; i += 1) {
      if (model[i] === "{") depth += 1;
      else if (model[i] === "}") {
        depth -= 1;
        if (depth === 0) return model.slice(open, i + 1);
      }
    }
    return null;
  };

  if (upstreamLe) {
    const up = pairs(upstreamLe);
    const local = pairs(grabLocal("CATALOG_CATEGORY_TO_BUCKET") ?? "");
    const keys = Object.keys(up);
    const same = keys.every((k) => local[k] === up[k]) && Object.keys(local).length === keys.length;
    ok(`Le 表逐条一致（${keys.length} 条）`, same,
      same ? "" : `上游缺/本地多: ${keys.filter((k) => local[k] !== up[k]).join(", ")}`);
    // The two absences are load-bearing: unmapped keys are dropped, not defaulted, so rows in these
    // categories legitimately appear in no bucket — on the official build too.
    ok("Le 中确无 AGENT_ORCHESTRATION / MCP", !("AGENT_ORCHESTRATION" in up) && !("MCP" in up));
  }

  if (upstreamTe) {
    const up = pairs(upstreamTe);
    const local = pairs(grabLocal("VENDOR_BUCKET_OVERRIDES") ?? "");
    const upstreamSlugs = Object.keys(up);
    const localSlugs = Object.keys(local);
    const missing = upstreamSlugs.filter((k) => local[k] !== up[k]);
    // Two extra slugs are allowed: they are the DATA-GAP COMPENSATIONS, flagged as non-upstream in
    // the source and only consulted when an entry has no authoritative `categoryKeys` array.
    const extra = localSlugs.filter((k) => !(k in up));
    const extraIsJustCompensations = extra.every((k) => model.includes(`  ${k}: [`));
    ok(`Te 表 16 个上游 slug 全部转写`, missing.length === 0 && extraIsJustCompensations,
      missing.length ? `缺/不一致: ${missing.join(", ")}` : extra.length ? `额外 slug（须为补偿项）: ${extra.join(", ")}` : "");
  }

  if (upstreamCe) {
    // Strip quotes, whitespace AND the trailing comma the multi-line literal carries — upstream's
    // inline array has none, so an unstripped trailing comma reads as a mismatch that isn't real.
    const tidy = (raw) => raw.replace(/["\s]/g, "").replace(/,$/, "");
    const localOrder = tidy(model.match(/CATEGORY_BUCKET_ORDER\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "");
    ok("CATEGORY_BUCKET_ORDER 等于上游 Ce", localOrder === tidy(upstreamCe),
      localOrder === tidy(upstreamCe) ? "" : `本地 ${localOrder} / 上游 ${tidy(upstreamCe)}`);
  }
}

console.log("\n■ 部署版字节（/Applications/Grok Node.app）");
if (!fs.existsSync(DEPLOYED_ASAR)) {
  console.log(`  ⚠️  未部署 ${DEPLOYED_ASAR}，跳过`);
} else {
  const app = readEntries(DEPLOYED_ASAR);
  const main = app.read("dist/electron-main/main.cjs") ?? "";
  const renderer = app.read("dist/renderer/assets/index-UbX-y3il.js") ?? "";

  // categoryKeys must survive BOTH host-side projections, or the renderer silently falls back to
  // the single human-readable label and the whole upstream bucketing degrades.
  const toPluginHits = (main.match(/categoryKeys/g) ?? []).length;
  const viewProjection = /categoryKeys:\s*plugin\.categoryKeys/.test(main);
  const toPluginProjection = /categoryKey,\s*\n?\s*categoryKeys,/.test(main) || /const categoryKeys = plugin\.curatedCategoryKeys/.test(main);
  ok("第一层投影 toPlugin 保留 categoryKeys", toPluginProjection);
  ok("第二层投影 marketplacePluginToView 保留 categoryKeys", viewProjection, `main.cjs 中共 ${toPluginHits} 处`);

  const chunks = app.paths.filter((p) => p.startsWith("dist/renderer/assets/") && p.endsWith(".js"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-chunks-"));
  let passed = 0;
  const bad = [];
  for (const p of chunks) {
    const source = app.read(p);
    if (source == null) continue;
    const out = path.join(dir, path.basename(p));
    fs.writeFileSync(out, source);
    try {
      execFileSync("node", ["--check", out], { stdio: "pipe" });
      passed += 1;
    } catch (error) {
      bad.push(`${path.basename(p)}: ${String(error.stderr ?? error).split("\n")[2] ?? "parse error"}`);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  // NB: the asar holds ~209 .js files in total; only the renderer assets are the chunks that were
  // ever syntax-checked. Do not conflate the two numbers.
  ok(`renderer chunk 逐个 node --check（${chunks.length} 个）`, bad.length === 0, bad.join(" | "));
  console.log(`     通过 ${passed}/${chunks.length}`);

  // esbuild escapes non-ASCII to \uXXXX, so grepping the raw bundle for Chinese text always misses.
  // Decode first — searching the raw bytes and concluding "the string isn't there" is a false alarm.
  const decoded = renderer.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const uiStrings = ["为你推荐", "查看全部", "管理插件和技能", "登录与凭据管理"];
  const absent = uiStrings.filter((t) => !decoded.includes(t));
  ok("市场 UI 文案在产物中（先还原 \\uXXXX 再匹配）", absent.length === 0, absent.length ? `缺: ${absent.join(", ")}` : "");
}

/* ---------------------------------------------------------- live checks ---- */

async function cdpDump(port, urlHint, expression) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.includes(urlHint));
  if (!page) throw new Error(`${port} 上找不到含 "${urlHint}" 的 page target`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const nextId = (() => { let n = 0; return () => ++n; })();
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId();
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
  };
  await new Promise((r) => { ws.onopen = r; });
  await send("Runtime.enable");
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  ws.close();
  if (result.exceptionDetails) throw new Error(String(result.exceptionDetails.exception?.description ?? "eval failed").slice(0, 400));
  return result.result.value;
}

// Walk the document in order: each heading opens a section, each row name belongs to the current one.
// A dialog left on some other page by an earlier probe would silently produce a different section set,
// so the script closes and reopens the dialog rather than trusting whatever state it finds.
const SECTIONS_EXPR = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Visible-only: a push-stack page keeps the previous level mounted, so a node that still has a
  // box is not necessarily the current level.
  const vis = (e) => {
    if (!e) return false;
    const r = e.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    return typeof e.checkVisibility === "function"
      ? e.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
      : !!e.offsetParent;
  };
  const visAllWithin = (root, sel) => [...root.querySelectorAll(sel)].filter(vis);
  const dlg = () => [...document.querySelectorAll('[role="dialog"]')]
    .find((x) => /市场|Marketplace/.test(x.getAttribute("aria-label") || ""));
  let d = dlg();
  if (d) { (document.querySelector('button[aria-label="关闭"]'))?.click(); await sleep(900); }
  d = dlg();
  if (!d) {
    const entry = [...document.querySelectorAll('button,[role="button"]')]
      .map((e) => ({ e, t: (e.getAttribute("aria-label") || "").trim() }))
      .find((x) => /连接应用|Connect apps/.test(x.t));
    entry?.e.click();
    for (let i = 0; i < 30 && !dlg(); i++) await sleep(250);
    d = dlg();
  }
  if (!d) return { err: "市场弹窗未打开" };
  // The catalog arrives asynchronously, and a dialog reopened by a previous probe can still be
  // mid-render. Retry the whole open until the section set is actually populated — otherwise the
  // dump reports only the container heading and every section looks "missing on the local build".
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (let i = 0; i < 20; i += 1) { if (d.querySelectorAll('[class*="row__name"]').length > 20) break; await sleep(700); }
    if (d.querySelectorAll('[class*="row__name"]').length > 20) break;
    (document.querySelector('button[aria-label="关闭"]'))?.click();
    await sleep(900);
    const entry = [...document.querySelectorAll('button,[role="button"]')]
      .map((e) => ({ e, t: (e.getAttribute("aria-label") || "").trim() }))
      .find((x) => /连接应用|Connect apps/.test(x.t));
    entry?.e.click();
    for (let i = 0; i < 30 && !dlg(); i += 1) await sleep(250);
    d = dlg();
    if (!d) return { err: "重开后市场弹窗仍不存在" };
  }
  const sections = [];
  let current = null;
  const walker = document.createTreeWalker(d, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (/^H[1-5]$/.test(node.tagName)) {
      const title = (node.innerText || "").trim();
      if (!title) continue;
      current = { title, names: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const className = typeof node.className === "string" ? node.className : "";
    if (/row__name/.test(className)) {
      const text = (node.innerText || "").trim();
      if (text && !current.names.includes(text)) current.names.push(text);
    }
  }
  // The section list alone does not prove the homepage *shape*. These three are the properties the
  // screenshot is actually read against: 查看全部 only appears when a section exceeds the 4-row
  // preview cap (which is why 支持, at 3 rows, has none), the marketplace wrapper is what positions the
  // grid, and a real scroll container is what makes "keep scrolling down" true rather than a claim.
  const seeAll = visAllWithin(d, "button").filter((b) => (b.textContent || "").trim() === "查看全部").length;
  const wrapper = d.querySelector(".sand-plugins__marketplace") != null;
  const scrollers = [d, ...d.querySelectorAll("*")]
    .filter((e) => e.getBoundingClientRect().height > 0 && e.scrollHeight > e.clientHeight + 20 && e.clientHeight > 100)
    .slice(0, 2)
    .map((e) => ({ scrollHeight: e.scrollHeight, clientHeight: e.clientHeight }));
  return { sections, seeAll, wrapper, scrollers };
})()`;

// CTA geometry. Four controls shipped with recipes that were plausible but wrong — every one of
// them passed typecheck, the whole suite, packaging and codesigning, and only the rendered pixels
// differed (行尾添加 32x24 vs official 46x26, 详情返回 36x28 vs 28x28, 查看源码 with its icon
// appended to the wrapper instead of the <a>, 分享 at 78x36 with no icon box). This expression
// measures all four on whichever app it is run against, and the two runs are diffed against each
// other rather than against hard-coded numbers, so a future upstream change moves the baseline
// instead of failing the check.
const CTA_EXPR = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round = (n) => Math.round(n * 100) / 100;
  const dlg = () => [...document.querySelectorAll('[role="dialog"]')]
    .find((x) => /市场|Marketplace/.test(x.getAttribute("aria-label") || ""));
  // Push-stack pages keep the previous level mounted, so a node that still has a box is not
  // necessarily the current level. Every read goes through vis().
  const vis = (e) => {
    if (!e) return false;
    const r = e.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    return typeof e.checkVisibility === "function"
      ? e.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
      : !!e.offsetParent;
  };
  const visAll = (sel, root = document) => [...root.querySelectorAll(sel)].filter(vis);
  const until = async (pred, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = pred(); if (v) return v; await sleep(250); }
    return null;
  };
  const box = (e) => { const r = e.getBoundingClientRect(); return round(r.width) + "x" + round(r.height); };
  const childKinds = (e) => [...e.childNodes].map((n) =>
    n.nodeType === 3 ? "text:" + n.textContent.trim() : n.tagName + "." + String(n.className).split(" ")[0]);

  let d = dlg();
  if (d) { (document.querySelector('button[aria-label="关闭"]'))?.click(); await sleep(900); d = dlg(); }
  if (!d) {
    const entry = [...document.querySelectorAll('button,[role="button"]')]
      .map((e) => ({ e, t: (e.getAttribute("aria-label") || "").trim() }))
      .find((x) => /连接应用|Connect apps/.test(x.t));
    entry?.e.click();
    for (let i = 0; i < 40 && !dlg(); i += 1) await sleep(250);
    d = dlg();
  }
  if (!d) return { err: "市场弹窗未打开" };
  // The catalog arrives asynchronously; poll for the rows rather than sleeping a fixed amount.
  const rows = await until(() => { const n = visAll(".sand-plugins-row__open", d); return n.length ? n : null; }, 40000);
  if (!rows) return { err: "行未渲染（catalog 未就绪）" };

  const out = { rowCount: rows.length };
  const trail = visAll(".sand-plugins-row__trailing button,.sand-plugins-row__trailing a",
    rows[0].closest("li") ?? rows[0].parentElement)[0] ?? null;
  if (trail) {
    const s = getComputedStyle(trail);
    out.rowTrailing = { text: (trail.textContent || "").trim(), size: box(trail), padding: s.padding,
      borderRadius: s.borderRadius, fontWeight: s.fontWeight, whiteSpace: s.whiteSpace, background: s.backgroundColor };
  }
  rows[0].click();
  const back = await until(() => visAll('button[aria-label="返回"]', d)[0] ?? null, 20000);
  if (!back) return { ...out, err: "未能进入详情页" };
  await sleep(900);
  out.detailBack = { size: box(back), borderRadius: getComputedStyle(back).borderRadius };
  const link = visAll("a[href]", d).find((a) => (a.textContent || "").trim().startsWith("查看源码"));
  if (link) {
    const icon = link.querySelector("i.ui-icon");
    // childKinds is the assertion that matters: the glyph has to be INSIDE the anchor, and
    // appending it to the wrapper span leaves a text-only <a> that still parses fine.
    out.viewSource = { size: box(link), childKinds: childKinds(link), iconSize: icon ? box(icon) : null };
  }
  const share = visAll("button", d).find((b) => (b.textContent || "").trim() === "分享");
  if (share) {
    const kit = share.querySelector("span[class*=sand-kit-icon]");
    const label = [...share.children].find((c) => c.tagName === "SPAN" && !String(c.className).includes("sand-kit-icon"));
    out.share = { size: box(share), childKinds: childKinds(share), iconSize: kit ? box(kit) : null,
      labelSize: label ? box(label) : null };
  }
  // Popping the detail level is not instantaneous, and the bar animates out — a 2s budget
  // turned a healthy back-stack into a false failure. Require BOTH halves: no back button
  // left, and the homepage rows back in the tree.
  (document.querySelector('button[aria-label="返回"]'))?.click();
  out.backStackWorks = await until(
    () => (visAll('button[aria-label="返回"]', d).length === 0 && visAll(".sand-plugins-row__open", d).length > 0) ? true : null,
    12000,
  ) != null;
  return out;
})()`;

console.log("\n■ 实机逐区块对拍（需要两个 app 同时带 CDP 端口运行）");
let officialSections = null;
let deployedSections = null;
let officialShape = null;
let deployedShape = null;
for (const [label, port, hint] of [["官方", OFFICIAL_CDP, OFFICIAL_URL_HINT], ["部署版", DEPLOYED_CDP, DEPLOYED_URL_HINT]]) {
  try {
    const dump = await cdpDump(port, hint, SECTIONS_EXPR);
    if (dump?.err) { ok(`${label} ${port} 读取`, false, dump.err); continue; }
    const byTitle = Object.fromEntries((dump.sections ?? []).map((s) => [s.title, s]));
    if (label === "官方") { officialSections = byTitle; officialShape = dump; }
    else { deployedSections = byTitle; deployedShape = dump; }
    ok(`${label} ${port} 读取成功`, true, `${Object.keys(byTitle).length} 个区块`);
  } catch (error) {
    ok(`${label} ${port} 可用`, false, String(error.message).slice(0, 120));
  }
}

if (officialSections && deployedSections) {
  const shared = Object.keys(officialSections).filter((t) => t in deployedSections);
  const exact = shared.filter((t) => officialSections[t].names.join("|") === deployedSections[t].names.join("|"));
  console.log(`\n     共有区块 ${shared.length} 个，逐行完全一致 ${exact.length} 个`);
  for (const title of shared) {
    const want = officialSections[title].names;
    const got = deployedSections[title].names;
    if (want.join("|") === got.join("|")) console.log(`       ✅ ${title}`);
    else console.log(`       ⚠️  ${title}\n            官方: ${want.join(" / ") || "—"}\n            本地: ${got.join(" / ") || "—"}`);
  }
  const onlyOfficial = Object.keys(officialSections).filter((t) => !(t in deployedSections));
  for (const title of onlyOfficial) console.log(`       ❌ ${title}（本地无此区块：官方: ${officialSections[title].names.join(" / ")}）`);
  console.log("\n     剩余差异请对照 docs/MARKETPLACE-066-EVIDENCE.md §18–§20 归因：本地 catalog 是官方");
  console.log("     catalog 的严格子集（少 11 条），1Password 不在任何一侧 catalog，为你推荐 因");
  console.log("     teamPopularity() 双方同为 0 —— 均属数据面，不是渲染行为差异。");

  console.log("\n     首页形状：");
  ok("查看全部 数量", officialShape.seeAll === deployedShape.seeAll, `官方 ${officialShape.seeAll} / 本地 ${deployedShape.seeAll}`);
  ok("市场包裹层存在", officialShape.wrapper === true && deployedShape.wrapper === true,
    `官方 ${officialShape.wrapper} / 本地 ${deployedShape.wrapper}`);
  // Not compared by equality: the two catalogs hold different numbers of rows, so scrollHeight
  // is expected to differ. What must hold is that the local page really scrolls.
  const s = deployedShape.scrollers[0];
  ok("可继续纵向滚动", s != null && s.scrollHeight > s.clientHeight,
    s ? `scrollHeight ${s.scrollHeight} / clientHeight ${s.clientHeight}（官方 ${officialShape.scrollers[0]?.scrollHeight ?? "—"} / ${officialShape.scrollers[0]?.clientHeight ?? "—"}）` : "未找到滚动容器");
}

// Catalog payload. The renderer can only bucket rows correctly if the curated key ARRAY survives
// both projections on the wire, and that field was silently dropped once already: the page passed
// typecheck, the suite, packaging and signing while every entry reported categoryKeys: []. Only a
// live read of window.desktop.mcp.catalog() on both apps shows it.
const CATALOG_EXPR = `(async () => {
  const raw = await window.desktop.mcp.catalog();
  const list = Array.isArray(raw) ? raw : (raw?.plugins ?? raw?.items ?? []);
  const withKeys = list.filter((p) => Array.isArray(p.categoryKeys) && p.categoryKeys.length > 0);
  const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Index EVERY identifying field, and never \`id\`. Two traps, both of which silently reported
  // "no difference" while there were ten or eleven:
  //   \`id\` is a numeric string ("657") — keying on it makes every named lookup miss on BOTH apps;
  //   \`name\` is the slug, but for some entries the readable label is only in \`displayName\` —
  //   oh-my-claudecode is in the catalog under the slug "t", with displayName "oh-my-claudecode".
  const byKey = new Map();
  for (const p of list) {
    for (const field of [p.name, p.pluginName, p.displayName]) {
      const k = norm(field);
      if (k && !byKey.has(k)) byKey.set(k, p);
    }
  }
  // "Is this entry present?" must be answered by \`id\`, never by name. The two projections do not
  // expose the same identifier fields — official carries \`pluginName\` ("notion-workspace") while
  // the local view does not, and official's slug for oh-my-claudecode is literally "t" — so a
  // name-keyed presence test reports entries as missing that are in fact present under another id.
  // One such false positive shipped an earlier draft of this script; it listed notion-workspace as
  // a locally-missing plugin when both apps return it as id 404.
  const ids = new Set(list.map((p) => String(p.id)));
  const named = {};
  for (const n of ["google-slides", "google-docs", "google-sheets", "onedrive", "outlook",
      "outlook-calendar", "sharepoint", "teams", "finance", "x-money", "oh-my-claudecode",
      "1password", "canva", "bird", "adapter", "notion", "figma", "gmail"]) {
    const hit = byKey.get(norm(n));
    named[n] = hit ? { id: String(hit.id), present: ids.has(String(hit.id)) } : null;
  }
  return {
    total: list.length,
    withCategoryKeys: withKeys.length,
    isUserOwnedTrue: list.filter((p) => p.publisher?.isUserOwned === true).length,
    distinctCategoryKeys: [...new Set(withKeys.flatMap((p) => p.categoryKeys))].sort(),
    named,
  };
})()`;

console.log("\n■ catalog payload 对拍");
const catRuns = {};
for (const [label, port, hint] of [["官方", OFFICIAL_CDP, OFFICIAL_URL_HINT], ["部署版", DEPLOYED_CDP, DEPLOYED_URL_HINT]]) {
  try {
    const dump = await cdpDump(port, hint, CATALOG_EXPR);
    if (!dump || dump.total === 0) { ok(`${label} catalog 读取`, false, "catalog 为空，先查桥是否可用"); continue; }
    catRuns[label] = dump;
    ok(`${label} catalog 读取成功`, true, `${dump.total} 条，其中 ${dump.withCategoryKeys} 条带 categoryKeys`);
  } catch (error) {
    ok(`${label} catalog 可用`, false, String(error.message).slice(0, 120));
  }
}

if (catRuns["官方"] && catRuns["部署版"]) {
  const o = catRuns["官方"], d = catRuns["部署版"];
  // The load-bearing claim: the same curated-key vocabulary reaches the renderer on both sides. A
  // key missing here is exactly what made an entry bucket into nothing and get silently dropped.
  const missingKeys = o.distinctCategoryKeys.filter((k) => !d.distinctCategoryKeys.includes(k));
  ok("categoryKeys 取值集合一致", missingKeys.length === 0,
    missingKeys.length ? `本地缺 ${missingKeys.join(" ")}` : `${d.distinctCategoryKeys.length} 个 key 两侧相同`);
  ok("categoryKeys 覆盖率无回退", d.withCategoryKeys > 0, `本地 ${d.withCategoryKeys}/${d.total}（该字段修复前为 0）`);
  ok("isUserOwned 计数一致", o.isUserOwnedTrue === d.isUserOwnedTrue, `官方 ${o.isUserOwnedTrue} / 本地 ${d.isUserOwnedTrue}`);
  // Total count and per-entry presence are a known DATA gap, not a behaviour difference: the local
  // catalog is a strict subset of upstream's. Report the exact short list instead of failing.
  const missingEntries = Object.keys(o.named)
    .filter((k) => o.named[k] && !d.named[k]?.present)
    .map((k) => `${k}(id ${o.named[k].id})`);
  const extraEntries = Object.keys(d.named).filter((k) => d.named[k] && !o.named[k]?.present);
  console.log(`     catalog 总数 官方 ${o.total} / 本地 ${d.total} —— 数据面：本地为官方严格子集`);
  console.log(`     本地缺失条目: ${missingEntries.length ? missingEntries.join(" ") : "（无）"}`);
  if (extraEntries.length) console.log(`     本地多出的条目: ${extraEntries.join(" ")}`);
}

console.log("\n■ CTA 几何对拍（同一批控件，两侧实测互比，不用硬编码数字）");
const ctaRuns = {};
for (const [label, port, hint] of [["官方", OFFICIAL_CDP, OFFICIAL_URL_HINT], ["部署版", DEPLOYED_CDP, DEPLOYED_URL_HINT]]) {
  try {
    const dump = await cdpDump(port, hint, CTA_EXPR);
    if (dump?.err) { ok(`${label} CTA 读取`, false, dump.err); continue; }
    ctaRuns[label] = dump;
    ok(`${label} CTA 读取成功`, true, `${dump.rowCount} 行`);
  } catch (error) {
    ok(`${label} CTA 可用`, false, String(error.message).slice(0, 120));
  }
}

if (ctaRuns["官方"] && ctaRuns["部署版"]) {
  // Flatten to the values that actually decide the pixels. Text content differs by design (the
  // two catalogs are different), so row names are deliberately excluded.
  const FIELDS = [
    ["行尾 添加/连接 尺寸", "rowTrailing", "size"],
    ["行尾 添加 padding", "rowTrailing", "padding"],
    ["行尾 添加 圆角", "rowTrailing", "borderRadius"],
    ["行尾 添加 字重", "rowTrailing", "fontWeight"],
    ["行尾 添加 底色", "rowTrailing", "background"],
    ["详情 返回 尺寸", "detailBack", "size"],
    ["查看源码 尺寸", "viewSource", "size"],
    ["查看源码 外链图标", "viewSource", "iconSize"],
    ["分享 尺寸", "share", "size"],
    ["分享 图标盒", "share", "iconSize"],
    ["分享 label", "share", "labelSize"],
  ];
  for (const [name, group, field] of FIELDS) {
    const want = ctaRuns["官方"][group]?.[field] ?? "(缺失)";
    const got = ctaRuns["部署版"][group]?.[field] ?? "(缺失)";
    ok(name, want === got, want === got ? `${got}` : `官方 ${want} / 本地 ${got}`);
  }
  // Structure, not just size: the 分享 icon box must precede the label, and the 查看源码 glyph must
  // be a child of the anchor. Both defects shipped while the button recipe was byte-identical.
  const kinds = (run, group) => (run[group]?.childKinds ?? []).join("|");
  ok("分享 子节点顺序", kinds(ctaRuns["官方"], "share") === kinds(ctaRuns["部署版"], "share"),
    kinds(ctaRuns["部署版"], "share"));
  const iconInside = (run) => (run.viewSource?.childKinds ?? []).some((k) => /^I\.ui-icon$/.test(k));
  ok("查看源码 图标在 <a> 内", iconInside(ctaRuns["官方"]) && iconInside(ctaRuns["部署版"]),
    kinds(ctaRuns["部署版"], "viewSource"));
  ok("详情返回后回到首页", ctaRuns["部署版"].backStackWorks === true);
}

console.log(`\n${failures === 0 ? "✅ 全部核验通过" : `❌ ${failures} 项核验未通过`}\n`);

process.exit(failures === 0 ? 0 : 1);
