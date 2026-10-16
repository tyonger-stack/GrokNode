import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Task-1 Library parity golden contract. Self-contained: no repo imports, no
// product contracts, no bundler. Oracles are (a) the byte-identical original
// extracts under .omo/evidence/grok-node-library/task-1-{R,E,M,F,D}.txt and
// (b) the frozen fixtures tests/fixtures/library-parity-*.json.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evDir = path.join(repoRoot, ".omo", "evidence", "grok-node-library");
const evidenceUnavailable = ![ "task-1-R.txt", "task-1-E.txt", "task-1-M.txt", "task-1-F.txt", "task-1-D.txt" ]
  .every((name) => existsSync(path.join(evDir, name)));
const rawFixture = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "library-parity-raw-transcript.json"), "utf8"));
const golden = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "library-parity-golden.json"), "utf8"));
const R = evidenceUnavailable ? "" : readFileSync(path.join(evDir, "task-1-R.txt"), "utf8");
const E = evidenceUnavailable ? "" : readFileSync(path.join(evDir, "task-1-E.txt"), "utf8");
const M = evidenceUnavailable ? "" : readFileSync(path.join(evDir, "task-1-M.txt"), "utf8");
const F = evidenceUnavailable ? "" : readFileSync(path.join(evDir, "task-1-F.txt"), "utf8");
const D = evidenceUnavailable ? "" : readFileSync(path.join(evDir, "task-1-D.txt"), "utf8");
function parityTest(name, options, implementation) {
  const callback = typeof options === "function" ? options : implementation;
  const settings = typeof options === "object" && options !== null ? options : {};
  test(name, { ...settings, skip: evidenceUnavailable || settings.skip }, callback);
}
function sha256File(p) { return createHash("sha256").update(readFileSync(p)).digest("hex"); }
function sliceOf(text, start, end) { return text.slice(start, end); }
function fnSlice(text, name, len) { const i = text.indexOf("function " + name + "("); assert.notEqual(i, -1, name + " not found"); return text.slice(i, i + len); }

