import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { Window } from "happy-dom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The detail page's inner sections (账户 / 工具 / 应用 / 信息) shipped with three separate class
 * lists that were wrong, behind a fully green suite, because the two guards that existed both
 * looked somewhere else.
 *
 * What the live CDP diff against official 0.66.0 (Gmail detail page) actually measured:
 *
 *   1. 账户 / 工具 / 信息 headings aliased DETAIL_NAME_CLASSES — the *plugin name* recipe. The two
 *      share their first 13 `ui-*` classes and then diverge (detail body:
 *      `ui-1wm8ruf ui-spwq11 ui-14s4slr`; name: `ui-11wthnw ui-1ja60sm ui-vu1jfw`). Measured
 *      734x24 against official's 734x30, three times over.
 *   2. The 应用 sub-header row was missing its first three classes. `sand-78zum5` is `display:flex`
 *      and `sand-6s0dn4` is `align-items:center`, so the row fell back to `display:block` and the
 *      count wrapped: `应用` 706x24 stacked over `1` 8x20, against official's `应用` 24x16 beside
 *      `1` 6x16.
 *   3. The connector name/连接器 stack was a bare `<span>` with no class at all, so
 *      `gmail连接器` rendered on one 69px line against official's 36x34 two-line column.
 *
 * The `pad` measurement matters for (2): local already computed `8px 14px 6px`, identical to
 * official, because `sand-1pic42t` / `sand-1onr9mi` resolve through LIFTED_OFFICIAL_RULES rather
 * than the 0.18 stylesheet. Grepping the stylesheet for them says "absent" and is misleading —
 * the padding was never the problem. Only `display:flex` was.
 *
 * These are RUNTIME assertions for the same reason the page-2 guards are: a source assertion
 * cannot tell whether the heading node in the tree actually received the list. happy-dom does no
 * layout, so nothing here claims anything about pixels — that stays `npm run marketplace:css`
 * plus the deployed-artifact CDP measurement.
 */

const jsToTs = {
  name: "js-to-ts",
  setup(builder) {
    builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
      const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
      return existsSync(candidate) ? { path: candidate } : null;
    });
  },
};

async function loadEntry(entry, outName) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", outName);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    plugins: [jsToTs],
  });
  return import(pathToFileURL(outfile).href);
}

const VIEWS = await loadEntry(
  "frontend/src/extensions/marketplace/view.ts",
  "tests-mkt-detail-sections-runtime.mjs",
);
const STYLES = await loadEntry(
  "frontend/src/extensions/marketplace/official-styles.ts",
  "tests-mkt-detail-sections-styles.mjs",
);
const {
  DETAIL_ACCOUNT_TITLE_CLASSES,
  DETAIL_APP_COUNT_CLASSES,
  DETAIL_CONNECTOR_TEXT_CLASSES,
  DETAIL_HEADING_TYPOGRAPHY_CLASSES,
  DETAIL_HEADING_WIDE_CLASSES,
  DETAIL_SECTION_TITLE_CLASSES,
  DETAIL_SUBSECTION_ROW_CLASSES,
  DETAIL_SUBSECTION_TITLE_CLASSES,
} = STYLES;

const noop = () => {};
const HANDLERS = {
  close: noop, openManage: noop, backToMarket: noop, onQuery: noop,
  onToggleInstalledExpanded: noop, onAdd: noop, onAuthenticate: noop, onOpenRow: noop,
  onOpenSkill: noop, onDeleteSkill: noop, onSaveSkill: noop, onViewAll: noop,
  onBack: noop, onUninstall: noop, onShare: noop,
};

const emptyModel = () => ({
  rows: [], featured: [], team: [], forYou: [], categoryGroups: [], showsTrailingBrowse: false,
});

const browseRow = (name) => ({
  entry: { id: name, category: "productivity", name, description: `${name} 简介`, publisher: "Acme", publisherDomain: "acme.test", tags: [] },
  id: name, name, description: `${name} 简介`, iconUrl: "",
  connectorCount: 1, skillCount: 0, isTeam: false, teamName: null,
  isInstalled: true, server: null,
});

const baseState = (over) => ({
  model: emptyModel(),
  installed: [], skills: [], servers: [],
  page: "browse", sectionGroup: null, detailRow: null, skillDetail: null,
  query: "", installedExpanded: false, busy: false, loading: false,
  catalogError: null, skillsError: null,
  ...over,
});

