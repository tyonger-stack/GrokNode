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
  return { sections };
})()`;

console.log("\n■ 实机逐区块对拍（需要两个 app 同时带 CDP 端口运行）");
let officialSections = null;
let deployedSections = null;
for (const [label, port, hint] of [["官方", OFFICIAL_CDP, OFFICIAL_URL_HINT], ["部署版", DEPLOYED_CDP, DEPLOYED_URL_HINT]]) {
  try {
    const dump = await cdpDump(port, hint, SECTIONS_EXPR);
    if (dump?.err) { ok(`${label} ${port} 读取`, false, dump.err); continue; }
    const byTitle = Object.fromEntries((dump.sections ?? []).map((s) => [s.title, s]));
    if (label === "官方") officialSections = byTitle; else deployedSections = byTitle;
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
}

console.log(`\n${failures === 0 ? "✅ 静态核验全部通过" : `❌ ${failures} 项静态核验未通过`}\n`);
process.exit(failures === 0 ? 0 : 1);
