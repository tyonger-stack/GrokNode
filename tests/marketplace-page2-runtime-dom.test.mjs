import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { Window } from "happy-dom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The page-2 fixes were only guarded by SOURCE assertions. That is the weakest possible guard and
 * this project has been bitten by it repeatedly: the class lists were all present, all imported,
 * all spelled correctly, and the page still rendered 55px low and its 私有技能 rows in two columns.
 *
 * This mounts the REAL `createMarketplaceDialog` into a real DOM (happy-dom) and asserts the tree
 * that comes out. It is not a substitute for the live measurement over CDP — happy-dom does no
 * layout, so nothing here says anything about pixels — but it does prove the three STRUCTURAL fixes
 * on the node tree they actually changed:
 *
 *   1. the detail bar is inside the 48px band, not inside the scroller   (pages 2 AND detail)
 *   2. a group's grid is a direct child of its section, with no 0fr wrapper between
 *   3. the single-column grid list does not also carry the two-column rule
 *
 * Pixels are the headless-CSS script's job (`npm run marketplace:css`); the deployed-artifact
 * measurement is `probe-page2-snapshot.mjs` over CDP.
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

const VIEW_SRC = "frontend/src/extensions/marketplace/view.ts";
const VIEWS = await loadEntry(VIEW_SRC, "tests-mkt-view-runtime.mjs");
const STYLES_MOD = await loadEntry(
  "frontend/src/extensions/marketplace/official-styles.ts",
  "tests-mkt-styles-runtime.mjs",
);
const { GRID_CLASSES, GRID_SINGLE_CLASSES, PIN_BAND_CLASSES, PIN_ROW_CLASSES, DETAIL_TITLE_CENTERED_CLASSES } = STYLES_MOD;

const noop = () => {};
const HANDLERS = {
  close: noop, openManage: noop, backToMarket: noop, onQuery: noop,
  onToggleInstalledExpanded: noop, onAdd: noop, onAuthenticate: noop, onOpenRow: noop,
  onOpenSkill: noop, onDeleteSkill: noop, onSaveSkill: noop, onViewAll: noop,
  onBack: noop, onUninstall: noop, onShare: noop,
};

// Every field `renderBrowse` reads, filled with empty collections. A model fixture that omits one
// fails inside the renderer on `.length of undefined` — a fixture bug masquerading as a code bug.
const emptyModel = () => ({
  rows: [], featured: [], team: [], forYou: [], categoryGroups: [], showsTrailingBrowse: false,
});

const baseState = (over) => ({
  model: emptyModel(),
  installed: [],  skills: [],
  servers: [],
  page: "browse",
  sectionGroup: null,
  detailRow: null,
  skillDetail: null,
  query: "",
  installedExpanded: false,
  busy: false,
  loading: false,
  catalogError: null,
  skillsError: null,
  ...over,
});

// Fixtures are typed to the real model shapes, not to whatever the builders happen to read this
// week. The first pass left `key`/`iconUrl`/`connectorCount` out and the builders threw on
// `.length` of undefined — a fixture that under-specifies its subject fails for a reason that has
// nothing to do with the structure under test.
const browseRow = (name) => ({
  entry: { id: name, category: "productivity", name, description: `${name} 简介`, publisher: "Acme", publisherDomain: "acme.test", tags: [] },
  id: name, name, description: `${name} 简介`, iconUrl: "",
  connectorCount: 1, skillCount: 0, isTeam: false, teamName: null,
  isInstalled: true, server: null,
});

// MANAGE_VISIBLE_ROWS is 6, so 9 installed rows is the first count that exercises the overflow
// branch. Official's 已安装 section has FOUR children — heading row, grid, collapsed holder, and the
// 显示全部 row — and the last two only exist once the overflow actually renders. A two-row fixture
// measures a different (2-child) shape and would have let the holder regress silently.
const MANAGE_VISIBLE_ROWS = 6;
const installedRow = (name) => ({
  key: name, name, subtitle: "1 个连接器", iconUrl: "", connectorCount: 1, skillCount: 0,
  status: "已连接", statusDetail: "", serverId: null, row: browseRow(name),
});
const INSTALLED = ["Gmail", "Notion", "Drive", "Slack", "Zoom", "Figma", "Linear", "Asana", "Loom"]
  .map(installedRow);