// ---- Independent transcriptions of the observed original rules ----
function ay(s) {
  const e = String(s).trim();
  if (!/^file:/i.test(e) || !URL.canParse(e)) return e;
  const n = new URL(e);
  if (n.protocol !== "file:") return e;
  try { return decodeURIComponent(n.pathname); } catch (err) { if (err instanceof URIError) return n.pathname; throw err; }
}
// ORe/QF/zRe: cloud-authored send-messages and fromAgent messages are
// returned-artifact (never library rows); user-attachments and user messages
// are user-upload; every other entry class is bot (tool-call etc. yield no
// rows downstream in BRe/kN/LRe).
function qfClass(a) {
  if (!a || typeof a.kind !== "string") return "user-upload";
  const returned = a.kind === "message"
    ? a.fromAgent != null
    : a.kind === "send-message" && (a.author?.kind === "cloud-agent" || (a.cloudAgentArtifacts?.length ?? 0) > 0);
  if (returned) return "returned-artifact";
  if (a.kind === "user-attachment" || (a.kind === "message" && a.role === "user")) return "user-upload";
  return "bot";
}
function qfIsBot(a) { return qfClass(a) === "bot"; }
// Eager-app closures imported by R (R-local <- E-export <- E-local):
// kN<=vP<=mFe, nC<=bB<=nee, bN<=vQ<=Cu, sae<=c0<=N9e, nae<=vR<=f0,
// B4<=qi<=wQ, a1<=gT<=h0, ni<=qt<=UFe, c7<=w6<=mUe=5, Ite<=bC<=vFe, Md<=bU<=o0.
function s0ext(source) { let t = String(source); try { t = new URL(t).pathname; } catch {} const n = t.toLowerCase(); const s = n.lastIndexOf("."); return s < 0 ? "" : n.slice(s); }
const IMG_EXTS = new Set([".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp", ".heic", ".heif"]);
const VID_EXTS = new Set([".m4v", ".mov", ".mp4", ".ogv", ".webm"]);
function r0img(url) { return IMG_EXTS.has(s0ext(url)); }
function wQvid(url) { return VID_EXTS.has(s0ext(url)); }
function o0media(url) { return r0img(url) || wQvid(url); }
function cuSand(url) { return String(url).trim().toLowerCase().startsWith("sand://"); }
function f0http(t) { const s = String(t).trim(); if (!/^https?:\/\/\S+$/i.test(s)) return null; try { const n = new URL(s); return n.protocol !== "http:" && n.protocol !== "https:" || n.hostname.length === 0 ? null : n.toString(); } catch { return null; } }
function vFeUrl(t) { const s = String(t).trim(); if (s.length === 0 || /\s/.test(s) || !/^https?:\/\//i.test(s)) return null; try { const n = new URL(s); return n.protocol !== "http:" && n.protocol !== "https:" || n.hostname.length === 0 ? null : n.toString(); } catch { return null; } }
function bEClass(url) { const probe = vFeUrl(url); return probe !== null && !o0media(url) ? "legacy-link" : o0media(url) ? "media" : "file"; }
function h0base(source) { let decoded = String(source); try { const url = new URL(decoded); if (url.protocol === "file:") decoded = decodeURIComponent(url.pathname); } catch {} const parts = decoded.split(/[/\\]/).filter((n) => n.length > 0); return parts.length > 0 ? parts[parts.length - 1] : String(source); }
function arBase(source) { const t = String(source).replace(/[/\\]+$/, ""); const n = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")); const s = n >= 0 ? t.slice(n + 1) : t; return s.length > 0 ? s : String(source); }
function nRhttps(v) { const t = f0http(v); return t === null ? null : new URL(t).protocol === "https:" ? t : null; }
const JI_SINGLE = /^\[[^\]\n]*\]\(\s*([^)\s]+)(?:\s+[^)]*)?\)\s*$/;
function eRlink(v) { const t = String(v).trim(); return nRhttps(JI_SINGLE.exec(t)?.[1] ?? t); }
function wjImage(url) { return String(url).startsWith("data:image/") ? true : o0media(url); }
function saeArtifact(source) {
  const t = String(source).trim();
  let p = null;
  if (/^file:/i.test(t)) {
    if (!URL.canParse(t)) return null;
    const n = new URL(t);
    if (n.protocol !== "file:" || n.username.length > 0 || n.password.length > 0 || n.pathname.length === 0) return null;
    p = n.pathname;
  } else if (t.startsWith("/")) { p = t; } else { return null; }
  const TA = "/workspace/cloud-agent-artifacts/";
  if (!p.startsWith(TA)) return null;
  const rest = p.slice(TA.length); const s = rest.indexOf("/");
  if (s <= 0 || s === rest.length - 1) return null;
  return /^bc-[A-Za-z0-9-]{1,80}$/.test(rest.slice(0, s)) ? { bcId: rest.slice(0, s) } : null;
}
function rsClass(a, source, exc) {
  if (qfClass(a) !== "bot") return qfClass(a);
  if (exc.has(ay(source))) return "user-upload";
  return saeArtifact(source) !== null ? "returned-artifact" : "bot";
}
function excSet(entries) {
  const s = new Set();
  for (const n of entries) {
    if (n.kind === "user-attachment" && typeof n.file_path === "string") s.add(ay(n.file_path));
    else if (n.kind === "message" && n.role === "user") for (const im of (n.images || [])) if (im && typeof im.url === "string") s.add(ay(im.url));
  }
  return s;
}
function baseName(source) { return h0base(source); }
function msName(name, source) { if (name === null || name === undefined || String(name).trim().length === 0) return baseName(source); return name; }
function isVideo(source) { return wQvid(source); }
// kN single-entry images: markdown ![alt](url) plus structured images, both
// skipping sand:// targets; addImage dedups and keeps alt verbatim.
function knImages(a) {
  const out = []; const seen = new Set();
  const add = (source, name) => { const u = String(source).trim(); if (u.length === 0 || seen.has(u)) return; seen.add(u); out.push({ source: u, name: name === null || name === undefined || String(name).trim().length === 0 ? undefined : String(name).trim() }); };
  const md = (content) => String(content).replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+[^)]*)?\)/g, (m, alt, url) => { if (!cuSand(url)) add(url, alt); return " "; });
  if (!a || typeof a.kind !== "string") return out;
  if (a.kind === "user-attachment") { if (typeof a.file_path === "string" && o0media(a.file_path)) add(a.file_path, a.file_name ?? null); return out; }
  if (a.kind === "send-message") {
    const m = a.message; if (!m || typeof m !== "object") return out;
    if (m.type === "text") { md(m.content ?? ""); for (const im of m.images ?? []) if (im && typeof im.url === "string" && !cuSand(im.url)) add(im.url, im.alt); return out; }
    if (m.type === "attachment" && typeof m.url === "string" && !cuSand(m.url) && f0http(m.url) === null && wjImage(m.url)) add(m.url, m.file_name ?? null);
    return out;
  }
  if (a.kind === "message") { md(a.content ?? ""); for (const im of a.images ?? []) if (im && typeof im.url === "string" && !cuSand(im.url)) add(im.url, im.alt); return out; }
  return out;
}
// zS: structured images minus sand:// targets, names always basenames.
function zsImages(imgs) { return (imgs ?? []).filter(function (im) { return im && typeof im.url === "string"; }).flatMap(function (im) { return cuSand(im.url) ? [] : [{ source: im.url, name: h0base(im.url) }]; }); }
function breFiles(a) {
  if (!a || typeof a.kind !== "string") return [];
  if (a.kind === "user-attachment") return [{ source: a.file_path, name: a.file_name ?? arBase(a.file_path) }];
  if (a.kind === "send-message") {
    const m = a.message;
    if (!m || typeof m !== "object") return [];
    if (m.type === "text") return zsImages(m.images);
    if (m.type !== "attachment" || typeof m.url !== "string" || cuSand(m.url)) return [];
    const c = bEClass(m.url);
    return c !== "media" && c !== "file" ? [] : [{ source: m.url, name: m.file_name ?? h0base(m.url) }];
  }
  if (a.kind === "message") return zsImages(a.images);
  return [];
}
// LRe: attachment links via nae (HTTP/HTTPS normalized); text links via
// nee (streaming, any structured image, or non-text yields null; else the
// single-link or bare-https content extraction). Message-kind KJ needs the
// richText/d0 path outside the extracts, so it stays null here.
function neeLink(a) {
  const m = a.message; if (!m || typeof m !== "object") return null;
  if (m.type !== "text" || a.streaming === true || ((m.images ?? []).length > 0)) return null;
  return eRlink(m.content);
}
function lreLink(a) {
  if (!a || a.kind !== "send-message") return null;
  const m = a.message;
  if (!m || typeof m !== "object") return null;
  if (m.type === "attachment") return typeof m.url === "string" ? f0http(m.url) : null;
  return neeLink(a);
}
function deriveMedia(entries) {
  const exc = excSet(entries);
  const seen = new Set();
  const out = [];
  for (const a of entries) {
    if (!qfIsBot(a)) continue;
    const ts = (a.timestampMs === null || a.timestampMs === undefined) ? null : a.timestampMs;
    const link = lreLink(a);
    const imgs = knImages(a);
    const imgSources = new Set(imgs.map(function (u) { return u.source; }));
    for (const u of imgs) {
      if (rsClass(a, u.source, exc) !== "bot") continue;
      const key = "visual:" + u.source;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({kind: isVideo(u.source) ? "video" : "image", id: a.id + ":" + key, timestampMs: ts, source: u.source, name: msName(u.name, u.source)});
    }
    for (const f of breFiles(a)) {
      if (imgSources.has(f.source)) continue;
      if (f.source === link) continue;
      if (rsClass(a, f.source, exc) !== "bot") continue;
      const key = "file:" + f.source;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({kind: "file", id: a.id + ":" + key, timestampMs: ts, source: f.source, name: msName(f.name, f.source)});
    }
    if (link !== null) {
      const key = "link:" + link;
      if (!seen.has(key)) { seen.add(key); out.push({kind: "link", id: a.id + ":" + key, timestampMs: ts, url: link}); }
    }
  }
  return out.reverse();
}
function dayStart(t) { const n = new Date(t); n.setHours(0, 0, 0, 0); return n.getTime(); }
function mre(ts, now) {
  if (ts === null || ts === undefined) return "older";
  if (ts >= dayStart(now)) return "today";
  const week = new Date(now); week.setDate(week.getDate() - 6); week.setHours(0, 0, 0, 0);
  if (ts >= week.getTime()) return "week";
  return "older";
}
function groupItems(items, now) {
  const g = {today: [], week: [], older: []};
  for (const s of items) g[mre(s.timestampMs, now)].push(s);
  return ["today", "week", "older"].filter(function (k) { return g[k].length > 0; }).map(function (k) { return {key: k, items: g[k]}; });
}
const PA = {page: 0, "external-doc": 1, media: 2};
function ace(a, b) {
  const n = (a.timestampMs === null || a.timestampMs === undefined) ? Number.NEGATIVE_INFINITY : a.timestampMs;
  const s = (b.timestampMs === null || b.timestampMs === undefined) ? Number.NEGATIVE_INFINITY : b.timestampMs;
  if (n !== s) return s - n;
  if (a.kind !== b.kind) return PA[a.kind] - PA[b.kind];
  return a.key.localeCompare(b.key);
}
function snPage(p) {
  if (p.kind === "document") return "document:" + p.storeId + ":" + p.documentId;
  if (p.kind === "canvas") return "canvas:" + p.storeId + ":" + p.canvasId;
  return "active-user-store-canvas:" + p.canvasId;
}
function mergeV2(pages, docs, media) {
  return [].concat(
    pages.map(function (r) { return {kind: "page", key: snPage(r), timestampMs: (r.updatedAtMs === null || r.updatedAtMs === undefined) ? null : r.updatedAtMs, page: r}; }),
    docs.map(function (r) { return {kind: "external-doc", key: "doc:" + r.key, timestampMs: r.lastTouchedAtMs, doc: r}; }),
    media.map(function (r) { return {kind: "media", key: "media:" + r.id, timestampMs: r.timestampMs, item: r}; })
  ).toSorted(ace);
}
const M1E_OBSERVED = ["notion", "google-docs", "google-sheets", "google-slides", "google-drive", "onedrive", "sharepoint", "figma"];
function sjt(e) {
  if (!e || e.kind !== "document" || e.key.length === 0 || e.externalId.length === 0) return null;
  if (!URL.canParse(e.url) || new URL(e.url).protocol !== "https:") return null;
  if (e.lastAction !== "created" && e.lastAction !== "edited") return null;
  function posInt(v) { const t = Number(v); return Number.isSafeInteger(t) && t > 0 ? t : null; }
  const r = posInt(e.firstTouchedAtMs); const n = posInt(e.lastTouchedAtMs);
  if (r === null || n === null) return null;
  const title = (e.title || "").trim();
  return {key: e.key, provider: M1E_OBSERVED.includes(e.provider) ? e.provider : "other", externalId: e.externalId, url: e.url, title: title.length === 0 ? null : title, createdByBot: e.createdByBot, lastAction: e.lastAction, firstTouchedAtMs: r, lastTouchedAtMs: n};
}
function t1eSort(docs) { return docs.slice().toSorted(function (a, b) { return a.lastTouchedAtMs !== b.lastTouchedAtMs ? b.lastTouchedAtMs - a.lastTouchedAtMs : a.key.localeCompare(b.key); }); }
function fceGate(entry) { return entry.streaming === true ? null : "refs"; }
function materialize(entries, now) {
  return entries.map(function (e) {
    const c = Object.assign({}, e);
    c.timestampMs = (e.tsOffsetMs === null || e.tsOffsetMs === undefined) ? null : now + e.tsOffsetMs;
    return c;
  });
}

