// Regression cover for the 0.71.2 "Download" / "Download all" message action port.
//
// The failures that matter are behavioural: picking up remote URLs as downloadable,
// firing downloads in parallel instead of 0.71.2's one-at-a-time loop, the wrong
// label threshold, a memo slot shared by two values, or the item missing from one
// of the two menus. The injected helpers are evaluated (and diffed against 0.71.2's
// own `SV` when the reference renderer is present), and each checker is mutated to
// prove it can fail.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parse } from "acorn";

import {
  applyOriginalRendererDownloadAll,
  DOWNLOAD_ALL_MEMO_CACHES,
  patchOriginalDownloadAll,
} from "../scripts/lib/download-all-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_CHUNK = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const OFFICIAL_ASSETS = path.resolve(REPO_ROOT, "../rea-grokbot-0712/app/dist/renderer/assets");
const run = promisify(execFile);

// src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped.
const pinnedChunk = await readFile(PINNED_CHUNK, "utf8").catch(() => null);
const bundleSkip = pinnedChunk == null
  ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped."
  : false;
const officialMain = await readFile(path.join(OFFICIAL_ASSETS, "index-wlkGG389.js"), "utf8").catch(() => null);
const officialEager = await readFile(path.join(OFFICIAL_ASSETS, "index.eager-app-DSuGVQNC.js"), "utf8").catch(() => null);
const patched = pinnedChunk == null ? null : patchOriginalDownloadAll(pinnedChunk);

function moduleLevelBindings(source) {
  const names = new Set();
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id != null) names.add(node.id.name);
    else if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) if (decl.id.type === "Identifier") names.add(decl.id.name);
    } else if (node.type === "ImportDeclaration") {
      for (const spec of node.specifiers) names.add(spec.local.name);
    }
  }
  return names;
}

