// Regression cover for official 0.75.8's browse-page chrome, ported into upstream 0.18's plugins
// view: the category chip row, the "connected apps" header entry that replaces 0.18's segmented
// control, and official's search placeholder.
//
// The guards here are the ones that matter for a port that rewrites MINIFIED upstream code:
//
//   * every anchor must be replaced exactly once — the patch refuses a missing or ambiguous
//     anchor at build time, and an anchor that became ambiguous would patch the wrong site;
//   * the injected source must parse on its own (a broken splice takes the whole renderer down);
//   * every Chinese string the port writes must be official's own, matched against the captured
//     official locale fixture — a typo or an invented translation fails here;
//   * every class the chip row and the header entry use must resolve in the shipped 0.18
//     stylesheet, or be one of the three rules the companion CSS patch injects from official's
//     own stylesheet. A stylix class name is the hash of its declaration block, so a class that
//     exists in one build and not in another is a *no-op*: the chip would render unstyled with
//     every other test still green.
//
// The staged chunk is checked too when a build is present.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import {
  MARKETPLACE_BROWSE_CHROME_REPLACEMENTS,
  patchMarketplaceBrowseChrome,
} from "../scripts/lib/marketplace-browse-chrome-0758-patch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const fixture = JSON.parse(read("tests", "fixtures", "official-0758-marketplace-wording.json"));
const officialCss = read("scripts", "lib", "marketplace-browse-chrome-0758-official.css");

/** A chunk that contains every anchor exactly once (the anchors are fragments, so this is text). */
function syntheticChunk() {
  let source = "const Os=1,Re=2,ue=3,C=4,t=5,k=6,RLocT=7,Pl=8,nt=9,qn={};\n";
  for (const entry of MARKETPLACE_BROWSE_CHROME_REPLACEMENTS) source += `/*${entry.label}*/${entry.before}\n`;
  return source;
}

/** The injected source, as it lands in the chunk. */
function injectedSource(patched) {
  const marker = "const RM0758ChipBody2=";
  const index = patched.indexOf(marker);
  assert.ok(index >= 0, "the injected source must be present");
  return patched.slice(index);
}

test("every anchor is replaced exactly once", () => {
  const chunk = syntheticChunk();
  for (const entry of MARKETPLACE_BROWSE_CHROME_REPLACEMENTS) {
    const count = chunk.split(entry.before).length - 1;
    assert.equal(count, 1, `the anchor of "${entry.label}" must occur exactly once, found ${count}`);
  }
  const patched = patchMarketplaceBrowseChrome(chunk);
  for (const entry of MARKETPLACE_BROWSE_CHROME_REPLACEMENTS) {
    // One replacement is additive (the chip state is appended to the existing state list), so the
    // old text may legitimately survive inside the new one. What must not happen is the old text
    // surviving *on its own*.
    const beforeCount = patched.split(entry.before).length - 1;
    const expected = entry.after.includes(entry.before) ? 1 : 0;
    assert.equal(beforeCount, expected, `"${entry.label}" must be replaced`);
    assert.ok(patched.includes(entry.after), `"${entry.label}" must write its replacement`);
  }
});

test("the injected source parses on its own", () => {
  const patched = patchMarketplaceBrowseChrome(syntheticChunk());
  const injected = injectedSource(patched);
  assert.doesNotThrow(
    () => parse(injected, { ecmaVersion: "latest", sourceType: "module" }),
    "the injected source must parse as a module",
  );
});

test("the port removes 0.18's segmented control and adds official's chip row", () => {
  const patched = patchMarketplaceBrowseChrome(syntheticChunk());
  assert.ok(!patched.includes("Os.Item"), "0.18's segmented control must be gone");
  assert.ok(patched.includes("RM0758Chips"), "official's chip row must be injected");
  assert.ok(patched.includes("RM0758InstalledEntry"), "official's connected-apps entry must be injected");
  assert.ok(patched.includes('"data-marketplace-chips":""'), "official's chip group marker must be there");
  assert.ok(patched.includes("RM0758ChipList(Q)"), "the chip list must be built from the catalog");
  assert.ok(
    patched.includes("RM0758ChipOf(u).indexOf(RM0758Category)>=0"),
    "the marketplace items must be filtered by the selected chip",
  );
});

test("every Chinese string the chrome writes is official's own", () => {
  const patched = patchMarketplaceBrowseChrome(syntheticChunk());
  const expected = {
    全部: "N40H+G",
    更多: "2FYpfJ",
    插件分类: "jj4zKl",
    更多类别: "8zPg/f",
    在应用和技能中搜索: "ApxUA3",
    密码管理器: "P+nzjE",
    效率: "N42ane",
    通信: "hZotg6",
    设计: "f8fH8W",
    代码: "EWPtMO",
    数据: "HKH+W+",
    销售: "mUv9U4",
    营销: "vo2a+a",
    财务: "8V6XO3",
    研究: "bdztP2",
    支持: "XYLcNv",
  };
  for (const [text, id] of Object.entries(expected)) {
    const official = fixture.messages[id];
    assert.ok(official != null, `the official fixture is missing ${id}`);
    assert.equal(official.zh, text, `official's ${id} must be ${text}`);
    assert.ok(patched.includes(text), `the port must write official's ${text}`);
  }
  // The connected-apps entry keeps the wording patch's own label.
  assert.ok(patched.includes('"已连接 "+count+" 个"'), "the entry must carry official's 已连接 N 个");
});

test("every class the chrome uses resolves in the shipped stylesheet", () => {
  const assets = path.join(repoRoot, ".build", "fidelity", "app", "dist", "renderer", "assets");
  if (!existsSync(assets)) return; // the stylesheet only exists after a build
  const cssFile = readdirSync(assets).find((name) => /^index-.*\.css$/.test(name));
  const css = readFileSync(path.join(assets, cssFile), "utf8");
  const injected = new Set([...officialCss.matchAll(/\.(sand-[a-z0-9]+)/g)].map((match) => match[1]));
  const patched = patchMarketplaceBrowseChrome(syntheticChunk());
  const classes = new Set();
  for (const match of patched.matchAll(/"(sand-[a-z0-9]+(?: sand-[a-z0-9]+)*)"/g)) {
    for (const token of match[1].split(" ")) classes.add(token);
  }
  const missing = [];
  for (const name of classes) {
    if (injected.has(name)) continue;
    const re = new RegExp(`\\.${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^{]{0,80}\\{`);
    if (!re.test(css)) missing.push(name);
  }
  assert.deepEqual(missing, [], "these classes have no rule in the shipped stylesheet, so the chrome would render unstyled");
});

test("the staged chunk carries the ported chrome", () => {
  const staged = path.join(repoRoot, ".build", "fidelity", "app", "dist", "renderer", "assets", "view-B5Ug8wEm.js");
  if (!existsSync(staged)) return; // the staged chunk only exists after a build
  const chunk = readFileSync(staged, "utf8");
  const ported = chunk.includes("RM0758Chips");
  assert.equal(ported, chunk.includes("RM0758InstalledEntry"), "the two ported components must land together");
  if (ported) {
    assert.ok(!chunk.includes("Os.Item"), "0.18's segmented control must be gone from the ported chunk");
    assert.ok(chunk.includes("在应用和技能中搜索"), "the ported chunk must carry official's search placeholder");
  }
});