parityTest("extracts are byte-identical to the frozen original chunks", function () {
  assert.equal(sha256File(path.join(evDir, "task-1-R.txt")), golden._provenance.chunks.R.sha256);
  assert.equal(sha256File(path.join(evDir, "task-1-E.txt")), golden._provenance.chunks.E.sha256);
  assert.equal(sha256File(path.join(evDir, "task-1-M.txt")), golden._provenance.chunks.M.sha256);
  assert.equal(sha256File(path.join(evDir, "task-1-F.txt")), golden._provenance.chunks.F.sha256);
  assert.equal(sha256File(path.join(evDir, "task-1-D.txt")), golden._provenance.chunks.D.sha256);
});

parityTest("original ASAR identity holds when the app is present", {skip: !existsSync("/Applications/Grok Bot.app/Contents/Resources/app.asar")}, function () {
  assert.equal(sha256File("/Applications/Grok Bot.app/Contents/Resources/app.asar"), golden._provenance.asarSha256);
});

parityTest("FRe derivation anchors: dedup keys, link branch, display reversal", function () {
  const src = sliceOf(R, 1581347, 1582219);
  assert.ok(src.indexOf("function FRe") === 0);
  assert.ok(src.includes("visual:"));
  assert.ok(src.includes("file:"));
  assert.ok(src.includes("link:"));
  assert.ok(src.includes("toReversed()"));
  assert.ok(src.includes("u.source===d"));
});