function functionBody(source, header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `${header} not found`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${header} does not brace-balance`);
}

function evaluateHelpers(source, runtime = {}) {
  const start = source.indexOf("function RDownloadBasename(");
  const end = source.indexOf("function mCn(n){", start);
  assert.ok(start >= 0 && end > start, "helpers were not injected before mCn");
  return new Function(
    "S", "ktt", "ykn", "RLocT",
    `${source.slice(start, end)}\nreturn { RDownloadTargetsOf, RDownloadLabel, RMessageDownloads };`,
  )(runtime.S, runtime.ktt, runtime.ykn ?? (() => {}), (en, zh) => `${en}|${zh}`);
}

const ENTRIES = [
  { kind: "user-attachment", file_path: "/home/box/a/report.pdf", file_name: "Q3.pdf" },
  { kind: "user-attachment", file_path: "/home/box/a/photo.png" },
  { kind: "user-attachment", file_path: "C:\\box\\dir\\" },
  { kind: "send-message", message: { type: "attachment", url: "/workspace/out/chart.png", file_name: "chart.png" } },
  { kind: "send-message", message: { type: "attachment", url: "file:///workspace/out/x.csv" } },
  { kind: "send-message", message: { type: "attachment", url: "https://example.com/remote.png" } },
  { kind: "send-message", message: { type: "attachment", url: "" } },
  { kind: "send-message", message: { type: "text", text: "hi" } },
  { kind: "message", text: "hello" },
];

const EXPECTED_TARGETS = [
  [{ path: "/home/box/a/report.pdf", suggestedName: "Q3.pdf" }],
  [{ path: "/home/box/a/photo.png", suggestedName: "photo.png" }],
  [{ path: "C:\\box\\dir\\", suggestedName: "dir" }],
  [{ path: "/workspace/out/chart.png", suggestedName: "chart.png" }],
  [{ path: "file:///workspace/out/x.csv", suggestedName: "x.csv" }],
  [],
  [],
  [],
  [],
];

function checkTargets(source) {
  const { RDownloadTargetsOf } = evaluateHelpers(source);
  assert.deepEqual(ENTRIES.map(RDownloadTargetsOf), EXPECTED_TARGETS);
}

function checkLabel(source) {
  const { RDownloadLabel } = evaluateHelpers(source);
  assert.equal(RDownloadLabel(2), "Download all|全部下载");
  assert.equal(RDownloadLabel(1), "Download|下载");
  assert.equal(RDownloadLabel(undefined), "Download|下载");
}

function hookRuntime(client) {
  return {
    S: { useContext: () => client, useMemo: fn => fn() },
    ktt: Symbol("client-context"),
  };
}

async function checkSequentialDownloads(source) {
  const calls = [];
  const pending = [];
  const desktop = {
    downloadAttachment(args) {
      calls.push(args);
      return new Promise(resolve => pending.push(resolve));
    },
  };
  const { RMessageDownloads } = evaluateHelpers(source, hookRuntime({ desktop }));
  const group = [ENTRIES[0], ENTRIES[3], ENTRIES[5]];
  const all = group.flatMap(evaluateHelpers(source).RDownloadTargetsOf);
  const result = RMessageDownloads(ENTRIES[0], all);
  assert.equal(result.downloadCount, 2, "group targets override the entry's own");
  result.onDownload();
  await Promise.resolve();
  assert.equal(calls.length, 1, "0.71.2 waits for each download before starting the next");
  pending.shift()();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  assert.deepEqual(calls, all);
  pending.shift()();
}

function checkDownloadGates(source) {
  const desktop = { downloadAttachment: async () => {} };
  const withClient = evaluateHelpers(source, hookRuntime({ desktop })).RMessageDownloads;
  assert.equal(typeof withClient(ENTRIES[1], undefined).onDownload, "function");
  assert.equal(withClient(ENTRIES[1], undefined).downloadCount, 1);
  assert.equal(withClient(ENTRIES[8], undefined).onDownload, undefined, "text messages get no download");
  assert.equal(withClient(ENTRIES[5], undefined).onDownload, undefined, "remote attachments get no download");
  assert.equal(withClient(ENTRIES[1], []).onDownload, undefined, "an explicit empty group wins over the entry");
  const noClient = evaluateHelpers(source, hookRuntime(null)).RMessageDownloads;
  assert.equal(noClient(ENTRIES[1], undefined).onDownload, undefined, "no client means no download, like 0.71.2 uFe");
}

/** Every slot fits its cache, and every slot the patch adds holds exactly one value. */
function checkMemoCaches(source) {
  for (const [name, { before }] of Object.entries(DOWNLOAD_ALL_MEMO_CACHES)) {
    const body = functionBody(source, `function ${name}(n){`);
    const size = Number(/const e=he\.c\((\d+)\)/.exec(body)[1]);
    const max = Math.max(...[...body.matchAll(/\be\[(\d+)\]/g)].map(m => Number(m[1])));
    assert.ok(max < size, `${name} uses e[${max}] but allocates he.c(${size})`);
    const stores = new Map();
    for (const m of body.matchAll(/\be\[(\d+)\](?:!==|=)([\w.$]+)/g)) {
      const slot = Number(m[1]);
      if (slot < before) continue;
      stores.set(slot, (stores.get(slot) ?? new Set()).add(m[2]));
    }
    for (const [slot, values] of stores) assert.equal(values.size, 1, `${name} e[${slot}] holds ${[...values].join(", ")}`);
  }
}

function checkMenus(source) {
  const hover = functionBody(source, "function mCn(n){");
  assert.ok(hover.includes("if(!l&&RDlOn==null){"), "a download-only message must still render actions");
  assert.equal(hover.split("(i||r!=null||RDlOn!=null)").length - 1, 2, "both more-menu branches open for download");
  assert.match(hover, /children:\[tt,RDlItem,ct\]/, "hover menu: download sits before Copy");
  assert.match(hover, /RDlItem=RDlOn!=null\?p\.jsx\(It\.Item,\{leading:p\.jsx\(bt,\{name:"desktop-download",size:"base"\}\),onSelect:\(\)=>\{RDlOn\(\),_\(\)\},children:RDownloadLabel\(RDlCount\)\}\)/);
  assert.match(
    hover,
    /children:"Start a thread"\}\):null,RDlOn!=null\?p\.jsx\(no\.Item,\{leading:p\.jsx\(bt,\{name:"desktop-download",size:"base"\}\),onSelect:RDlOn,children:RDownloadLabel\(RDlCount\)\}\):null,r!=null\?p\.jsx\(no\.Item,\{leading:p\.jsx\(bt,\{name:"copy"/,
    "context menu: download sits after Reply/thread and before Copy",
  );
  const wrapper = functionBody(source, "function Roe(n){");
  assert.ok(wrapper.includes("RDl=RMessageDownloads(t,RDlAll)"));
  assert.ok(wrapper.includes("p.jsx(mCn,{downloadCount:RDl.downloadCount,entry:t,onCopy:r,onDownload:RDl.onDownload,children:s})"));
  const group = functionBody(source, "function hMn(n){");
  assert.ok(group.includes("RDlAll=t.flatMap(RDownloadTargetsOf)"));
  assert.ok(group.includes("p.jsx(o,{downloadAttachments:RDlAll,entry:u,children:m})"));
}

test("patched chunk parses as a module and anchors fail closed on re-application", { skip: bundleSkip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "download-all-"));
  const file = path.join(dir, "chunk.js");
  await writeFile(file, patched, "utf8");
  await run(process.execPath, ["--check", file]);
  assert.throws(() => patchOriginalDownloadAll(patched), /missing or ambiguous/);
});

test("download targets match 0.71.2's SV", { skip: bundleSkip }, () => {
  checkTargets(patched);
});

test("download targets are identical to the 0.71.2 reference implementation", {
  skip: bundleSkip || (officialMain == null || officialEager == null ? "0.71.2 reference renderer not present" : false),
}, () => {
  const fn = (source, name) => functionBody(source, `function ${name}(`);
  const SV = new Function(
    `${fn(officialEager, "cM")}\nconst pp=cM;\n${fn(officialMain, "rRe")}\n${fn(officialMain, "dRe")}\n${fn(officialMain, "SV")}\nreturn SV;`,
  )();
  const { RDownloadTargetsOf } = evaluateHelpers(patched);
  assert.deepEqual(ENTRIES.map(RDownloadTargetsOf), ENTRIES.map(SV));
});

test("the label switches to Download all above one file", { skip: bundleSkip }, () => {
  checkLabel(patched);
});

test("downloads run one at a time, in order", { skip: bundleSkip }, async () => {
  await checkSequentialDownloads(patched);
});

test("download is offered only for local attachments with a desktop client", { skip: bundleSkip }, () => {
  checkDownloadGates(patched);
});

test("memo caches grow to cover every added slot without sharing one", { skip: bundleSkip }, () => {
  checkMemoCaches(patched);
});

test("the item lands in both existing menus and the image group passes every attachment", { skip: bundleSkip }, () => {
  checkMenus(patched);
});

test("injected identifiers are module-level bindings", { skip: bundleSkip }, () => {
  const topLevel = moduleLevelBindings(patched);
  for (const id of ["S", "p", "bt", "It", "no", "ktt", "ykn", "RDownloadTargetsOf", "RDownloadLabel", "RMessageDownloads"]) {
    assert.ok(topLevel.has(id), `${id} must be bound at module level`);
  }
});

test("mutations: each checker rejects a reverted or weakened patch", { skip: bundleSkip }, async () => {
  const mutate = (from, to) => {
    assert.ok(patched.includes(from), `mutation anchor missing: ${from}`);
    return patched.replace(from, to);
  };
  assert.throws(() => checkTargets(mutate('return e.protocol==="file:"}', "return!0}")));
  assert.throws(() => checkLabel(mutate("(n??0)>1?", "(n??0)>=1?")));
  await assert.rejects(checkSequentialDownloads(mutate("await n.downloadAttachment(", "n.downloadAttachment(")));
  assert.throws(() => checkDownloadGates(mutate("r.length===0||s==null?void 0:", "s==null?void 0:")));
  assert.throws(() => checkMemoCaches(mutate("function mCn(n){const e=he.c(160),", "function mCn(n){const e=he.c(149),")));
  assert.throws(() => checkMemoCaches(mutate("e[157]=RDlItem,", "e[157]=tt,")));
  assert.throws(() => checkMenus(mutate("if(!l&&RDlOn==null){", "if(!l){")));
  assert.throws(() => checkMenus(mutate("onSelect:RDlOn,children:RDownloadLabel(RDlCount)}):null,", "")));
});

test("applyOriginalRendererDownloadAll patches a staged copy and records provenance", { skip: bundleSkip }, async () => {
  const stageRoot = await mkdtemp(path.join(tmpdir(), "download-all-stage-"));
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(assets, "index-UbX-y3il.js"), pinnedChunk);
  const record = await applyOriginalRendererDownloadAll({ stageRoot });
  assert.equal(await readFile(path.join(assets, "index-UbX-y3il.js"), "utf8"), patched);
  assert.equal(record.mode, "original-renderer-download-all");
  assert.deepEqual(record.chunks[0].memoCaches, DOWNLOAD_ALL_MEMO_CACHES);
  const onDisk = JSON.parse(await readFile(record.provenancePath, "utf8"));
  assert.equal(onDisk.chunks[0].patched.sha256, record.chunks[0].patched.sha256);
  await assert.rejects(applyOriginalRendererDownloadAll({ stageRoot }), /found 0/);
});