const SWAPPED = ["document", "navigator", "HTMLElement", "Node", "Event", "CustomEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"];

function mountDetail() {
  const win = new Window({ url: "file:///renderer/index.html" });
  const prior = SWAPPED.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const put = (key, value) =>
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true, enumerable: false });
  put("window", win);
  for (const key of SWAPPED) {
    const v = win[key];
    if (v !== undefined) put(key, v);
  }
  const state = baseState({
    page: "detail",
    detailRow: {
      ...browseRow("Gmail"),
      // `entry.connectors` is what `buildPluginDetail` maps into the 应用 list, so the fixture has
      // to carry one or the section renders its heading with a count of 0 and no rows at all — a
      // fixture that under-specifies its subject fails for a reason unrelated to what is under test.
      entry: { ...browseRow("Gmail").entry, connectors: [{ name: "gmail", description: "" }] },
      accountName: "default", vendor: "Google", publisher: "Google",
    },
    // 账户 and 工具 are gated on the plugin being installed: `isInstalled` is `server != null`, and
    // `detail.accounts` / `detail.toolsLabel` both derive from it. With `servers: []` the detail
    // page silently omits two of the four sections under test and the assertions below would be
    // measuring an empty fixture rather than a regression.
    servers: [
      { id: "gmail", name: "Gmail", url: "https://cursor.com", status: "已连接", statusDetail: "", toolCount: 23, accountKey: "default", isTeamServer: false },
    ],
  });
  let dialog;
  const restore = () => {
    for (const [key, desc] of prior) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  };
  try {
    dialog = VIEWS.createMarketplaceDialog(state, HANDLERS);
    win.document.body.append(dialog.root);
    dialog.render(state);
  } catch (e) {
    restore();
    throw e;
  }
  return {
    doc: win.document,
    destroy() { try { dialog.destroy(); } finally { restore(); } },
  };
}

const classList = (n) => String(n.getAttribute?.("class") ?? "").split(/\s+/).filter(Boolean);

/** The `h3` whose own text is exactly `label` — the heading itself, not a wrapper. */
const headingFor = (doc, label) =>
  [...doc.querySelectorAll("h3")].find((e) => e.textContent.trim() === label);

test("账户 keeps its own 22-class heading; 工具 / 信息 use official's 18-class one", () => {
  const h = mountDetail();
  try {
    // Official does NOT use one list for the three. 账户 carries four `ui-*` classes that 工具 and
    // 信息 do not, and the four compute to nothing different — which is precisely why a source
    // assertion cannot settle it and why the split is transcribed rather than normalised.
    assert.deepEqual(classList(headingFor(h.doc, "账户")), [...DETAIL_ACCOUNT_TITLE_CLASSES]);
    for (const label of ["工具", "信息"]) {
      assert.deepEqual(
        classList(headingFor(h.doc, label)),
        [...DETAIL_SECTION_TITLE_CLASSES],
        `${label} carries official's 18-class list`,
      );
    }
    assert.equal(DETAIL_ACCOUNT_TITLE_CLASSES.length, 22, "official's 账户 heading is 22 classes");
    assert.equal(DETAIL_SECTION_TITLE_CLASSES.length, 18, "official's 工具 / 信息 heading is 18 classes");
    assert.equal(DETAIL_HEADING_TYPOGRAPHY_CLASSES.length, 12, "the 12-class base");
    assert.equal(DETAIL_HEADING_WIDE_CLASSES.length, 16, "the 16-class width");
    // The two widths are nested, not unrelated — that is what makes the 4-class gap checkable.
    for (const cls of DETAIL_HEADING_TYPOGRAPHY_CLASSES) {
      assert.ok(DETAIL_HEADING_WIDE_CLASSES.includes(cls), `${cls} is in both widths`);
    }
    for (const cls of DETAIL_HEADING_WIDE_CLASSES) {
      assert.ok(DETAIL_ACCOUNT_TITLE_CLASSES.includes(cls), `账户 keeps ${cls}`);
    }
    // Both carry the tertiary colour class and the same 5 padding classes.
    for (const cls of ["ui-4b2ntj", "sand-9f619", "sand-1y1aw1k", "sand-1pic42t", "sand-10b6aqq", "sand-1onr9mi"]) {
      for (const list of [DETAIL_ACCOUNT_TITLE_CLASSES, DETAIL_SECTION_TITLE_CLASSES]) {
        assert.ok(list.includes(cls), `both headings need ${cls}`);
      }
    }
    // The regression this guards is the ALIAS: sharing the plugin-NAME recipe silently produced
    // 24px headings. The name recipe's width must not be either of these two.
    assert.notDeepEqual(DETAIL_SECTION_TITLE_CLASSES, DETAIL_HEADING_WIDE_CLASSES);
  } finally { h.destroy(); }
});