parityTest("grouping anchors: constants, MRe week rule, ZF order, reveal steps", function () {
  assert.ok(sliceOf(R, 1579191, 1579244).includes("TS=5"));
  assert.ok(sliceOf(R, 1579191, 1579244).includes("PRe=10"));
  assert.ok(sliceOf(R, 1579191, 1579244).includes('RRe=["today","week","older"]'));
  assert.ok(sliceOf(R, 1579345, 1579435).includes("ERe-1"));
  assert.ok(sliceOf(R, 1579435, 1579600).includes("flatMap"));
  assert.ok(sliceOf(R, 1588297, 1588976).includes("FRe(s.entries)"));
  assert.ok(sliceOf(R, 1588297, 1588976).includes("loadOlder"));
  const jre = sliceOf(R, 1591085, 1591750);
  assert.ok(jre.includes("IntersectionObserver"));
  assert.ok(jre.includes("f<PRe"));
  assert.ok(sliceOf(R, 1589513, 1591050).includes("y+TS"));
  assert.ok(fnSlice(R, "SG", 2403).includes("u+OS"));
  assert.ok(fnSlice(R, "AG", 978).includes("c7"));
  assert.ok(E.includes("mUe=5"));
  assert.ok(E.includes("mUe as w6"));
  assert.ok(R.includes("w6 as c7"));
});

