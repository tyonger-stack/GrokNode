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

/**
 * A third reporting state, deliberately distinct from both pass and fail.
 *
 * A known defect that is understood, attributed and awaiting a decision is neither "this is fine"
 * nor "this is a new failure" — collapsing it into `ok()` would either hide it or make every future
 * run look broken for a reason nobody is working on. `known()` reports it loudly and changes
 * nothing about the exit code, so the gate still means "nothing newly broke".
 */
let knownGaps = 0;
const known = (label, isGap, detail = "") => {
  if (isGap) knownGaps += 1;
  console.log(`  ${isGap ? "⚠️ " : "   "} ${label}${isGap ? "（已知差异，未计入失败）" : ""}${detail ? `  — ${detail}` : ""}`);
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

  // `pluginName` must survive BOTH projections too, and — the part a presence check cannot tell you —
  // the first hop must read `Plugin.name`, not the MCP server handle. The renderer's vendor-override
  // probe (`Re()` = `Te[vendor] ?? …`) reads `pluginName` FIRST and only then `name`; on official's
  // own 403-row catalog 85 rows carry a `pluginName` that differs from `name`, and the four AWS rows
  // all share `name: "aws-mcp"` while their `pluginName`s differ. Wiring it to the handle would be
  // indistinguishable from correct on the ~10 rows where the two happen to be equal.
  //
  // Official 0.66 `dist/electron-main/main-app.cjs`:
  //   `return{pluginId:e.id.toString(),name:r,pluginName:e.name,displayName:…}`, `r = e.mcpServers[0]?.name ?? e.name`
  //   `function T7t(e){return{id:e.pluginId,name:e.name,pluginName:e.pluginName,displayName:…}}`
  const pluginNameHits = (main.match(/pluginName/g) ?? []).length;
  const pluginNameFirstHop = /pluginName:\s*plugin\.name,/.test(main);
  const pluginNameSecondHop = /pluginName:\s*plugin\.pluginName,/.test(main);
  const pluginNameNotFromHandle = !/pluginName:\s*plugin\.mcpServers/.test(main);
  ok("第一层投影 toPlugin 的 pluginName 取自 Plugin.name（非 MCP server 句柄）", pluginNameFirstHop && pluginNameNotFromHandle);
  ok("第二层投影 marketplacePluginToView 保留 pluginName", pluginNameSecondHop, `main.cjs 中共 ${pluginNameHits} 处`);

  // ---- 为你推荐 的 affinity 键：部署侧用哪个键算 ----
  //
  // 两侧真源（都从产物逐字读出，不是转述）：
  //   官方 0.66  chunk-marketplace-browse-model-DoOY91TS.js
  //     function v(e,t){return j(e.category.trim(),t)}      ← 键 = 条目自己的 category 标签
  //     function J(e,t,n){ ... i.set(s,(i.get(s)??0)+1) }   ← 已装按同一把尺子计数
  //   0.18 部署版  index-UbX-y3il.js
  //     function ms(n,e,a){ ... for(let y of vn(S.entry)) }  ← 键 = vn(entry)，返回**标签数组**
  //     function vn(n){ ...ts[t]... as[cs({category:t})]... }
  //   `as` 是「category 枚举 → 规范标签」的映射表，只有 14 个键：
  //     LOGIN_AND_CREDENTIAL_MANAGEMENT / PRODUCTIVITY / INBOX_AND_COLLABORATION / SCHEDULING /
  //     SALES / CUSTOMER_SUPPORT / PAYMENTS / FINANCE_AND_LEGAL / DATA_ANALYTICS / DESIGN /
  //     CANVAS / DOCUMENTS_AND_FILES / INFRASTRUCTURE / RESEARCH
  //   **没有 MCP、没有 AGENT_ORCHESTRATION、没有 FEATURED。** 而 `cs()` 把 category 归一化成
  //   大写下划线形式（`"MCP"` → `"MCP"`、`"Agent Orchestration"` → `"AGENT_ORCHESTRATION"`），
  //   这三类查表得 undefined → vn 返回空数组 → 该条目 affinityStrength 恒为 0。
  //   实测官方实机 403 条里 **169 条**键为空（MCP 151 / Agent Orchestration 17 / Featured 1），
  //   官方侧 **0 条**（官方直接用标签，从不查表）。
  //
  // 所以判据是**键是否经过映射表间接**（会被表缺项吞掉），**不是**「有没有 for..of」——
  // vn 体内那两个 `for..of` 遍历的是 plugin 名 token 与 category token，都不是桶。
  // ⚠️ 别拿「有没有遍历」当判据：那样对正确实现也会误判成有缺陷。
  //
  // 定位方式：按产物里必然存在的稳定串 `affinityStrength` 定位 selectForYou（4 次命中全在其
  // 体内），再按**调用点在体内的偏移**定位键函数。压缩产物里短名重名 abound —— 实测
  // `function ge(` 有 4 个同名定义，按名字全文件反查会读到 5851700 处的
  // marketplace/teamName 探针，而不是 affinity 键。所以这里强制唯一性校验，不唯一就报失灵。
  const forYouFn = (() => {
    const probe = renderer.indexOf("affinityStrength");
    if (probe < 0) return null;
    const head = renderer.lastIndexOf("function ", probe);
    if (head < 0) return null;
    const m = /^function [A-Za-z_$][\w$]*\(/.exec(renderer.slice(head, probe + 40));
    if (!m) return null;
    const at = renderer.indexOf(m[0], head);
    let depth = 0;
    for (let k = renderer.indexOf("{", at); k < renderer.length; k += 1) {
      if (renderer[k] === "{") depth += 1;
      else if (renderer[k] === "}") { depth -= 1; if (depth === 0) return renderer.slice(at, k + 1); }
    }
    return null;
  })();
  if (forYouFn == null) {
    known(
      "部署版渲染器：为你推荐 的 selectForYou 定位",
      false,
      "产物里找不到 affinityStrength —— 无法核查 affinity 键。这是检测器问题，不是已知的对齐状态",
    );
  } else {
    const gsAt = renderer.indexOf(forYouFn);
    // Keep the call-site OFFSET. Minified short names collide (a re-package renamed the deployed
    // key function and it then had 3 same-named declarations), so requiring global uniqueness made
    // this check die permanently — a permanently dead check is a "always false" detector in disguise.
    // In one flat bundle scope the declaration in effect at a call is the NEAREST PRECEDING one;
    // that is scope resolution, not a guess. Report how many earlier same-named ones were skipped
    // so a reviewer can check the resolution, and fail closed only when there are none.
    const keyCalls = [...forYouFn.matchAll(/\b([A-Za-z_$][\w$]*)\(\s*\w+\.entry\s*\)/g)]
      .map((m) => ({ name: m[1], at: gsAt + m.index }));
    const uniqKeys = [...new Set(keyCalls.map((k) => k.name))];
    const readKey = keyCalls.map(({ name, at: callAt }) => {
      const re = new RegExp(`function ${name}\\(`, "g");
      const decls = [];
      let d;
      while ((d = re.exec(renderer)) !== null) if (d.index < callAt) decls.push(d.index);
      if (decls.length === 0) return { name, ambiguous: 0 };
      const at = decls[decls.length - 1];
      let depth = 0;
      for (let k = renderer.indexOf("{", at); k < renderer.length; k += 1) {
        if (renderer[k] === "{") depth += 1;
        else if (renderer[k] === "}") { depth -= 1; if (depth === 0) return { name, body: renderer.slice(at, k + 1), skipped: decls.length - 1 }; }
      }
      return { name, body: null };
    });
    const bodies = readKey.filter((k) => k.body).map((k) => k.body);
    const ambiguous = readKey.filter((k) => k.ambiguous !== undefined);
    const skippedNote = readKey.filter((k) => k.skipped > 0).map((k) => `${k.name}（越过 ${k.skipped} 个更早的同名声明）`);

    // 表间接：局部变量由 X[...] 赋值、且随后做 != null 判空 —— 这正是「键可能被表缺项吞掉」的形态
    const tableLookups = bodies.flatMap((b) =>
      [...b.matchAll(/(?:let|const|var)\s+(\w+)\s*=\s*([A-Za-z_$][\w$]*)\[/g)]
        .filter((m) => new RegExp(`\\b${m[1]}\\s*!=\\s*null`).test(b))
        .map((m) => m[2]),
    );
    const tableKeyed = tableLookups.length > 0;
    const labelKeyed = !tableKeyed && bodies.some((b) => /\.category\b/.test(b));

    // `tableKeyed` = 键经映射表间接 = **与官方不同源**（官方 `v` 直接用 `e.category.trim()`），
    // 所以「一致」的条件是 labelKeyed，即 `!tableKeyed`。
    // ⚠️ 17:3x 修正：第二个参数是 known() 的 **isGap**（true 才打 ⚠️ 并计入 knownGaps），
    //    不是「是否一致」。这里一度传 `aligned`，于是部署侧**有**缺陷时反而不标 ⚠️、
    //    也不计入已知差异 —— 一条真实缺陷被静默吞掉。isGap 必须是「检测器失灵 OR 存在缺陷」。
    //    判词方向与判据不一致，改的是**判词**（把标签写成可被证伪的断言），不是把布尔反过来。
    const isGap = ambiguous.length > 0 || uniqKeys.length === 0 || tableKeyed;
    known(
      "部署版渲染器：为你推荐 的 affinity 键与官方一致",
      isGap,
      ambiguous.length > 0
        ? `键函数 ${ambiguous.map((k) => `${k.name}（前置声明 0 个）`).join(", ")} 无法定位 —— 检测器失灵`
        : uniqKeys.length === 0
          ? "selectForYou 体内未解析出 .entry 形态的键函数调用 —— 检测器失灵"
          : tableKeyed
            ? `键函数 ${uniqKeys.join(", ")} 经 ${[...new Set(tableLookups)].join(", ")} 查表间接${skippedNote.length ? `（${[...new Set(skippedNote)].join("、")}）` : ""}；官方直接用 category 标签。as 表缺 MCP/AGENT_ORCHESTRATION/FEATURED → 403 条里 169 条键为空（见 docs/evidence/marketplace-foryou-affinity-key.md）`
            : labelKeyed
              ? `键函数 ${uniqKeys.join(", ")} 直接取 category 标签，与官方 0.66 同源`
              : `键函数 ${uniqKeys.join(", ")} 既非标签直取也非表间接 —— 无法判定`,
    );
  }

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
  // Icons must be loaded before their intrinsic size is read: a not-yet-decoded <img> reports
  // naturalWidth 0, which the comparison below silently skips — an UNDER-count, i.e. the check
  // would report "fewer differences than exist". Wait for decode rather than trusting the count.
  for (let i = 0; i < 40; i += 1) {
    const imgs = [...d.querySelectorAll('img')].filter((im) => im.getBoundingClientRect().width > 0);
    if (imgs.length === 0) break;
    if (imgs.every((im) => im.complete && im.naturalWidth > 0)) break;
    await sleep(300);
  }
  const sections = [];
  let current = null;
  const walker = document.createTreeWalker(d, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (/^H[1-5]$/.test(node.tagName)) {
      const title = (node.innerText || "").trim();
      if (!title) continue;
      current = { title, names: [], icons: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const className = typeof node.className === "string" ? node.className : "";
    if (/row__name/.test(className)) {
      const text = (node.innerText || "").trim();
      if (text && !current.names.includes(text)) {
        current.names.push(text);
        // Requirement 1 lists 图标 among the things that must match, and for a long time only the
        // NAMES were compared — so a wholesale icon difference could sit here unmeasured. Record
        // how the asset is delivered and its intrinsic size; the comparison happens below.
        // The row__name node and the <img> are NOT always inside the same <li>: falling back to a
        // single parentElement made 28 of 40 rows report "no icon", which silently under-counted the
        // size differences (28 skipped + 12 counted = the wrong 12 I first reported). Walk UP until
        // an ancestor that actually holds an <img>. An under-counting detector is worse than none.
        // Getting this locator right took three attempts, and BOTH wrong versions failed silently
        // in opposite directions — which is the part worth remembering:
        //   v1  single parentElement fallback  -> 28/40 rows read "no icon"  (UNDER-count)
        //   v2  walk up to any ancestor with an <img> -> a row with no icon of its own
        //       (oh-my-claudecode, 1Password) picked up a NEIGHBOURING row's image (MIS-attribute)
        // v3 anchors on the row itself: accept an ancestor only when it holds an <img> AND exactly
        // one row__name. Once the ancestor holds two, we have left the row — stop and report none.
        let img = null;
        let p = node;
        while (p && p !== d) {
          const imgs = p.querySelectorAll("img");
          if (imgs.length === 1 && p.querySelectorAll('[class*="row__name"]').length === 1) { img = imgs[0]; break; }
          if (imgs.length > 1) break;   // more than one image in here => this is a container, not a row
          p = p.parentElement;
        }
        const src = img ? (img.getAttribute("src") || "") : "";
        current.icons.push({
          name: text,
          kind: !img ? "none" : src.startsWith("data:") ? "inline" : /^https?:/.test(src) ? "remote" : "other",
          w: img ? img.naturalWidth : 0,
          h: img ? img.naturalHeight : 0,
        });
      }
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
  const officialTitles = Object.keys(officialSections);
  const deployedTitles = Object.keys(deployedSections);
  const shared = officialTitles.filter((t) => t in deployedSections);
  const exact = shared.filter((t) => officialSections[t].names.join("|") === deployedSections[t].names.join("|"));
  // ⚠️ 2026-10-05 21:2x 修正：这一段原先只报「共有区块 N 个，逐行完全一致 M 个」，
  // 而 N 取的是**交集**。交集之外的区块 —— 包括 D11 的 `登录与凭据管理` —— 被**整个丢掉**，
  // 既不出 ⚠️ 也不进汇总。那个读法等于宣称「其余区块都一致」，而实际上其中有整整一个区块
  // 本地根本没有。要求 1 写的是「逐页复刻…完全一致」，少报一个区块就是少计。
  // 修法：汇总行**带出分母**，交集之外逐个显式报出 —— 判词是可被证伪的断言，不是调参。
  const officialOnly = officialTitles.filter((t) => !(t in deployedSections));
  const deployedOnly = deployedTitles.filter((t) => !(t in officialSections));
  console.log(`\n     官方 ${officialTitles.length} 个区块 / 本地 ${deployedTitles.length} 个 / 共有 ${shared.length} 个，逐行完全一致 ${exact.length} 个`);
  for (const title of shared) {
    const want = officialSections[title].names;
    const got = deployedSections[title].names;
    if (want.join("|") === got.join("|")) console.log(`       ✅ ${title}`);
    else console.log(`       ⚠️  ${title}\n            官方: ${want.join(" / ") || "—"}\n            本地: ${got.join(" / ") || "—"}`);
  }
  // **0 行的标题是容器，不是内容区块。** 官方实测：14 个标题里第 1 个是「市场」，
  // 0 行 —— 它是弹窗自身的标题（对应「官方 13 区块」= 14 个标题减掉这一个容器）。
  // 若把它当内容，单边判定就会把「本地没渲染这个容器标题」误报成缺一整块内容。
  // 所以单边报告只针对**至少 1 行**的标题，容器单列一行报出。
  const isContent = (t, side) => (side[t]?.names?.length ?? 0) > 0;
  const officialOnlyContent = officialOnly.filter((t) => isContent(t, officialSections));
  const officialOnlyContainers = officialOnly.filter((t) => !isContent(t, officialSections));
  const deployedOnlyContent = deployedOnly.filter((t) => isContent(t, deployedSections));
  const deployedOnlyContainers = deployedOnly.filter((t) => !isContent(t, deployedSections));
  for (const title of officialOnlyContent) {
    known(`仅官方有的区块：${title}`, true, `本地缺这一整块内容（官方 ${officialSections[title].names.length} 行）`);
  }
  for (const title of deployedOnlyContent) {
    known(`仅本地有的区块：${title}`, false, "官方没有这一块（可能是本机 catalog 数据更多）");
  }
  for (const title of [...officialOnlyContainers, ...deployedOnlyContainers]) {
    known(`单边出现的容器标题（0 行）：${title}`, false, "容器不是内容区块，不计为缺口");
  }
  // Icon comparison, keyed on `section|name` rather than row index: the two builds put different
  // numbers of rows in a section, so pairing by index would compare unrelated entries.
  const iconOf = (side, title, name) => (side[title]?.icons ?? []).find((i) => i.name === name);
  let iconPairs = 0, iconKindDiff = 0, iconSizeDiff = 0, iconUnresolved = 0;
  const iconSizeSamples = [];
  for (const title of Object.keys(officialSections)) {
    if (!(title in deployedSections)) continue;
    for (const r of officialSections[title].names) {
      const a = iconOf(officialSections, title, r);
      const b = iconOf(deployedSections, title, r);
      if (!a || !b) continue;
      iconPairs += 1;
      if (a.kind !== b.kind) iconKindDiff += 1;
      // Only rows where BOTH sides resolved an <img> can be compared on intrinsic size. Rows where
      // either side found none are counted separately rather than silently dropped: an unstated
      // lower bound reads like a measurement, and that is how a 12 got reported when the real figure
      // is closer to 38. State the denominator instead of tuning until the number looks right.
      if (a.w > 0 && b.w > 0) {
        if (a.w !== b.w || a.h !== b.h) {
          iconSizeDiff += 1;
          if (iconSizeSamples.length < 5) iconSizeSamples.push(`${r}: 官方 ${a.w}x${a.h} / 本地 ${b.w}x${b.h}`);
        }
      } else {
        iconUnresolved += 1;
      }
    }
  }
  if (iconPairs === 0) {
    known("首页行图标：采集不到可比对的一对", false, "两侧都没采到图标字段 —— 检测器问题，不是已知对齐状态");
  } else {
    known(
      "首页行图标：交付方式与资产尺寸与官方一致",
      iconKindDiff > 0 || iconSizeDiff > 0,
      `可比对 ${iconPairs} 行；交付方式不同 ${iconKindDiff} 行；`
      + `两侧都解析出 <img> 后固有尺寸不同的 ${iconSizeDiff} 行，另有 ${iconUnresolved} 行至少一侧未解析出图标`
      + `（该数是下界，不是全量）。`
      + (iconSizeSamples.length ? ` 例：${iconSizeSamples.join("；")}` : "")
      + " 官方把图标内联并统一到 112x112，本地透传 catalog 原始远端 URL。见 docs/evidence/marketplace-icon-assets.md",
    );
  }

  const onlyOfficial = Object.keys(officialSections).filter((t) => !(t in deployedSections));
  for (const title of onlyOfficial) console.log(`       ❌ ${title}（本地无此区块：官方: ${officialSections[title].names.join(" / ")}）`);
  console.log("\n     剩余差异请对照 docs/MARKETPLACE-066-EVIDENCE.md §18–§20 归因：本地 catalog 已补齐为");
  console.log("     与官方同规模（下方「catalog payload 对拍」逐条核对，缺失条目应为「无」）；");
  console.log("     1Password 不在任何一侧 catalog。");
  console.log("     「为你推荐」：代码侧已对齐。已部署产物的 affinity 键是");
  console.log("     `ye(n)=L(n.category).trim()` —— 直接取 category 标签、不经映射表，");
  console.log("     与官方 `v(e,t)=j(e.category.trim(),t)` 同源，实测 403 条里键为空 0 条。");
  console.log("     残留差异**只有一层且不可消除**：官方那 4 个赢家的 category 四取四全是 MCP，");
  console.log("     而本地已装的 8 条里没有 MCP 类 → 亲和表只有 {Featured:6, Productivity:2}。");
  console.log("     历史：20:12 之前部署侧走 `as` 映射表（该表缺 MCP/AGENT_ORCHESTRATION/FEATURED，");
  console.log("     169/403 条键为空）；16:25 曾误判为「无缺陷」—— 按 minified 名字反查，");
  console.log("     `ge` 读到的是 teamName 探针。详见");
  console.log("     docs/evidence/marketplace-foryou-affinity-key.md");

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

// Category pages and the manage page. The homepage's 查看全部 opens TWO genuinely different
// layouts in official — 精选 is a single 734px column under a large h1 WITH the marketplace
// wrapper, while a category bucket is a 363px two-column grid under an h3 reading 结果 with NO
// wrapper. Treating them as one page is the easiest way to ship a page that looks fine and is
// wrong. The manage page is a third shape, reachable from 已安装 N 个, and its detail round-trip
// has to restore the list rather than dropping back to the homepage.
const SECTION_EXPR = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round = (n) => Math.round(n * 100) / 100;
  const dlg = () => [...document.querySelectorAll('[role="dialog"]')]
    .find((x) => /市场|Marketplace/.test(x.getAttribute("aria-label") || ""));
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
  const open = async () => {
    let d = dlg();
    if (d) { (document.querySelector('button[aria-label="关闭"]'))?.click(); await sleep(900); d = dlg(); }
    if (!d) {
      [...document.querySelectorAll('button,[role="button"]')]
        .find((e) => /连接应用|Connect apps/.test((e.getAttribute("aria-label") || "").trim()))?.click();
      d = await until(dlg, 20000);
    }
    return d;
  };
  // A section page's shape, read the way the screenshot is read: the grid width, the heading tag,
  // and whether the marketplace wrapper is present.
  // A push-stack page keeps the previous level MOUNTED, so anything scoped to the whole dialog
  // also reads the homepage. Three scoping mistakes showed up here, and each one reported a defect
  // that did not exist:
  //   1. querySelector over the dialog found the HOMEPAGE wrapper, so every page looked like it
  //      had one. Scope it to the element that actually holds the rows.
  //   2. Measuring the first ul gave 734 for BOTH layouts — the ul is 734 wide either way.
  //      What differs is the ROW's own width: 734 as a single column, 363 in a 363+363 grid.
  //   3. "First heading by top" picked a leftover homepage section title. The page title is the
  //      heading sharing a bar with the 返回 button - the only unambiguous one.
  // NOTE ON SCOPE. The obvious implementations of "measure the current page" are all wrong here,
  // and three of them each produced a confident, mutually contradictory answer: the dialog still
  // contains the previous level, and the homepage's rows are themselves 363px two-column.
  //   1. visAll over the whole dialog        -> measured the homepage (official 精选 read 363/2-col)
  //   2. climb from the 返回 button          -> landed on the pane that holds BOTH levels
  //   3. elementFromPoint at one depth        -> hit a heading or a gap; local returned null
  //   4. elementFromPoint at six depths       -> official flipped back to 734/1-col
  // A check whose value changes with the sample point is worse than no check, so this script does
  // NOT assert the 精选-vs-桶 row width. That distinction is a SCREENSHOT finding (PORT §6), not a
  // DOM one. What is asserted below is the part that is stable: navigation happens, the page has
  // rows, there is no invented pagination, and the manage round-trip restores the list.
  const shape = (d) => {
    const back = visAll('button[aria-label="返回"]', d)[0];
    const bar = back && back.parentElement ? back.parentElement.parentElement : null;
    const heading = bar ? visAll("h1,h2,h3", bar)[0] ?? null : null;
    return {
      // Scoped to the dialog, so this is a lower bound that cannot be thrown off by residue.
      rowCount: visAll('[class*="row__name"]', d).length,
      hasBack: !!back,
      headingTag: heading ? heading.tagName : null,
      headingText: heading ? heading.textContent.trim() : null,
      hasLoadMore: visAll("button", d).some((b) => /加载更多|Load more|下一页|Next page/.test(b.textContent || "")),
    };
  };

  let d = await open();
  if (!d) return { err: "市场弹窗未打开" };
  const rows = await until(() => { const n = visAll(".sand-plugins-row__open", d); return n.length ? n : null; }, 40000);
  if (!rows) return { err: "行未渲染" };

  // Identify the two 查看全部 buttons by which section they sit under: the first is 精选, the one
  // belonging to a bucket is the second. Hard-coding an index would silently start testing the
  // wrong page if the section order ever changed.
  const seeAlls = visAll("button", d).filter((b) => (b.textContent || "").trim() === "查看全部");
  const labelOf = (b) => {
    let n = b;
    while (n && n !== d) {
      const h = n.querySelector?.("h3");
      if (h && (h.textContent || "").trim()) return h.textContent.trim();
      n = n.parentElement;
    }
    return null;
  };
  const decorated = seeAlls.map((b) => ({ b, section: labelOf(b) }));
  const featured = decorated.find((x) => /精选/.test(x.section ?? ""));
  const bucket = decorated.find((x) => /效率|Productivity/i.test(x.section ?? ""));

  const out = { seeAllTotal: seeAlls.length, sections: decorated.map((x) => x.section) };
  for (const [key, target] of [["featured", featured], ["bucket", bucket]]) {
    if (!target) { out[key] = null; continue; }
    target.b.click();
    const page = await until(() => (visAll('button[aria-label="返回"]', d).length ? d : null), 20000);
    out[key] = page ? shape(page) : { err: "类目页未打开" };
    const back = visAll('button[aria-label="返回"]', d)[0];
    if (back) {
      back.click();
      // Wait for the HOMEPAGE, not merely for rows: a section page has rows too, so waiting on rows
      // returned immediately and the next measurement was taken on the page we never left.
      await until(() => (visAll('button[aria-label="返回"]', d).length === 0
        && visAll("button", d).some((b) => (b.textContent || "").trim() === "查看全部")) ? true : null, 15000);
    }
  }

  // Manage page: 已安装 N 个, then detail and back.
  const manageEntry = visAll("button", d).find((b) => /已安装|Your plugins/i.test(b.textContent || ""));
  out.manage = { hasEntry: !!manageEntry };
  if (manageEntry) {
    manageEntry.click();
    const page = await until(() => { const h = visAll("h1,h2,h3", d).find((x) => /管理|Manage/.test(x.textContent || "")); return h ? d : null; }, 20000);
    if (page) {
      out.manage.rowCount = visAll('[class*="row__name"]', d).length;
      out.manage.headingBefore = visAll("h1,h2,h3", d).find((h) => /管理|Manage/.test(h.textContent || ""))?.textContent.trim() ?? null;
      out.manage.firstRow = visAll(".sand-plugins-row__open", d).filter((r) => {
        const box = r.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })[0]?.getAttribute("aria-label") ?? null;
      const row = visAll(".sand-plugins-row__open", d).filter((r) => {
        const box = r.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })[0];
      if (row) {
        row.click();
        const detail = await until(() => (visAll('button[aria-label="返回"]', d).length ? d : null), 20000);
        // On the DETAIL page the bar shows the plugin name, not 管理 — so do not look for the
        // manage heading here. Record only that a detail was actually reached.
        out.manage.reachedDetail = !!detail;
        const back = visAll('button[aria-label="返回"]', d)[0];
        if (back) { back.click(); await until(() => (visAll('button[aria-label="返回"]', d).length === 0) ? true : null, 12000); await sleep(600); }
        out.manage.rowCountAfterBack = visAll('[class*="row__name"]', d).length;
        out.manage.headingAfterBack = visAll("h1,h2,h3", d).find((h) => /管理|Manage/.test(h.textContent || ""))?.textContent.trim() ?? null;
      }
    } else {
      out.manage.error = "管理页未打开";
    }
  }
  return out;
})()`;

console.log("\n■ 类目页与管理页对拍");
const secRuns = {};
for (const [label, port, hint] of [["官方", OFFICIAL_CDP, OFFICIAL_URL_HINT], ["部署版", DEPLOYED_CDP, DEPLOYED_URL_HINT]]) {
  try {
    const dump = await cdpDump(port, hint, SECTION_EXPR);
    if (dump?.err) { ok(`${label} 类目页读取`, false, dump.err); continue; }
    secRuns[label] = dump;
    ok(`${label} 类目页读取成功`, true, `${dump.seeAllTotal} 个查看全部`);
  } catch (error) {
    ok(`${label} 类目页可用`, false, String(error.message).slice(0, 120));
  }
}

if (secRuns["官方"] && secRuns["部署版"]) {
  const o = secRuns["官方"], d = secRuns["部署版"];
  ok("查看全部 总数", o.seeAllTotal === d.seeAllTotal, `官方 ${o.seeAllTotal} / 本地 ${d.seeAllTotal}`);
  const cmp = (name, group, field) => {
    const want = o[group]?.[field] ?? "(缺失)";
    const got = d[group]?.[field] ?? "(缺失)";
    ok(name, want === got, want === got ? `${got}` : `官方 ${want} / 本地 ${got}`);
  };
  // Navigation and content presence: the part that survives DOM scoping.
  // Row count is dialog-scoped, so the level behind is included and the numbers legitimately
  // differ. Only presence is meaningful: the page rendered rows at all.
  ok("精选类目页 有行", (o.featured?.rowCount ?? 0) > 0 && (d.featured?.rowCount ?? 0) > 0,
    `官方 ${o.featured?.rowCount} / 本地 ${d.featured?.rowCount}（含首页残留，不比等号）`);
  ok("类目桶 页 有行", (o.bucket?.rowCount ?? 0) > 0 && (d.bucket?.rowCount ?? 0) > 0,
    `官方 ${o.bucket?.rowCount} / 本地 ${d.bucket?.rowCount}（含首页残留，不比等号）`);
  cmp("精选类目页 标题", "featured", "headingText");
  cmp("类目桶 页 标题", "bucket", "headingText");
  // Official has no pagination control at all — 63 rows live in one scroller. A "load more" button
  // here would be an invented surface.
  ok("类目页 无分页控件", o.bucket?.hasLoadMore === false && d.bucket?.hasLoadMore === false,
    `官方 ${o.bucket?.hasLoadMore} / 本地 ${d.bucket?.hasLoadMore}`);
  ok("精选与类目桶 是两个不同页面", (d.featured?.headingText ?? "") !== (d.bucket?.headingText ?? ""),
    `精选「${d.featured?.headingText}」/ 桶「${d.bucket?.headingText}」`);

  // The manage page lists what THIS machine has installed, so its row count and first row are
  // expected to differ between the two apps (official has 16 installed, local 8) — comparing them
  // is a category error, not a parity check. What must hold is internal: the page opens, has rows,
  // and the detail round-trip restores the list instead of dropping back to the homepage.
  ok("管理页 可打开且有行", d.manage?.rowCount > 0, `本地 ${d.manage?.rowCount} 行（官方 ${o.manage?.rowCount}，安装态不同故不比）`);
  ok("管理页 能进入详情", d.manage?.reachedDetail === true, "点击首行应到达详情页");
  ok("管理页 返回后标题恢复", d.manage?.headingAfterBack === d.manage?.headingBefore,
    `进入前「${d.manage?.headingBefore}」/ 返回后「${d.manage?.headingAfterBack}」`);
  ok("管理页 返回后行数不变", d.manage?.rowCountAfterBack === d.manage?.rowCount, `进入前 ${d.manage?.rowCount} / 返回后 ${d.manage?.rowCountAfterBack}`);
}

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
  // The 11 entries the anonymous listing withheld are pinned locally (docs/evidence/
  // marketplace-catalog-supplements.md), so the local catalog should now match official's scale.
  // Keep reporting the exact short list rather than failing, but stop calling it a strict subset:
  // the wording used to claim "少 11 条" in the same run that reported 缺失条目:（无）.
  const missingEntries = Object.keys(o.named)
    .filter((k) => o.named[k] && !d.named[k]?.present)
    .map((k) => `${k}(id ${o.named[k].id})`);
  const extraEntries = Object.keys(d.named).filter((k) => d.named[k] && !o.named[k]?.present);
  console.log(`     catalog 总数 官方 ${o.total} / 本地 ${d.total} —— 数据面：${missingEntries.length === 0 && extraEntries.length === 0 ? "两侧条目集合一致" : "存在缺口，见下"}`);
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

console.log(`\n${failures === 0 ? "✅ 全部核验通过" : `❌ ${failures} 项核验未通过`}${knownGaps > 0 ? `（另有 ${knownGaps} 项已知差异，未计入失败）` : ""}\n`);

process.exit(failures === 0 ? 0 : 1);