test("the 应用 sub-header row is a flex row, so 应用 and its count share one line", () => {
  const h = mountDetail();
  try {
    const heading = headingFor(h.doc, "应用");
    assert.ok(heading, "the detail page renders an 应用 heading");
    const row = heading.parentElement;
    assert.deepEqual(classList(row), [...DETAIL_SUBSECTION_ROW_CLASSES], "the row carries official's 8 classes");
    // These three are the fix. `sand-78zum5` is `display:flex`; without it the row is a block and
    // the count drops onto its own line.
    for (const cls of ["sand-9f619", "sand-78zum5", "sand-6s0dn4"]) {
      assert.ok(DETAIL_SUBSECTION_ROW_CLASSES.includes(cls), `the row needs ${cls} — display:flex lives here`);
    }

    // The heading and the count are NOT the same list: official ends them with different colour
    // classes and they measure 24x16 against 6x16.
    assert.deepEqual(classList(heading), [...DETAIL_SUBSECTION_TITLE_CLASSES]);
    assert.deepEqual(classList(heading).at(-1), "ui-1wd3ewq", "official uses the low-specificity ui-* variant here, not sand-1wd3ewq");
    const count = [...row.children].find((c) => c.tagName === "SPAN");
    assert.ok(count, "the row carries the connector count");
    assert.equal(count.textContent.trim(), "1", "one connector in the fixture");
    assert.deepEqual(classList(count), [...DETAIL_APP_COUNT_CLASSES]);
    assert.deepEqual(classList(count).at(-1), "sand-4b2ntj");
    // The old list had six ui-* classes and no sand tail; that is what left the count unstyled.
    assert.equal(DETAIL_APP_COUNT_CLASSES.length, 17, "official's 17-class count");
  } finally { h.destroy(); }
});

test("the connector name/连接器 stack is a column, so the kind sits on its own line", () => {
  const h = mountDetail();
  try {
    const row = [...h.doc.querySelectorAll(".sand-plugins-detail__connectors > *")][0];
    assert.ok(row, "the detail page renders a connectors row");
    const text = [...row.children].find((c) => c.tagName === "SPAN" && c.children.length > 0);
    assert.ok(text, "the connectors row has a text stack");
    // `sand-dt5ytf` is `flex-direction:column` — the whole reason gmail and 连接器 stack.
    assert.deepEqual(classList(text), [...DETAIL_CONNECTOR_TEXT_CLASSES]);
    assert.deepEqual(DETAIL_CONNECTOR_TEXT_CLASSES, ["sand-78zum5", "sand-dt5ytf", "sand-euugli"]);
    // Two children, not one text node: measured on official, the stack holds a name span over a
    // kind span, which is also what the source's NAME/KIND lists exist for.
    assert.equal(text.children.length, 2, "name over kind, two elements");
    assert.equal(text.children[0].textContent.trim(), "gmail");
    assert.equal(text.children[1].textContent.trim(), "连接器");
    // A bare `el("span", [])` is the regression: it collapses to one 69px line.
    assert.notDeepEqual(classList(text), [], "the text stack must not be an unclassed span");
  } finally { h.destroy(); }
});

test("the lifted inline-padding classes stay in the shipped rules", () => {
  // `sand-1pic42t` / `sand-1onr9mi` exist in NEITHER the 0.18 stylesheet nor official's own dump
  // of that version — they only resolve through LIFTED_OFFICIAL_RULES. Deleting the entry makes
  // the 14px inset vanish with no test above turning red, because they are applied correctly
  // either way; only the geometry moves. So assert the lift itself is still shipped.
  const view = readFileSync(
    path.join(repoRoot, "frontend", "src", "extensions", "marketplace", "view.ts"),
    "utf8",
  );
  assert.match(view, /LIFTED_OFFICIAL_RULES/);
  const styles = readFileSync(
    path.join(repoRoot, "frontend", "src", "extensions", "marketplace", "official-styles.ts"),
    "utf8",
  );
  for (const cls of ["sand-1pic42t", "sand-1onr9mi"]) {
    assert.ok(styles.includes(`"${cls}"`), `${cls} must stay in the shipped class lists`);
  }
});