parityTest("classifier anchors: QF RS exc-set zS BRe outcomes", function () {
  assert.ok(sliceOf(R, 1580279, 1580473).includes("returned-artifact"));
  assert.ok(sliceOf(R, 1580279, 1580473).includes("user-upload"));
  assert.ok(sliceOf(R, 1579923, 1580123).includes("user-attachment"));
  assert.ok(fnSlice(R, "BRe", 700).includes('"tool-call"'));
  assert.ok(fnSlice(R, "URe", 120).includes("unknown"));
});
parityTest("media-rule anchors: ORe cloud, BRe files, link extraction, helper chain", function () {
  assert.ok(sliceOf(R, 1580123, 1580279).includes("cloud-agent"));
  assert.ok(sliceOf(R, 1580123, 1580279).includes("cloudAgentArtifacts"));
  const bre = fnSlice(R, "BRe", 700);
  assert.ok(bre.includes("file_name??a1(e.url)"));
  assert.ok(bre.includes("file_name??ni(t.file_path)"));
  assert.ok(fnSlice(R, "b_e", 200).includes("legacy-link"));
  assert.ok(fnSlice(R, "zS", 200).includes("a1(e.url)"));
  assert.ok(fnSlice(E, "nee", 340).includes("streaming"));
  assert.ok(fnSlice(E, "nee", 340).includes("eR(e.message.content)"));
  assert.ok(fnSlice(E, "eR", 120).includes("JI.exec"));
  assert.ok(fnSlice(E, "$J", 900).includes("tR(e.content,t)"));
  assert.ok(fnSlice(E, "WJ", 100).includes("data:image/"));
  assert.ok(R.includes("vP as kN") && E.includes("mFe as vP"));
  assert.ok(R.includes("bB as nC") && E.includes("nee as bB"));
  assert.ok(R.includes("vQ as bN") && E.includes("Cu as vQ"));
  assert.ok(R.includes("c0 as sae") && E.includes("N9e as c0"));
  assert.ok(R.includes("vR as nae") && E.includes("f0 as vR"));
  assert.ok(R.includes("qi as B4") && E.includes("wQ as qi"));
  assert.ok(R.includes("gT as a1") && E.includes("h0 as gT"));
  assert.ok(R.includes("qt as ni") && E.includes("UFe as qt"));
  assert.ok(R.includes("w6 as c7") && E.includes("mUe as w6"));
  assert.ok(R.includes("bC as Ite") && E.includes("vFe as bC"));
  assert.ok(R.includes("bU as Md") && E.includes("o0 as bU"));
});

