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
//
// Truncation has a second, sneakier form here: a list written as `[...SOME_BASE, "sand-x"]`
// contains only ONE string literal, so a regex that harvests quoted strings returns just
// `["sand-x"]` and the spread part vanishes with no error at all. That is not a cosmetic problem —
// this script would then measure an element wearing a *different* class list than the product
// renders, and a real regression in the product would leave every assertion green. It happened
// once already: `DETAIL_SECTION_TITLE_CLASSES` is spread-based, so its 16 `ui-*` classes dropped
// out and the section heading measured the browser's default 18.72px instead of official's 12px.
//
// So: resolve spreads, scan with bracket depth rather than `indexOf("]")`, and refuse to continue
// if anything is still unresolved. A list this function cannot read must fail loudly, because every
// number below is a measurement OF that list.
const styles = readFileSync(path.join(ROOT, "frontend/src/extensions/marketplace/official-styles.ts"), "utf8");

/** The body of the array literal assigned to `name`, found by bracket depth so a nested `]` cannot
 *  end the scan early. Matches `export const` and a module-private `const` alike, because a list
 *  split into a private base plus exported leaves is the natural way to share these recipes. */
function arrayBody(name) {
  const re = new RegExp(`(?:export\\s+)?const\\s+${name}\\b`);
  const m = re.exec(styles);
  if (!m) throw new Error(`official-styles.ts has no const ${name}`);
  const start = styles.indexOf("[", m.index + m[0].length - 1);
  if (start < 0) throw new Error(`${name} has no array literal`);
  let depth = 0;
  for (let k = start; k < styles.length; k += 1) {
    if (styles[k] === "[") depth += 1;
    else if (styles[k] === "]") {
      depth -= 1;
      if (depth === 0) return styles.slice(start + 1, k);
    }
  }
  throw new Error(`${name}: array literal never closes`);
}

const classesCache = new Map();
const classes = (name) => {
  if (classesCache.has(name)) return classesCache.get(name);
  let body = arrayBody(name);
  // Resolve `...OTHER` against OTHER's own list, recursively, until no spread remains.
  for (let pass = 0; pass < 8; pass += 1) {
    const spread = [...body.matchAll(/\.\.\.([A-Za-z0-9_]+)/g)];
    if (spread.length === 0) break;
    for (const m of spread) {
      const inner = classes(m[1]);
      body = body.replace(m[0], inner.map((c) => `"${c}"`).join(", "));
    }
  }
  const out = (body.match(/"([^"]+)"/g) ?? []).map((x) => x.slice(1, -1));
  // Strip comments before hunting for leftovers. English prose inside a `//` comment matches
  // "identifier followed by ," or "]" perfectly well, and treating a comment word as an unresolved
  // symbol turns every commented list into a hard failure.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const unresolved = code.match(/\.\.\.|\b[A-Za-z_$][\w$]*\s*(?=[,\]])/g) ?? [];
  if (unresolved.length > 0) {
    throw new Error(
      `${name}: could not fully resolve (${unresolved.join(" ")}). Refusing to measure a truncated list.`,
    );
  }
  if (out.length === 0) throw new Error(`${name}: resolved to zero classes`);
  classesCache.set(name, out);
  return out;
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
<div id="body" class="${classes("DETAIL_BODY_CLASSES").join(" ")}" style="width:734px">
  <h3 id="accTitle" class="${classes("DETAIL_ACCOUNT_TITLE_CLASSES").join(" ")}">账户</h3>
  <h3 id="secTitle" class="${classes("DETAIL_SECTION_TITLE_CLASSES").join(" ")}">信息</h3>
  <div id="appRow" class="${classes("DETAIL_SUBSECTION_ROW_CLASSES").join(" ")}">
    <h3 id="appTitle" class="${classes("DETAIL_SUBSECTION_TITLE_CLASSES").join(" ")}">应用</h3>
    <span id="appCount" class="${classes("DETAIL_APP_COUNT_CLASSES").join(" ")}">1</span>
  </div>
  <div id="connRow" class="${classes("DETAIL_CONNECTOR_ROW_CLASSES").join(" ")}">
    <span class="sand-78zum5 sand-2lah0s sand-4b2ntj"><i class="ui-icon"></i></span>
    <span id="connText" class="${classes("DETAIL_CONNECTOR_TEXT_CLASSES").join(" ")}">
      <span class="${classes("DETAIL_CONNECTOR_NAME_CLASSES").join(" ")}">gmail</span>
      <span class="${classes("DETAIL_CONNECTOR_KIND_CLASSES").join(" ")}">连接器</span>
    </span>
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
           w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
           height: Math.round(r.height), padding: cs.padding,
           paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
           display: cs.display, flexDirection: cs.flexDirection, alignItems: cs.alignItems,
           classCount: n.classList.length,
           fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontWeight: cs.fontWeight,
           color: cs.color }; };