const SKILLS = [
  { name: "写周报", source: "workflow", description: "", location: "workflows/weekly.md", body: "" },
  { name: "翻译", source: "managed", description: "", location: "managed-skills/translate.md", body: "" },
];

/** Mount in a fresh window so each test starts from a clean document.
 *  `globalThis.navigator` and friends are getter-only in modern Node, so the swap goes through
 *  `defineProperty` and the restore puts the ORIGINAL descriptor back rather than a value. */
const SWAPPED = ["document", "navigator", "HTMLElement", "Node", "Event", "CustomEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"];

function mount(state) {
  const win = new Window({ url: "file:///renderer/index.html" });
  const prior = SWAPPED.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const put = (key, value) =>
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true, enumerable: false });
  put("window", win);
  for (const key of SWAPPED) {
    const v = win[key];
    if (v !== undefined) put(key, v);
  }
  let dialog;
  try {
    dialog = VIEWS.createMarketplaceDialog(state, HANDLERS);
    // The factory builds the shell and hands back `render`; it does NOT render on its own — the
    // dock extension calls `render(state)` right after. Forgetting that yields an empty body and
    // a test that "finds no groups" for a reason that has nothing to do with the code under test.
    // The layer is attached to the document because the real caller attaches it too; querying
    // `document` for a detached tree silently returns nothing and every lookup comes back undefined.
    win.document.body.append(dialog.root);
    dialog.render(state);
  } catch (e) {
    for (const [key, desc] of prior) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
    throw e;
  }
  const restoreGlobals = () => {
    for (const [key, desc] of prior) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  };
  return {
    root: dialog.root,
    doc: win.document,
    // Tear the dialog down FIRST — its `destroy()` touches `document`, so restoring the globals
    // before it runs would throw `document is not defined` and mask the real assertion.
    destroy() {
      try { dialog.destroy(); } finally { restoreGlobals(); }
    },
  };
}

const classList = (n) => String(n.getAttribute?.("class") ?? "").split(/\s+/).filter(Boolean);
const barOf = (doc) => [...doc.querySelectorAll("div")].find((e) => classList(e).includes("sand-settings-detail-bar"));
const bandOf = (doc) => [...doc.querySelectorAll("div")].find((e) => {
  const c = classList(e);
  return c.includes("sand-1c4vz4f") && c.includes("sand-2lah0s");
});
/** True when `node` sits inside `ancestor` — the structural question the band fix turns on. */
const contains = (ancestor, node) => {
  let n = node;
  while (n) {
    if (n === ancestor) return true;
    n = n.parentElement;
  }
  return false;
};

test("页 2 puts the detail bar in the 48px band, on the same band class list as every page", () => {
  const h = mount(baseState({ page: "manage", installed: INSTALLED, skills: SKILLS }));
  try {
    const bar = barOf(h.doc);
    const band = bandOf(h.doc);
    assert.ok(bar, "the manage page renders a detail bar");
    assert.ok(band, "the band is present on the manage page too");
    assert.ok(contains(band, bar), "the bar must be inside the band, not inside the scroller");

    // Official uses the SAME 17-class strip and 10-class row on 页 1, 页 2 and 插件详情 — only the
    // child changes. A page-dependent list is a plausible mechanism that no measurement supports,
    // and this build once carried a 5-class "page 2 variant" invented from a `.slice(0, 6)` probe
    // that truncated a 17-class strip down to 5.
    const bandClasses = classList(band).filter((c) => c !== "sand-mkt-pin-band");
    assert.deepEqual(bandClasses, [...PIN_BAND_CLASSES], "the band carries official's 17-class list");
    assert.equal(bandClasses.length, 17);
    // The bar sits on the 10-class row.
    const row = bar.parentElement;
    assert.deepEqual(classList(row).filter((c) => c !== "sand-mkt-band-row"), [...PIN_ROW_CLASSES]);
    assert.equal(classList(row).filter((c) => c !== "sand-mkt-band-row").length, 10);

    // The scroller's header is empty on this page — the bar is not rendered there as well.
    const header = h.root.querySelector("header");
    if (header) {
      assert.equal([...header.querySelectorAll("div")].some((d) => classList(d).includes("sand-settings-detail-bar")),
        false, "the bar must not also live in the scroller header");
    }
  } finally { h.destroy(); }
});