parityTest("gates route but never cut scope", function () {
  const bw = fnSlice(R, "BW", 1257);
  assert.ok(bw.includes("grok_bot_library_v2"));
  assert.ok(bw.includes("grok_bot_documents_ui"));
  assert.ok(bw.includes("grok_bot_library_external_docs"));
  const lw = fnSlice(R, "LW", 700);
  assert.ok(lw.includes("grok_bot_library_pages"));
  assert.ok(lw.includes("return null"));
  const qo = fnSlice(R, "qOe", 700);
  assert.ok(qo.includes("sand_simplified_right_pane"));
  for (const combo of golden.scopeGuards.combos) {
    assert.deepEqual(golden.scopeGuards.requiredBranches.slice().sort(), golden.branches.slice().sort(), combo + " must keep every branch");
  }
  assert.equal(golden.gates.length, 5);
});

parityTest("external-doc row exposes open-URL only, page rows keep Open plus conditional Share", function () {
  const wg = sliceOf(R, 1607896, 1608806);
  assert.ok(wg.includes("function wG"));
  assert.ok(wg.includes("onOpen"));
  assert.equal(wg.includes("kt.Item"), false);
  assert.equal(wg.includes("LFKLqp"), false);
  const xg = fnSlice(R, "xG", 1997);
  assert.ok(xg.includes("LFKLqp"));
  assert.ok(xg.includes("1TNIig"));
  assert.deepEqual(golden.externalDocs.actions, ["openUrl"]);
});

parityTest("v2 merge anchors: comparator, key formats, page sort", function () {
  const aceSrc = sliceOf(E, 1093984, 1094174);
  assert.ok(aceSrc.includes("NEGATIVE_INFINITY"));
  assert.ok(aceSrc.includes("localeCompare"));
  assert.ok(E.includes("PA={page:0"));
  const sn = fnSlice(E, "Sn", 420);
  assert.ok(sn.includes("canvas:"));
  assert.ok(sn.includes("active-user-store-canvas:"));
  assert.ok(sn.includes("document:"));
  assert.ok(fnSlice(E, "fce", 300).includes("streaming"));
});

parityTest("SJt validation and T1e sort anchors", function () {
  const sj = fnSlice(M, "SJt", 700);
  assert.ok(sj.includes("gJt"));
  assert.ok(sj.includes("lastAction"));
  assert.ok(sj.includes("firstTouchedAtMs"));
  assert.ok(M.includes('gJt="document"'));
  const t1 = fnSlice(M, "T1e", 220);
  assert.ok(t1.includes("lastTouchedAtMs"));
  assert.ok(t1.includes("localeCompare"));
  assert.ok(M.includes("M1e="));
});