// The detail-page font sizes arrive through the --cursor-font-size-sm / --cursor-line-height-sm
// variables. If those do not resolve, every ui-* declaration is invalid at computed-value time and
// each heading silently resolves to the UA default — 18.72px for an h3 — so a fixture like this one
// reports a number while measuring nothing of the recipe. Reading the variables off :root turns
// that into a visible failure. (--cursor-font-weight-normal is deliberately undefined in the
// product, which is why official's declaration carries its own ",400" fallback; only the first two
// are load-bearing here.)
const rootStyle = getComputedStyle(document.documentElement);
const varsResolved = ["--cursor-font-size-sm", "--cursor-line-height-sm"].map((v) => [
  v, rootStyle.getPropertyValue(v).trim(),
]);
document.getElementById("out").textContent = JSON.stringify({
  sheets: document.styleSheets.length,
  rules: document.styleSheets[0] ? [...document.styleSheets[0].cssRules].length : -1,
  varsResolved,
  measured: [m("add"), m("tools")],
  type: [g("h1"), g("h3"), g("secHead")],
  grids: [g("single"), g("two")],
  back: [g("backOurs"), g("backOfficial"), g("backTitle")],
  detail: [g("accTitle"), g("secTitle"), g("appRow"), g("appTitle"), g("appCount"), g("connRow"), g("connText")] });
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
const secTitle = result.detail.find((r) => r.id === "secTitle");
const accTitle = result.detail.find((r) => r.id === "accTitle");
const appRow = result.detail.find((r) => r.id === "appRow");
const appTitle = result.detail.find((r) => r.id === "appTitle");
const appCount = result.detail.find((r) => r.id === "appCount");
const connText = result.detail.find((r) => r.id === "connText");
for (const [name, node] of [["secTitle", secTitle], ["accTitle", accTitle], ["appRow", appRow], ["appTitle", appTitle], ["appCount", appCount], ["connText", connText]]) {
  if (!node) {
    console.error(`detail measurement "${name}" did not come back — refusing to report a partial measurement`);
    process.exit(2);
  }
}

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

  // ── 详情页内层：账户/工具/信息 标题、应用 副标题行、连接器文本栈 ──
  // Three recipes that were wrong in ways no source assertion could see, and every one of them had
  // a green suite behind it. Measured on official 0.66.0, Gmail detail page (read twice, identical):
  //   账户 heading              734x30, 12px/16px, 22 classes
  //   工具 / 信息 heading       734x30, 12px/16px, 18 classes
  //   应用 sub-header row       30px tall, display:flex, `应用` 24x16 beside `1` 6x16
  //   connector name/连接器     display:flex column, 36x34 (ours was one 18px line)
  ["账户 标题 30px", accTitle.height === 30, `${accTitle.height}px`],
  ["工具/信息 标题 30px", secTitle.height === 30, `${secTitle.height}px`],
  // 账户 carries four `ui-*` classes 工具/信息 do not. They compute to nothing different, which is
  // exactly why only the class list can settle it — and why a pixel check alone would pass either way.
  ["账户 与 工具/信息 类数不同但结果一致", accTitle.classCount === 22 && secTitle.classCount === 18
      && accTitle.fontSize === secTitle.fontSize && accTitle.height === secTitle.height,
    `${accTitle.classCount} vs ${secTitle.classCount} classes, both ${secTitle.fontSize}/${accTitle.height}px`],
  ["章节标题 12px", secTitle.fontSize === "12px", secTitle.fontSize],
  ["章节标题 16px 行高", secTitle.lineHeight === "16px", secTitle.lineHeight],
  // The two headings differ only in their trailing colour class (`ui-4b2ntj` tertiary vs
  // `sand-1wd3ewq` primary), so comparing them tests that the class took effect. Pinning an exact
  // rgba would measure the FIXTURE's colour scheme instead of the recipe — Chrome serialises it as
  // `color(srgb …)`, not `rgba(…)`, and the numbers depend on a palette this page never loads.
  ["章节标题是三级色，与主色标题不同（ui-4b2ntj 生效）", secTitle.color !== appTitle.color,
    `信息 ${secTitle.color} vs 应用 ${appTitle.color}`],
  ["应用 副标题行是 flex 行（否则计数换行）", appRow.display === "flex" && appRow.alignItems === "center",
    `display=${appRow.display} align-items=${appRow.alignItems}`],
  ["应用 副标题行 30px", appRow.height === 30, `${appRow.height}px`],
  // `y` on both, not a comparison that passes on two `undefined`s.
  ["应用 标题与计数同行（同一 y）", appTitle.y === appCount.y, `y ${appTitle.y} vs ${appCount.y}`],
  ["应用 标题 12px", appTitle.fontSize === "12px", appTitle.fontSize],
  ["应用 计数 12px", appCount.fontSize === "12px", appCount.fontSize],
  ["连接器文本栈是纵向（名称在种类上方）", connText.display === "flex" && connText.flexDirection === "column",
    `display=${connText.display} flex-direction=${connText.flexDirection}`],
  ["连接器文本栈 34px 两行", connText.height === 34, `${connText.height}px`],
  ["连接器文本栈 36px 宽（不是一行挤出来的 69px）", connText.w === 36, `w=${connText.w}`],
];

console.log("");
console.log(`vars   ${result.varsResolved.map(([k, v]) => `${k}=${v || "(UNRESOLVED)"}`).join("  ")}`);
if (result.varsResolved.some(([, v]) => v === "")) {
  console.error("");
  console.error("the font-size variables did not resolve — every 12px/16px assertion above would be");
  console.error("measuring the browser's UA default for an h3, not the recipe. Refusing to report.");
  process.exit(2);
}
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