test("页 2 carries no search field at all, exactly like official", () => {
  const h = mount(baseState({ page: "manage", installed: INSTALLED, skills: SKILLS }));
  try {
    // Official's page 2 has zero <input> nodes. The manage page hides the in-flow field and the
    // pinned field only mounts on the browse page, so both are absent — not merely invisible.
    assert.equal(h.root.querySelectorAll("input").length, 0);
  } finally { h.destroy(); }
});

test("a pushed page (插件详情) also puts its bar in the band, with the browse band's class list", () => {
  const h = mount(baseState({
    page: "detail",
    detailRow: {
      ...browseRow("Gmail"),
      accountName: "default", vendor: "Google", publisher: "Google",
    },
  }));
  try {
    const bar = barOf(h.doc);
    const band = bandOf(h.doc);
    assert.ok(bar, "a pushed page renders a bar");
    assert.ok(contains(band, bar), "the pushed page's bar belongs in the band too");
    // Measured on official 插件详情: strip[17] > row[10] > bar — the BROWSE variants, not page 2's.
    const bandClasses = classList(band).filter((c) => c !== "sand-mkt-pin-band");
    assert.deepEqual(bandClasses, [...PIN_BAND_CLASSES]);
    assert.deepEqual(classList(bar.parentElement).filter((c) => c !== "sand-mkt-band-row"), [...PIN_ROW_CLASSES]);

    // The bar is not just a chevron. Official's is `icon-only 返回` on the left and the PAGE NAME
    // centred (measured x=367 w=130 on a 798px bar → centre 432 = the bar's midline). The row's
    // own name is the payload; a pushed page whose title is empty renders a blank bar, which is
    // what a screenshot of the market page showed before the bar was moved into the band.
    const title = bar.querySelector("h3");
    assert.ok(title, "the pushed page's bar carries a title");
    assert.equal(title.textContent, "Gmail", "the title is the row's own name");
    assert.deepEqual(classList(title), [...DETAIL_TITLE_CENTERED_CLASSES]);
    assert.equal(classList(title).length, 23, "official's 23-class title recipe");
    // The leading control is icon-only — no text node next to the glyph.
    const back = bar.querySelector("button");
    assert.ok(back, "the leading control is a button");
    assert.equal(back.getAttribute("aria-label"), "返回");
    assert.equal(back.textContent.trim(), "", "official's detail back button is icon-only");
    assert.equal(classList(back)[0], "sand-kit-icon-button");
  } finally { h.destroy(); }
});

test("the browse page keeps its bar out of the band and keeps its search field", () => {
  const h = mount(baseState({ page: "browse", installed: INSTALLED }));
  try {
    const bar = barOf(h.doc);
    const band = bandOf(h.doc);
    // Page 1 has no detail bar at all; the slot sits empty until the pinned field drops in.
    assert.equal(bar, undefined, "the browse page must not render a detail bar");
    assert.ok(band, "the band is still the pinned field's mount point on page 1");
    assert.deepEqual(classList(band).filter((c) => c !== "sand-mkt-pin-band"), [...PIN_BAND_CLASSES]);
    assert.equal(h.root.querySelectorAll("input").length, 1, "page 1 keeps exactly one search field");
  } finally { h.destroy(); }
});