parityTest("asset service anchors: limits, sniffing, five statuses, ETag cache", function () {
  const capRegion = M.slice(M.indexOf("function b1e("), M.indexOf("function b1e(") + 2600);
  assert.ok(capRegion.includes("5242880"));
  assert.ok(M.includes("CYt=1e4"));
  assert.ok(M.includes("IYt=4"));
  assert.ok(M.includes("64*1024*1024"));
  assert.ok(fnSlice(M, "S1e", 500).includes("image/png"));
  assert.ok(fnSlice(M, "S1e", 500).includes("image/gif"));
  const assets = capRegion;
  assert.ok(assets.includes("too_large"));
  assert.ok(assets.includes("not_image"));
  assert.ok(assets.includes("If-None-Match"));
  assert.ok(assets.includes("304"));
  assert.ok(M.slice(M.indexOf("getDocumentAssets("), M.indexOf("getDocumentAssets(") + 800).includes("slice(0,20)"));
});

parityTest("IPC method table: all ten library methods plus adjacent openExternal", function () {
  const jv = M.slice(M.indexOf("Jv=Uo"), M.indexOf("Jv=Uo") + 1600);
  const expected = ["getCanvasShare", "setCanvasVisibility", "getDocument", "getDocumentEditRight", "saveDocument", "resolveLibraryPages", "listLibraryPages", "listLibraryDocs", "setDocumentVisibility", "getDocumentAssets", "openExternal"];
  for (const m of expected) assert.ok(jv.includes(m + ":k().args"), m + " missing from Jv block");
  assert.ok(jv.includes("refs:(0,p.rpcArray)"));
  assert.equal(golden.ipc.methods.length, 10);
});

parityTest("native doc and canvas anchors: controller, debounce, protocol, echo errors", function () {
  assert.ok(sliceOf(D, 229800, 229900).includes("bh=2e3"));
  const wh = fnSlice(D, "wh", 500);
  assert.ok(wh.includes("locator"));
  assert.ok(wh.includes("onEditAttempt"));
  const hj = fnSlice(M, "HJt", 700);
  assert.ok(hj.includes("404"));
  assert.ok(hj.includes("400"));
  assert.ok(hj.includes("499"));
  assert.ok(M.includes("Canvas visibility echo was not recognized."));
  assert.ok(M.includes("Document visibility echo was not recognized."));
  assert.ok(M.includes("Only the document"));
  const o6 = fnSlice(R, "O6", 400);
  assert.ok(o6.includes("artifactType"));
  assert.ok(o6.includes("onApply"));
});

parityTest("viewer format map covers all elevenzn branches", function () {
  const zn = fnSlice(F, "zn", 2900);
  for (const k of golden.ordinaryFiles.formats) assert.ok(zn.includes('"' + k + '"'), k + " missing from zn switch");
  assert.ok(fnSlice(F, "dn", 929).includes("suggestedName"));
});

parityTest("behavioral: v1 derivation over the raw fixture matches golden", function () {
  const now = Date.now();
  const entries = materialize(rawFixture.entries, now);
  const derived = deriveMedia(entries);
  assert.deepEqual(derived.map(function (d) { return d.id; }), golden.derivedGolden.mediaReversedIds);
  assert.deepEqual(derived.map(function (d) { return d.kind; }), golden.derivedGolden.mediaKinds);
  assert.deepEqual(derived.map(function (d) { return d.name || ""; }), golden.derivedGolden.mediaNames);
  const groups = groupItems(derived, now);
  assert.deepEqual(groups.map(function (g) { return g.key; }), golden.derivedGolden.groupKeys);
  const counts = {};
  for (const g of groups) counts[g.key] = g.items.length;
  assert.deepEqual(counts, golden.derivedGolden.groupCounts);
});

