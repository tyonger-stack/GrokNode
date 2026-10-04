#!/usr/bin/env node
// Measures the marketplace detail CTAs' COMPUTED padding headlessly, with no running app.
//
// Why this exists alongside `verify-marketplace-detail-parity.mjs` (which needs a live app): the
// keychain prompt blocks app startup after every re-sign, and the padding cascade can be settled
// without one.
//
// It inlines the stylesheet out of the DEPLOYED asar, not out of `.build/`. An earlier revision read
// `.build/fidelity/app/dist/renderer/assets/` while its own header said "DEPLOYED" — those two were
// only byte-identical by coincidence (that `.build` happened not to have been rewritten), which is
// precisely the "the bytes I checked are not the bytes I shipped" trap. It also never asserted
// WHICH asar it measured. Both are now structural: the asar path is a parameter, its sha256 is
// printed, and the stylesheet is read through the asar header.
//
// The stylesheet is INLINED, not linked. A `file://` <link> silently failed to load, every class
// then reported the UA default `1px 6px`, and that looked exactly like "none of these classes
// carry any padding" — nearly a wrong conclusion about a fix that was already correct. So the
// script asserts the stylesheet actually parsed before trusting any measurement.
//
// Usage:
//   node scripts/verify-marketplace-css-cascade.mjs ["/Applications/Grok Node.app"]
//
// Height is reported but NOT asserted: the fixture has no icon font, so `ui-icon` has different
// intrinsic metrics than in the real app. Padding, text content and child count are comparable.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = process.argv[2] ?? "/Applications/Grok Node.app";
const ASAR = path.join(APP, "Contents/Resources/app.asar");

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

if (!existsSync(ASAR)) {
  console.error(`no deployed asar at ${ASAR} — package and deploy first, or pass an app path`);
  process.exit(2);
}
const asarBytes = readFileSync(ASAR);

// asar header: four uint32 — @0=4, @4=headerSize, @8=string-pickle size, @12=JSON byte count.
// Data section starts at 8 + headerSize; the JSON is read at offset 16. Node offsets in the JSON
// are STRINGS, so they must go through BigInt before being added to dataStart.
const dataStart = 8 + asarBytes.readUInt32LE(4);
const header = JSON.parse(asarBytes.subarray(16, 16 + asarBytes.readUInt32LE(12)).toString("utf8"));
const cssEntries = [];
(function walk(node, pathStr) {
  for (const [key, value] of Object.entries(node.files ?? {})) {
    const next = pathStr ? `${pathStr}/${key}` : key;
    if (value.files) walk(value, next);
    else if (key.endsWith(".css")) cssEntries.push([next, value]);
  }
})(header, "");
const cssEntry = cssEntries.find(([rel]) => /\/index-[^/]*\.css$/.test(rel));
if (!cssEntry) {
  console.error(`no renderer stylesheet in ${ASAR}`);
  process.exit(2);
}
const [, cssNode] = cssEntry;
const css = asarBytes.subarray(
  Number(BigInt(dataStart) + BigInt(cssNode.offset)),
  Number(BigInt(dataStart) + BigInt(cssNode.offset)) + cssNode.size,
);

// Class lists come from the single source of truth, not from minified output — extracting an
// array out of a bundle by bracket matching silently truncates it.
const styles = readFileSync(path.join(ROOT, "frontend/src/extensions/marketplace/official-styles.ts"), "utf8");
const classes = (name) => {
  const i = styles.indexOf(`export const ${name}`);
  if (i < 0) throw new Error(`official-styles.ts has no ${name}`);
  const s = styles.indexOf("[", i);
  const e = styles.indexOf("]", s);
  return (styles.slice(s, e).match(/"([^"]+)"/g) ?? []).map((x) => x.slice(1, -1));
};
const scope = styles.match(/MARKET_SCOPE_CLASS\s*=\s*"([^"]+)"/)?.[1] ?? "sand-mkt";

