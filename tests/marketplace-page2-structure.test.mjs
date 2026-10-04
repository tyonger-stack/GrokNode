import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(repoRoot, ...p), "utf8");
const VIEW = read("frontend", "src", "extensions", "marketplace", "view.ts");
const STYLES = read("frontend", "src", "extensions", "marketplace", "official-styles.ts");

const classesOf = (name) => {
  const i = STYLES.indexOf(`export const ${name}`);
  assert.ok(i >= 0, `official-styles.ts has no ${name}`);
  const s = STYLES.indexOf("[", i);
  const e = STYLES.indexOf("]", s);
  return (STYLES.slice(s, e).match(/"([^"]+)"/g) ?? []).map((x) => x.slice(1, -1));
};

/** The LIFTED_OFFICIAL_RULES array only. Slicing from the declaration name to the end of the file
 *  would sweep in every class list declared after it, which is most of this module. */
const liftedClasses = () => {
  const i = STYLES.indexOf("export const LIFTED_OFFICIAL_RULES");
  assert.ok(i >= 0, "LIFTED_OFFICIAL_RULES exists");
  const s = STYLES.indexOf("[", i);
  const e = STYLES.indexOf("\n];", s);
  assert.ok(e > s, "LIFTED_OFFICIAL_RULES has a terminator");
  return (STYLES.slice(s, e).match(/"([^"]+)"/g) ?? []).map((x) => x.slice(1, -1));
};

/**
 * 管理插件和技能 (page 2) rendered nothing like official, behind a fully green suite.
 *
 * These are SOURCE assertions about the class recipes and the DOM shape the builders emit. They are
 * not, and must not be reported as, runtime proof: the geometry these defects produced (698px vs
 * 339px rows, a bar 55px low and 64px narrow, 37px vs 24px headings) was measured on the DEPLOYED
 * artifact over CDP and archived in docs/evidence/marketplace-page2-parity-live.json. Source
 * assertions are what keep the recipe from being re-broken between those measurements.
 *
 * Every class asserted below already exists in 0.18 with a byte-identical rule, so none of them may
 * ever be "fixed" by adding a LIFTED_OFFICIAL_RULES entry — that would be a redundant lift that
 * silently drifts from upstream.
 */