parityTest("behavioral: v2 tie order, SJt, T1e, streaming gate", function () {
  const tie = rawFixture.v2tie;
  const merged = mergeV2(tie.pages, tie.externalDocs, tie.media);
  assert.deepEqual(merged.map(function (m) { return m.key; }), golden.v2tieExpectedKeys);
  assert.deepEqual(sjt({kind: "document", key: "n-key", provider: "notion", externalId: "ext-1", url: "https://notion.so/x1", title: "  TITLE ", createdByBot: true, lastAction: "created", firstTouchedAtMs: 100, lastTouchedAtMs: 200}), golden.sjtValidExpected);
  const bad = [
    sjt({kind: "link", key: "k", provider: "notion", externalId: "e", url: "https://notion.so/x", title: "t", createdByBot: true, lastAction: "created", firstTouchedAtMs: 1, lastTouchedAtMs: 2}),
    sjt({kind: "document", key: "", provider: "notion", externalId: "e", url: "https://notion.so/x", title: "t", createdByBot: true, lastAction: "created", firstTouchedAtMs: 1, lastTouchedAtMs: 2}),
    sjt({kind: "document", key: "k", provider: "notion", externalId: "", url: "https://notion.so/x", title: "t", createdByBot: true, lastAction: "created", firstTouchedAtMs: 1, lastTouchedAtMs: 2}),
    sjt({kind: "document", key: "k", provider: "notion", externalId: "e", url: "http://insecure.example/x", title: "t", createdByBot: true, lastAction: "created", firstTouchedAtMs: 1, lastTouchedAtMs: 2}),
    sjt({kind: "document", key: "k", provider: "notion", externalId: "e", url: "https://notion.so/x", title: "t", createdByBot: true, lastAction: "deleted", firstTouchedAtMs: 1, lastTouchedAtMs: 2}),
    sjt({kind: "document", key: "k", provider: "notion", externalId: "e", url: "https://notion.so/x", title: "t", createdByBot: true, lastAction: "created", firstTouchedAtMs: 0, lastTouchedAtMs: 2})
  ];
  for (const b of bad) assert.equal(b, null);
  assert.equal(sjt({kind: "document", key: "k", provider: "mystery", externalId: "e", url: "https://m.example/x", title: "t", createdByBot: false, lastAction: "edited", firstTouchedAtMs: 5, lastTouchedAtMs: 6}).provider, "other");
  const docs = [{key: "k1", lastTouchedAtMs: 100}, {key: "k2", lastTouchedAtMs: 100}, {key: "k3", lastTouchedAtMs: 300}];
  assert.deepEqual(t1eSort(docs).map(function (d) { return d.key; }), golden.t1eExpectedKeys);
  const streamed = rawFixture.entries.filter(function (e) { return e.id === "e_stream"; })[0];
  assert.equal(fceGate(streamed), null);
  assert.equal(fceGate(rawFixture.entries[0]), "refs");
});

parityTest("behavioral: observed real shape carries the original media fields", function () {
  const o = rawFixture.observedRealShape;
  assert.equal(o.entryKind, "send-message");
  assert.equal(o.messageType, "text");
  assert.ok(o.image.url.indexOf("file:///") === 0);
  assert.equal(typeof o.image.alt, "string");
  assert.equal(o.image.width, 1280);
});

parityTest("probes: malformed input is contained, injection alt stays verbatim text", function () {
  const now = Date.now();
  const entries = materialize(rawFixture.entries, now);
  const malformed = entries.filter(function (e) { return e.id === "e_malformed"; });
  assert.doesNotThrow(function () { deriveMedia(malformed); });
  assert.deepEqual(deriveMedia(malformed), []);
  const derived = deriveMedia(entries);
  const evil = derived.filter(function (d) { return d.id.indexOf("e_inject") === 0; });
  assert.equal(evil.length, 1);
  assert.ok(evil[0].name.includes("<script>"));
  assert.equal(evil[0].kind, "image");
  assert.equal(derived.filter(function (d) { return d.id.indexOf("e_inject") === 0 && d.kind !== "image"; }).length, 0);
});

parityTest("R7a independent oracle matches executed original counterexamples", () => {
  assert.deepEqual(deriveMedia(rawFixture.r7aCounterexamples), golden.r7aExpected);
});