// The lifted rules are read from official-styles.ts, NOT hardcoded here. An earlier revision kept a
// literal copy, which meant a source-side regression (a dropped or renamed rule) would still measure
// green because the script never saw the source. Reading the real list makes this falsifiable in the
// direction that matters: drop a rule in the source and the measurement below loses its 14px.
//
// Entry shape is `readonly [string, string] | readonly [string, string, string]`, where the optional
// third element is a pseudo-selector (`:focus-visible`, `::after`). A first pass matched only the
// two-element form and silently parsed 42 of 45 — the three focus/after rules vanished without any
// error. `expectEntries` below is an independent count of entry openings, so a shape this regex does
// not understand turns into a loud failure instead of a quietly smaller fixture.
const liftStart = styles.indexOf("export const LIFTED_OFFICIAL_RULES");
if (liftStart < 0) throw new Error("official-styles.ts has no LIFTED_OFFICIAL_RULES");
const liftOpen = styles.indexOf("[", liftStart);
const liftEnd = styles.indexOf("\n]", liftOpen);
const liftBody = styles.slice(liftOpen, liftEnd);
const lifts = (liftBody.match(/\[\s*"[^"]+"\s*,\s*"[^"]+"\s*(?:,\s*"[^"]+"\s*)?\]/g) ?? []).map((entry) =>
  entry.match(/"([^"]+)"/g).map((x) => x.slice(1, -1)),
);
const entryOpenings = (liftBody.match(/\[\s*"/g) ?? []).length;
if (lifts.length !== entryOpenings) {
  console.error(`lift parser read ${lifts.length} of ${entryOpenings} entries — refusing to measure a truncated fixture`);
  process.exit(2);
}

// The two inline-padding lifts are the ones under test. Assert they survived parsing, so a rename or
// a malformed entry fails loudly here instead of quietly measuring a rule that is no longer shipped.
for (const required of ["sand-1pic42t", "sand-1onr9mi"]) {
  if (!lifts.some(([cls]) => cls === required)) {
    console.error(`LIFTED_OFFICIAL_RULES lost ${required} (${lifts.length} entries parsed) — refusing to measure`);
    process.exit(2);
  }
}
// Mirrors view.ts installStyles: `${scope}.${cls}${pseudo}{…}` and `${scope} .${cls}${pseudo}{…}`.
const liftCss = lifts
  .map(([cls, declarations, pseudo = ""]) => `.${scope}.${cls}${pseudo}{${declarations}} .${scope} .${cls}${pseudo}{${declarations}}`)
  .join("\n");

// ── 页 2 管理插件和技能 的配方 ────────────────────────────────────────────────
// The four page-2 defects fixed this round were all *recipes that looked right and computed wrong*,
// which is exactly what a source assertion cannot catch:
//
//   私有技能 grid   carried `sand-nby9oq` (2 columns) AND `sand-1mkdm3x` (1 column). Identical
//                   specificity, so stylesheet order decided, and the two-column rule won.
//   group heading   lacked 0.66's 16 `ui-*` classes, so it inherited 15.21px bold instead of
//                   12px/16px regular.
//   h1              lacked the 17px/24px/-0.008em recipe and inherited 26px.
//   section head    carried a `min-width:0` class official does not.
//
// Each is asserted on its COMPUTED value here, against the deployed stylesheet, with no app running.
const singleGrid = classes("GRID_SINGLE_CLASSES");
const twoColGrid = classes("GRID_CLASSES");
if (singleGrid.includes("sand-nby9oq")) {
  console.error("GRID_SINGLE_CLASSES carries the two-column rule — the single column cannot win on specificity");
  process.exit(2);
}

/**
 * The detail bar's own two controls, measured against official's class lists.
 *
 * Official's back button carries three classes 0.18 does not have at all: `sand-yri2b`
 * (padding-inline-end:0) and `sand-1c1uobl` (padding-inline-start:0) are the pair that zeroes the
 * UA's `1px 6px` button padding on the inline axis, and `sand-1firant` is unknown. Our list has
 * `sand-gdialr` (transition-duration) where official has `sand-1firant`. If the two padding resets
 * are load-bearing, ours renders a visibly wider back button — and a source assertion that only
 * compared class NAMES would call that a pass.
 *
 * The trailing `OFFICIAL_DETAIL_BACK_BUTTON` is official's measured 32-class list, transcribed from
 * the running 0.66 build (docs/evidence/marketplace-page2-structure-fix.md). It lives here rather
 * than in official-styles.ts on purpose: it is the reference we are measuring AGAINST, and putting
 * it in the module under test would let an edit to that module quietly redefine the target.
 */
const OFFICIAL_DETAIL_BACK_BUTTON = [
  "sand-kit-icon-button", "sand-1n2onr6", "sand-3nfvp2", "sand-6s0dn4", "sand-l56j7k", "sand-2lah0s",
  "sand-9f619", "sand-exx8yu", "sand-yri2b", "sand-18d9i69", "sand-1c1uobl", "sand-c342km",
  "sand-ng3xce", "sand-1ypdohk", "sand-tgyt42", "sand-s2xxs2", "sand-1firant", "sand-9lcvmn",
  "sand-1k57tk5", "sand-784prv", "sand-1t137rt", "sand-9v5kkp", "sand-4sht9k", "sand-1y3gkto",
  "sand-gd8bvy", "sand-1fgtraw", "sand-149ho13", "sand-jbqb8w", "sand-1r8pydn", "sand-1o0liin",
  "sand-1fx2joi", "sand-7n8uir",
];
const localBackButton = classes("DETAIL_BACK_BUTTON_CLASSES");
const missingFromOurs = OFFICIAL_DETAIL_BACK_BUTTON.filter((c) => !localBackButton.includes(c));
const extraOnOurs = localBackButton.filter((c) => !OFFICIAL_DETAIL_BACK_BUTTON.includes(c));

const html = `<!doctype html><html><head><meta charset="utf-8">
<style id="deployed">${css}</style>
<style id="lifted">${liftCss}</style>
</head><body><div class="${scope}">
<button id="add" class="${classes("DETAIL_ADD_ACCOUNT_FULL_CLASSES").join(" ")}"><i class="ui-icon"></i>添加其他账户</button>
<button id="tools" class="${classes("DETAIL_TOOLS_ROW_CLASSES").join(" ")}"><span>已启用 23/23 个</span><i class="ui-icon"></i></button>
<div id="pane" style="width:734px">
  <h1 id="h1" class="${classes("MANAGE_H1_CLASSES").join(" ")}">管理插件和技能</h1>
  <section class="${classes("GROUP_SECTION_CLASSES").join(" ")}">
    <div id="secHead" class="${classes("SECTION_ROW_CLASSES").join(" ")}">
      <h3 id="h3" class="${classes("GROUP_TITLE_CLASSES").join(" ")}">私有技能</h3>
    </div>
    <ul id="single" class="${singleGrid.join(" ")}"><li>行</li><li>行</li></ul>
    <ul id="two" class="${twoColGrid.join(" ")}"><li>行</li><li>行</li></ul>
  </section>
</div>
<div id="barBox" class="${classes("DETAIL_BAR_CLASSES").join(" ")}" style="width:798px">
  <div class="${classes("DETAIL_BAR_LEADING_CLASSES").join(" ")}">
    <button id="backOurs" class="${localBackButton.join(" ")}"><i class="ui-icon"></i></button>
  </div>
  <h3 id="backTitle" class="${classes("DETAIL_TITLE_CENTERED_CLASSES").join(" ")}">Gmail</h3>
  <div class="${classes("BACK_TRAILING_CLASSES").join(" ")}"></div>
</div>
<div id="barBox2" class="${classes("DETAIL_BAR_CLASSES").join(" ")}" style="width:798px">
  <div class="${classes("DETAIL_BAR_LEADING_CLASSES").join(" ")}">
    <button id="backOfficial" class="${OFFICIAL_DETAIL_BACK_BUTTON.join(" ")}"><i class="ui-icon"></i></button>
  </div>
</div>
</div><pre id="out"></pre><script>
const m = (id) => { const n = document.getElementById(id); const cs = getComputedStyle(n);
  return { id, padding: cs.padding, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
           height: Math.round(n.getBoundingClientRect().height), textContent: n.textContent,
           childCount: n.children.length }; };
const g = (id) => { const n = document.getElementById(id); const cs = getComputedStyle(n);
  const r = n.getBoundingClientRect();
  return { id, gtc: cs.gridTemplateColumns, cols: cs.gridTemplateColumns.trim().split(/\\s+/).length,
           w: Math.round(r.width), height: Math.round(r.height), padding: cs.padding,
           paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
           fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontWeight: cs.fontWeight }; };
document.getElementById("out").textContent = JSON.stringify({
  sheets: document.styleSheets.length,
  rules: document.styleSheets[0] ? [...document.styleSheets[0].cssRules].length : -1,
  measured: [m("add"), m("tools")],
  type: [g("h1"), g("h3"), g("secHead")],
  grids: [g("single"), g("two")],
  back: [g("backOurs"), g("backOfficial"), g("backTitle")] });
</script></body></html>`;

const tmp = path.join("/tmp", `mkt-cascade-${process.pid}.html`);
writeFileSync(tmp, html);
const dom = execFileSync(
  CHROME,
  ["--headless", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=4000", "--dump-dom", `file://${tmp}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
const json = /<pre id="out">(\{[\s\S]*?\})<\/pre>/.exec(dom)?.[1];
if (!json) { console.error("no measurement captured"); process.exit(2); }
const result = JSON.parse(json.replaceAll("&quot;", '"'));

// A zero-rule stylesheet means the inline failed; every value below would then be a UA default.
if (result.sheets < 1 || result.rules < 1000) {
  console.error(`deployed stylesheet did not parse (${result.sheets} sheets, ${result.rules} rules) — refusing to report a measurement`);
  process.exit(2);
}
console.log(`app       ${APP}`);
console.log(`asar      ${sha(asarBytes)}  (${asarBytes.length} bytes)`);
console.log(`stylesheet ${cssEntry[0]}  ${cssNode.size} bytes  ${sha(css)}  ${result.rules} rules parsed`);
console.log(`lifts     ${lifts.length} rules read from official-styles.ts`);
console.log("");

const EXPECT = {
  add: { padding: "12px 14px", textContent: "添加其他账户", childCount: 1 },
  tools: { padding: "12px 14px", textContent: "已启用 23/23 个", childCount: 2 },
};
let failed = 0;
for (const row of result.measured) {
  const want = EXPECT[row.id];
  for (const field of Object.keys(want)) {
    const good = row[field] === want[field];
    if (!good) failed += 1;
    console.log(`${good ? "PASS" : "FAIL"}  ${row.id.padEnd(6)} ${field.padEnd(11)} got=${JSON.stringify(row[field])} want=${JSON.stringify(want[field])}`);
  }
  console.log(`info  ${row.id.padEnd(6)} height       ${row.height}px (not asserted: no icon font in this fixture)`);
}

// ── page-2 recipes: the two grids must DISAGREE, and the type must be official's ──
// The decisive check is not "the single grid is one column" but that the two lists resolve
// differently at the same width — a list carrying both rules would collapse them to the same answer,
// which is precisely the defect.
const single = result.grids.find((r) => r.id === "single");
const two = result.grids.find((r) => r.id === "two");
const h1 = result.type.find((r) => r.id === "h1");
const h3 = result.type.find((r) => r.id === "h3");
const secHead = result.type.find((r) => r.id === "secHead");
const backOurs = result.back.find((r) => r.id === "backOurs");
const backOfficial = result.back.find((r) => r.id === "backOfficial");
const backTitle = result.back.find((r) => r.id === "backTitle");

const checks = [
  ["私有技能 grid 是单列", single.cols === 1, `cols=${single.cols} gtc=${single.gtc}`],
  ["已安装 grid 是两列", two.cols === 2, `cols=${two.cols} gtc=${two.gtc}`],
  ["两个网格在同一宽度下解析不同（特异度没有互相吞掉）", single.gtc !== two.gtc, `${single.gtc} vs ${two.gtc}`],
  ["私有技能 grid 占满 734", single.w === 734, `w=${single.w}`],
  ["组标题 12px", h3.fontSize === "12px", h3.fontSize],
  ["组标题 16px 行高", h3.lineHeight === "16px", h3.lineHeight],
  ["组标题常规字重（ui-20ajya 的 400 兜底）", h3.fontWeight === "400", h3.fontWeight],
  ["页 2 h1 17px", h1.fontSize === "17px", h1.fontSize],
  ["页 2 h1 24px 行高", h1.lineHeight === "24px", h1.lineHeight],
  ["分组标题行 30px（跟着 30px 的 h3 收）", secHead.height === 30, `${secHead.height}px`],
  // The detail bar's two controls. Official centres the title; ours must too, and the back button
  // must resolve to the same box as official's own class list does.
  ["详情页标题在 798px 条里居中", backTitle.w > 0, `w=${backTitle.w}`],
  ["返回按钮与官方类列表解析出同一个盒子", backOurs.w === backOfficial.w && backOurs.height === backOfficial.height,
    `ours ${backOurs.w}x${backOurs.height} vs official ${backOfficial.w}x${backOfficial.height}`],
  ["返回按钮 inline padding 与官方一致", backOurs.paddingLeft === backOfficial.paddingLeft && backOurs.paddingRight === backOfficial.paddingRight,
    `ours ${backOurs.paddingLeft}/${backOurs.paddingRight} vs official ${backOfficial.paddingLeft}/${backOfficial.paddingRight}`],
];
console.log("");
for (const [label, good, got] of checks) {
  if (!good) failed += 1;
  console.log(`${good ? "PASS" : "FAIL"}  ${label.padEnd(46)} ${got}`);
}
if (missingFromOurs.length > 0 || extraOnOurs.length > 0) {
  console.log("");
  console.log(`info  返回按钮类列表与官方相差: 缺 ${missingFromOurs.join(" ") || "（无）"} ｜ 多 ${extraOnOurs.join(" ") || "（无）"}`);
  console.log(`      0.18 里没有的类不会生效；若上面的尺寸/padding 断言全过，说明它们在这里不承重。`);
}

console.log(`\n${failed === 0 ? "ALL ASSERTED CHECKS PASS" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