test("私有技能 uses a single-column grid that does not also carry the two-column rule", () => {
  // Both rules have the SAME specificity — `.sand-nby9oq:not(#):not(#):not(#)` and
  // `.sand-1mkdm3x:not(#):not(#):not(#)` are both (3 ids, 1 class) — so a grid carrying both is
  // decided by stylesheet order, and the two-column rule is last. Official simply does not put
  // `sand-nby9oq` on the single-column list. The old `[...GRID_CLASSES, "sand-1mkdm3x"]` did, and
  // every 私有技能 row came out 339px inside a 363px column instead of 698px inside 734px.
  const full = classesOf("GRID_SINGLE_CLASSES");
  assert.deepEqual(full, [
    "sand-plugins__grid",
    "sand-9f619", "sand-rvj5dj",
    "sand-1ap1fj8", "sand-1dbijih", "sand-3ct3a4", "sand-dj266r",
    "sand-14z9mp", "sand-at24cr", "sand-1lziwak", "sand-exx8yu", "sand-yri2b", "sand-18d9i69",
    "sand-1c1uobl",
    "sand-1mkdm3x",
  ]);
  assert.ok(!full.includes("sand-nby9oq"), "the two-column rule must not ride along");
  // 私有技能 and the featured-section page must be the SAME list, not two that happen to agree.
  assert.match(
    STYLES,
    /export const GRID_FULLWIDTH_CLASSES = GRID_SINGLE_CLASSES;/,
    "the full-width variant must alias the single-column list, not restate it",
  );
  assert.doesNotMatch(STYLES, /GRID_CLASSES\s*\+|\[\.\.\.GRID_CLASSES/, "never derive a grid variant from the two-column one");
  // The installed grid still is the two-column one.
  assert.ok(classesOf("GRID_CLASSES").includes("sand-nby9oq"));
});

test("a group's grid hangs off the section, not off a min-height:0 wrapper", () => {
  // `OVERFLOW_INNER_CLASSES` is `min-height:0;overflow:hidden` — the 0fr collapse helper. Official
  // carries it around the overflow holder and around the 显示全部 row, never around the whole body.
  // Wrapping the body put an extra `div` between the section and its grid: 私有技能 measured
  // DIV 734x221 where official has the grid itself, and 已安装 lost official's 4-child section.
  assert.match(
    VIEW,
    /function buildGroupSection\(title: string, titleId: string, \.\.\.bodies: HTMLElement\[\]\): HTMLElement/,
    "buildGroupSection must stay variadic so the grid is a direct child of the section",
  );
  assert.match(VIEW, /section\.append\(\.\.\.bodies\);/);
  const manage = VIEW.slice(VIEW.indexOf("function renderManage"));
  assert.ok(manage.length > 0, "renderManage exists");
  const manageBody = manage.slice(0, manage.indexOf("groups.replaceChildren"));
  // A top-level body wrapper is the regression: it put a `div` between the section and its grid.
  assert.doesNotMatch(manageBody, /installedBody|skillBody/, "no top-level body wrapper");
  // The 0fr helper stays exactly where official has it: the overflow holder and the 显示全部 row.
  const holders = manageBody.match(/el\("div", OVERFLOW_INNER_CLASSES\)/g) ?? [];
  assert.equal(holders.length, 2, "the 0fr wrapper belongs to the overflow holder and the 显示全部 row only");
  assert.match(manageBody, /const installedNodes: HTMLElement\[\] = \[\];/);
  assert.match(manageBody, /buildGroupSection\(TEXT\.installed, "mkt-installed", \.\.\.installedNodes\)/);
  assert.match(manageBody, /buildGroupSection\(TEXT\.privateSkills, "mkt-private-skills", \.\.\.skillNodes\)/);
  // The grids are the section's direct children, and each names its own section for a11y.
  assert.match(manageBody, /const grid = el\("ul", GRID_CLASSES\);\s*\n\s*grid\.setAttribute\("aria-labelledby", "mkt-installed"\);/);
  assert.match(manageBody, /const grid = el\("ul", GRID_FULLWIDTH_CLASSES\);\s*\n\s*grid\.setAttribute\("aria-labelledby", "mkt-private-skills"\);/);
});

test("the detail bar fills the 48px band instead of sitting inside the scroller", () => {
  // Measured on official: the band is ONE element reused by both pages. 页 1 holds the mount point
  // the pinned search drops into; 页 2 and every pushed page hold `sand-settings-detail-bar` at
  // 798x48 y=161, with the scroller starting right below. Rendered in the scroller's header the bar
  // measured 734x48 y=216 — the whole of page 2, and of 插件详情, sat 55px low and 64px narrow.
  assert.deepEqual(classesOf("MANAGE_BAND_CLASSES"), [
    "sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-1c4vz4f", "sand-2lah0s",
  ]);
  assert.deepEqual(classesOf("MANAGE_BAND_ROW_CLASSES"), [
    "sand-78zum5", "sand-dt5ytf", "sand-1iyjqo2", "sand-s83m0k", "sand-2lwn1j",
  ]);
  assert.match(VIEW, /const mountBar = \(bar: HTMLElement, rowClasses: readonly string\[\]\): void =>/);
  // 页 2 uses its own 5-class row; a pushed page keeps the browse row (measured on 插件详情).
  assert.match(VIEW, /mountBar\(bar, MANAGE_BAND_ROW_CLASSES\);/);
  assert.match(VIEW, /mountBar\(bar, PIN_ROW_CLASSES\);/);
  // No page may put the bar back in the scroller header.
  assert.doesNotMatch(VIEW, /header\.append\(bar\);/);
  // `setBandPage` must REPLACE the strip's class list. `applyClasses` only adds, so a browse→manage
  // swap would otherwise leave the 17-class list in place and the two variants would never differ.
  assert.match(VIEW, /const setBandPage = \(manage: boolean\): void =>/);
  assert.match(VIEW, /setClasses\(pinBand, \[\.\.\.\(manage \? MANAGE_BAND_CLASSES : PIN_BAND_CLASSES\), PIN_BAND_MARKER\]\)/);
  assert.match(VIEW, /function setClasses\(element: Element, classNames: readonly string\[\]\): void \{\s*\n\s*element\.className = classNames\.join\(" "\);/);
});

test("the group heading carries 0.66's `ui-*` typography family", () => {
  // 22 classes on official. The leading `ui-*` block is what pins the heading to 12px/16px regular;
  // without it the heading fell back to the inherited 15.21px bold and measured 35px tall against
  // official's 30px, taking the whole section header with it (65px vs 30px).
  const title = classesOf("GROUP_TITLE_CLASSES");
  assert.deepEqual(title, [
    "ui-text",
    "ui-1acoasx", "ui-dj266r", "ui-14z9mp", "ui-at24cr", "ui-1lziwak", "ui-exx8yu", "ui-yri2b",
    "ui-18d9i69", "ui-1c1uobl", "ui-vmahel", "ui-lh3980", "ui-1wm8ruf", "ui-spwq11", "ui-14s4slr",
    "ui-20ajya",
    "sand-9f619", "sand-1y1aw1k", "sand-f159sx", "sand-10b6aqq", "sand-1g0dm76", "sand-4b2ntj",
  ]);
  // `ui-20ajya` is the class that un-bolds it: official's declaration carries a `,400` fallback, and
  // 0.18 does not define --cursor-font-weight-normal, so it resolves to 400 here as it must.
  // `ui-text` is exempt because it is a semantic hook with NO rule in either stylesheet.
  const lifted = liftedClasses();
  for (const cls of [...title, ...classesOf("MANAGE_H1_CLASSES")]) {
    if (cls === "ui-text") continue;
    assert.ok(!lifted.includes(cls), `${cls} exists natively in 0.18 and must never be lifted`);
  }
});

test("the page-2 headings and its section row carry official's type recipe", () => {
  // 6 classes; the first three are the missing 17px/24px/-0.008em recipe. Without them 管理插件和技能
  // inherited 26px and measured 37px tall against official's 24px.
  assert.deepEqual(classesOf("MANAGE_H1_CLASSES"), [
    "sand-19d36u7", "sand-1o2sk6j", "sand-1deyeav", "sand-1ghz6dp", "sand-1wd3ewq", "sand-1rhlpx6",
  ]);
  // 23 classes; the leading three are font-size/line-height/letter-spacing. Without them the 管理
  // title measured 15.21px against official's 14px.
  const detail = classesOf("DETAIL_TITLE_CLASSES");
  assert.equal(detail.length, 23);
  assert.deepEqual(detail.slice(0, 3), ["sand-fc7y3v", "sand-1fc57z9", "sand-12oo3zp"]);
  // Official's section heading row is 5 classes. The extra `sand-euugli` (`min-width:0`) is not
  // official's and belongs to a flex-item recipe this row does not use.
  assert.deepEqual(classesOf("SECTION_ROW_CLASSES"), [
    "sand-9f619", "sand-78zum5", "sand-1pha0wt", "sand-1qughib", "sand-167g77z",
  ]);
});