test("a group's grid is a direct child of its section — no min-height:0 wrapper between", () => {
  const h = mount(baseState({ page: "manage", installed: INSTALLED, skills: SKILLS }));
  try {
    const sections = [...h.root.querySelectorAll("section")];
    const priv = sections.find((s) => /私有技能/.test(s.querySelector("h3")?.textContent ?? ""));
    const inst = sections.find((s) => /^已安装/.test(s.querySelector("h3")?.textContent?.trim() ?? ""));
    assert.ok(priv && inst, "both groups render");

    for (const [name, sec] of [["私有技能", priv], ["已安装", inst]]) {
      const ul = sec.querySelector("ul");
      assert.ok(ul, `${name} renders a grid`);
      assert.equal(ul.parentElement, sec,
        `${name}: the grid must be the section's own child — a wrapper div means a stray 0fr layer`);
      // The regression was a wrapper div between the section and its grid — the `min-height:0`
      // pair hoisted to the top of the body. Expressed as "no direct child of the section is an
      // ancestor of the grid", which is the actual invariant, rather than as a class blacklist:
      // official DOES carry `sand-2lwn1j` on the 显示全部 row and inside the collapsed holder, so
      // asserting the class never appears would be asserting something false.
      const wrapper = [...sec.children].find((c) => c !== ul && contains(c, ul));
      assert.equal(wrapper, undefined,
        `${name}: nothing may sit between the section and its grid (found ${wrapper?.className})`);
      // …and the 0fr helper is still where official puts it: inside the holder, and around the
      // 显示全部 row. Scanned as a plain list, not `:scope >` — happy-dom's selector coverage
      // differs from Chrome's and a mis-selecting test is worse than no test.
      if (sec === inst) {
        assert.equal(inst.children[2].firstElementChild.classList.contains("sand-2lwn1j"), true,
          "the collapsed overflow holder keeps its min-height:0 child");
        assert.equal(inst.children[3].classList.contains("sand-2lwn1j"), true,
          "the 显示全部 row keeps its min-height:0 box");
      }
    }
    // Official's 已安装 section has exactly 4 children: heading row, grid, holder, 显示全部 row.
    // The last two only render once the overflow exists, which is why the fixture carries
    // MANAGE_VISIBLE_ROWS + 3 installed rows.
    assert.equal(inst.children.length, 4, "已安装 keeps official's four children");
    assert.equal(inst.children[2].getAttribute("aria-hidden"), "true", "the holder is collapsed");
    assert.equal(inst.children[2].hasAttribute("inert"), true);
  } finally { h.destroy(); }
});

test("私有技能's grid does not also carry the two-column rule", () => {
  const h = mount(baseState({ page: "manage", installed: INSTALLED, skills: SKILLS }));
  try {
    const priv = [...h.root.querySelectorAll("section")]
      .find((s) => /私有技能/.test(s.querySelector("h3")?.textContent ?? ""));
    const privClasses = classList(priv.querySelector("ul"));
    const inst = [...h.root.querySelectorAll("section")]
      .find((s) => /^已安装/.test(s.querySelector("h3")?.textContent?.trim() ?? ""));
    const instClasses = classList(inst.querySelector("ul"));

    assert.ok(!privClasses.includes("sand-nby9oq"),
      "the single-column grid must not carry the two-column rule — equal specificity means "
      + "stylesheet order decides, and the two-column rule is last");
    assert.ok(privClasses.includes("sand-1mkdm3x"));
    assert.ok(instClasses.includes("sand-nby9oq"));
    // The two lists must actually differ; a test that only checked "single is single" would still
    // pass if both collapsed to the same answer.
    assert.notDeepEqual(privClasses, instClasses);
    assert.deepEqual(privClasses, [...GRID_SINGLE_CLASSES]);
    assert.deepEqual(instClasses, [...GRID_CLASSES]);
  } finally { h.destroy(); }
});
