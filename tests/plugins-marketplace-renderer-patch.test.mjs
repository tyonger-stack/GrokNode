import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const EXT_DIR = path.join(import.meta.dirname, "..", "frontend/src/extensions");
const DOCK = readFileSync(path.join(EXT_DIR, "plugins-dock-entry.ts"), "utf8");
const STYLES = readFileSync(path.join(EXT_DIR, "marketplace/official-styles.ts"), "utf8");
const VIEW = readFileSync(path.join(EXT_DIR, "marketplace/view.ts"), "utf8");
const INDEX = readFileSync(path.join(EXT_DIR, "marketplace/index.ts"), "utf8");

/** The `installStyles` body — where the lifted rules are turned into selectors. */
const STYLE_EXTRACT = () =>
  VIEW.slice(VIEW.indexOf("function installStyles"), VIEW.indexOf("const LAYOUT_MARKER"));

function liftedRules() {
  const block = STYLES.slice(
    STYLES.indexOf("LIFTED_OFFICIAL_RULES"),
    STYLES.indexOf("/* ------------------------------------------------------------------ *\n * Dialog shell"),
  );
  // Optional third element = the pseudo suffix that follows the class name upstream.
  return [...block.matchAll(/\["(sand-[a-z0-9]+)",\s*"([^"]+)"(?:,\s*"([^"]*)")?\]/g)].map((m) => [
    m[1],
    m[2],
    m[3] ?? "",
  ]);
}

function cssName() {
  const dir = path.join(import.meta.dirname, "..", ".build/fidelity/app/dist/renderer/assets");
  if (!existsSync(dir)) return "";
  return readdirSync(dir).find((n) => /^index-.*\.css$/.test(n)) ?? "";
}

/* ------------------------------------------------------------------ *
 * Click routing
 * ------------------------------------------------------------------ */

test("the pill opens the 0.66 marketplace, not 0.18's own plugins dialog", () => {
  // Upstream 0.18 wires the pill to `Rme.open(Uf.plugins())`, which opens the `aria-label="插件"`
  // dialog behind 市场/Yours tabs. Leaving that in place stacks two dialogs.
  assert.match(DOCK, /import \{ createMarketplaceController \} from "\.\/marketplace\/index\.js"/);
  assert.match(DOCK, /function openMarketplace\(\): void \{\s*void marketplaceController\.open\(\);/);
  // The rail row routes through the same function rather than the mod+shift+M chord.
  assert.match(
    DOCK,
    /function openPluginsFromRail\(\): void \{\s*openMarketplace\(\);/,
    "the rail entry must not fall back to dispatching the upstream chord",
  );
});

test("the upstream React click is suppressed in the capture phase", () => {
  // React 18 binds on the root container and listens during BUBBLE. A capture listener on the
  // button that stops propagation prevents the React handler from ever running.
  assert.match(DOCK, /button\.addEventListener\(\s*"click",[\s\S]{0,400}?\{ capture: true \},/);
  assert.match(DOCK, /event\.stopPropagation\(\);/);
  assert.match(DOCK, /event\.preventDefault\(\);/);
});

test("the click interceptor cannot be stacked onto the pill twice", () => {
  // ensureButtonSurface() runs on every sidebar mutation; without a marker each pass would add
  // another listener. Same class of bug as the rail-row duplication this file already guards.
  assert.match(DOCK, /sand-plugins-dock-no-upstream-click/);
  assert.match(
    DOCK,
    /if \(button == null \|\| button\.classList\.contains\("sand-plugins-dock-no-upstream-click"\)\) return;/,
  );
});

test("the interceptor is re-attached on every pill remount, not only at install time", () => {
  // Regression: `install()` runs on DOMContentLoaded, long before the agents sidebar has rendered,
  // so the pill usually does not exist yet. Attaching there only left the pill wired to 0.18's
  // `Rme.open(Uf.plugins())` and 0.18's own dialog opened on click. React remounts the pill on
  // sidebar collapse, agent switch and settings re-render, each producing a fresh element, so the
  // attach has to ride along with every `ensureButtonSurface()` pass.
  const observer = DOCK.slice(DOCK.indexOf("const observer = new MutationObserver"));
  const branch = observer.slice(observer.indexOf("node.matches(BUTTON_SELECTOR)"));
  // The branch is a whole `if` body; slice to its closing brace so an explanatory comment sitting
  // between the two calls cannot push the assertion out of range.
  const body = branch.slice(0, branch.indexOf("}\n"));
  assert.match(
    body,
    /interceptPillClick\(\)/,
    "the pill-remount branch must re-attach the interceptor",
  );
  assert.match(body, /ensureButtonSurface\(\)/);
  const install = DOCK.match(/function install\(\): void \{[\s\S]*?\n\}/);
  assert.ok(install != null, "install() is missing");
  assert.match(install[0], /interceptPillClick\(\)/);
});

/* ------------------------------------------------------------------ *
 * Official fidelity
 * ------------------------------------------------------------------ */

test("glyph codepoints are escapes, not raw PUA characters", () => {
  // They were read off the live renderer's computed --cursor-icon-content. Written literally they
  // are unreviewable bytes that render as blank boxes if the font is missing.
  const glyphs = STYLES.slice(STYLES.indexOf("export const GLYPH"));
  for (const match of glyphs.matchAll(/"([a-zA-Z]+)":\s*"([^"]*)"/g)) {
    assert.match(match[2], /^\\u[0-9a-f]{4}$/, `${match[1]} must be a \\u escape, got ${match[2]}`);
  }
});

test("every official class list the view imports is actually defined", () => {
  // Scoped to the `official-styles.js` import statement: the second import block pulls limits and
  // helpers out of model.ts, and checking those against the style module would be nonsense.
  const at = VIEW.indexOf('from "./official-styles.js"');
  assert.ok(at > 0, "view.ts must import the official style lists");
  const start = VIEW.lastIndexOf("import {", at);
  const block = VIEW.slice(start, at);
  const imported = new Set([...block.matchAll(/^\s{2}([A-Z0-9_]+),$/gm)].map((m) => m[1]));
  const exported = new Set([...STYLES.matchAll(/export const ([A-Z0-9_]+)/g)].map((m) => m[1]));
  assert.ok(imported.size > 40, `expected a large import block, parsed ${imported.size}`);
  for (const name of imported) {
    assert.ok(exported.has(name), `view.ts imports ${name}, which official-styles.ts does not export`);
  }
});

test("the lifted rules are the ones 0.18's stylesheet is actually missing", () => {
  // 42 classes are declared unscoped in 0.66 but not reachable in 0.18. Re-lifting a class 0.18
  // already defines would shadow a working upstream rule, and dropping one leaves the element
  // unstyled. Two of them are the subtle case: 0.18 has the same declaration under the same hash,
  // but scoped to `.sand-plugins-dock-rail`, so it does not apply here.
  const rules = liftedRules();
  assert.equal(rules.length, 42, "expected the 42 official-only declarations");
  for (const [cls, decl] of rules) {
    assert.ok(cls.startsWith("sand-"), `${cls} is not a stylix class`);
    assert.ok(decl.includes(":"), `${cls} declaration is not a CSS property pair: ${decl}`);
    assert.ok(!decl.includes("!important"), `${cls} must be lifted verbatim, not force-applied`);
  }
});

test("a lifted rule keeps upstream's pseudo-class and pseudo-element suffix", () => {
  // Regression, and the reason this assertion exists. Official 0.66 declares the row focus ring as
  //   .sand-1t8vtw7:focus-visible::after { box-shadow: inset 0 0 0 2px … }
  // Lifting it without the suffix made every plugin row render inside a permanent 2px inset
  // border. The declarations were copied verbatim and the class names were real, so the whole
  // suite stayed green; only a screenshot showed the difference.
  const byClass = Object.fromEntries(liftedRules().map(([cls, decl, pseudo]) => [cls, { decl, pseudo }]));

  assert.equal(
    byClass["sand-1t8vtw7"]?.pseudo,
    ":focus-visible::after",
    "the focus ring must stay a focus-visible ring, and stay on the ::after overlay",
  );
  assert.equal(byClass["sand-1w00h3t"]?.pseudo, "::after", "the radius belongs to the overlay");
  assert.equal(byClass["sand-1iolv91"]?.pseudo, ":focus-visible", "the outline colour is focus-only");

  // Every pseudo suffix is appended by the emit, never dropped.
  assert.match(
    VIEW,
    /LIFTED_OFFICIAL_RULES\.flatMap\(\(\[selector, declarations, pseudo = ""\]\) =>/,
    "the emit must read the pseudo suffix out of the tuple",
  );
  assert.ok(VIEW.includes("`${scope}.${selector}${pseudo}{${declarations}}`"));
  assert.ok(VIEW.includes("`${scope} .${selector}${pseudo}{${declarations}}`"));
  // And the negative: no rule may be emitted pseudo-lessly, or every state rule becomes permanent.
  assert.ok(
    !VIEW.includes("`${scope}.${selector}{${declarations}}`"),
    "the pseudo-less emit would repaint state rules as always-on chrome",
  );
});

test("each lifted rule is emitted as a selector that can actually match", () => {
  // Regression, and the reason this assertion exists: the emit was `${scope}${selector}`, which
  // concatenates to `.sand-mktsand-h6vr4k` — no dot, no match. All 40 rules were silently dead, the
  // dialog fell back to 0.18's `.ui-11i3ho8 { width:640px }`, and every other assertion here still
  // passed because they all read the source rather than the emitted CSS.
  //
  // Assert the exact emitted text: both the same-element and the descendant form, each with its own
  // leading dot, for every lifted class.
  const scope = ".sand-mkt";
  for (const [, , pseudo] of liftedRules()) {
    assert.ok(
      VIEW.includes("`${scope}.${selector}${pseudo}{${declarations}}`"),
      "the same-element form must be `${scope}.${selector}` — a missing dot matches nothing",
    );
    assert.ok(
      VIEW.includes("`${scope} .${selector}${pseudo}{${declarations}}`"),
      "the descendant form must be `${scope} .${selector}`",
    );
  }
  // And the negative: the malformed form must not reappear anywhere in the emit.
  assert.ok(
    !VIEW.includes("`${scope}${selector}${pseudo}{${declarations}}`"),
    "the dot-less emit must not come back",
  );
  assert.match(STYLES, /grid-template-columns:repeat\(2/, "the two-column template must be a lifted/styled class, not ad-hoc CSS");
});

test("the two-column grid class is present, since the row grid is not one column", () => {
  // The official marketplace lays each section out in two columns. That comes from
  // `.sand-nby9oq { grid-template-columns:repeat(2,minmax(0,1fr)) }`, which the upstream style-object
  // extraction missed. 0.18 carries the identical declaration under the identical hash.
  assert.match(STYLES, /GRID_CLASSES = \[[\s\S]{0,1400}?"sand-nby9oq"/);
  const css = readFileSync(    path.join(import.meta.dirname, "..", ".build/fidelity/app/dist/renderer/assets", cssName()),
    "utf8",
  );
  assert.match(css, /\.sand-nby9oq[^{]*\{grid-template-columns:repeat\(2,\s*minmax\(0(px)?,\s*1fr\)\)/);
});

test("the grid's padding reset is lifted, because 0.18 scopes the same class to the dock", () => {
  // Official 0.66: `.sand-1c1uobl { padding-inline-start: 0 }` and `.sand-yri2b { padding-inline-end: 0 }`.
  // 0.18 declares both under the identical hashes but scoped to `.sand-plugins-dock-rail`, so neither
  // reaches the marketplace grid and the UA default `ul { padding-inline-start: 40px }` survives.
  // Symptom: every row sat 40px right of official and the columns came out 343px instead of 363px.
  //
  // This is the gap the "same declaration ⇒ same hash ⇒ reuse it" rule does not cover: the hash
  // matched, the selector scope did not. Nothing in the class lists hints at it — official's and
  // our grid class lists are identical bar one semantic hook.
  const lifted = Object.fromEntries(liftedRules().map(([cls, decl]) => [cls, decl]));
  assert.equal(lifted["sand-1c1uobl"], "padding-inline-start:0");
  assert.equal(lifted["sand-yri2b"], "padding-inline-end:0");
  assert.match(
    STYLES,
    /GRID_CLASSES = \[[\s\S]{0,400}?"sand-plugins__grid"/,
    "official's leading semantic hook on the grid ul is part of its recipe",
  );
});

test("the dialog is pinned to the official 800x702 box", () => {
  // Measured on the running official build: `role=dialog` computes 800x702 at (463.5, 161) in a
  // 1727x1024 viewport, radius 14px, background rgb(252,252,252). 0.18's own dialog class
  // `.ui-11i3ho8` hard-codes `width:640px`, so the official recipe has to win over it.
  assert.match(STYLES, /"sand-h6vr4k"/, "the dialog must carry the official width recipe");
  assert.match(STYLES, /"sand-z03ioa"/, "the layout must carry the official height recipe");
  assert.match(
    STYLE_EXTRACT(),
    /\$\{scope\}\.\$\{selector\}/,
    "the official recipe only applies if the lifted emit is well-formed",
  );
});

test("the dialog reuses 0.18's own ui-dialog list so the shell is styled without lifting", () => {
  // DIALOG_CLASSES deliberately mixes 0.18's ui-* hashes (present in 0.18's stylesheet) with the
  // three official sand-* classes that carry the 800px width. Asserting the split keeps a future
  // edit from swapping one side for the other.
  const block = STYLES.slice(STYLES.indexOf("export const DIALOG_CLASSES"));
  const list = block.slice(0, block.indexOf("];"));
  assert.ok(list.includes('"ui-dialog"'));
  assert.ok(list.includes('"ui-dialog--xxl"'));
  assert.ok(list.includes('"sand-plugins-dialog"'));
  // These three are the official recipe and are what make the dialog 800px wide / 700px tall.
  assert.ok(list.includes('"sand-h6vr4k"'), "sand-h6vr4k supplies width:min(800px,…)");
  assert.ok(list.includes('"sand-1gy1zxj"'));
  assert.ok(list.includes('"sand-1717udv"'));
});

/* ------------------------------------------------------------------ *
 * Structure that must not drift
 * ------------------------------------------------------------------ */

test("the official pane layer is present, because it is what positions the header", () => {
  // Regression guard for the bug that hid the whole header. Official 0.66 nests
  // scroller > sand-settings-pane > pane content; the pane's `padding-top:22px` is what cancels
  // the content's own `margin-top:-18px` and lands the title at dialog-relative y=53. Built
  // without that middle layer the -18px had nothing to cancel it, the content rode 70px above
  // the dialog, `overflow:hidden` clipped it away, and the 已安装 preview stopped taking clicks
  // (a clipped region is not hit-testable, so real clicks fell through to the scrim).
  //
  // No static assertion caught that one: the class lists were all well-formed and the whole
  // suite was green. What exposed it was `document.elementFromPoint` over the button. So this
  // test pins the nesting, not the arithmetic.
  assert.match(
    STYLES,
    /export const PANE_WRAPPER_CLASSES = \[\s*"sand-settings-pane", "sand-9f619", "sand-1xy6bms"/,
    "the settings-pane class list carries the 22px top padding that cancels the -18px",
  );
  assert.match(
    STYLES,
    /"sand-16mx7xq"/,
    "the pane carries padding-inline-start:32px, which is what indents the content to x=33",
  );
  assert.match(VIEW, /const paneWrapper = el\("div", PANE_WRAPPER_CLASSES\)/);
  assert.match(VIEW, /paneWrapper\.append\(content\)/, "content must sit inside the pane");
  assert.match(VIEW, /pane\.append\(paneWrapper\)/, "the pane must sit inside the scroller");
  // The scroller's 48px band below the layout top, and the pane's 32px inline-end gutter, are
  // the two declarations official carries on classes 0.18 does not ship.
  assert.match(
    STYLE_EXTRACT(),
    /\$\{SCROLL_MARKER\}\{[^}]*margin-top:48px/,
    "official leaves a 48px band above the scroll viewport (y=49, height 652)",
  );
  assert.match(STYLE_EXTRACT(), /PANE_WRAPPER_MARKER\}\{[^}]*padding-inline-end:32px/);
});

test("the page body swaps in its own container, so the header survives the page change", () => {
  // 市场 and 管理 share the title row and the search field; only the body differs. Rendering the
  // body into the scroller directly would have torn the header down on every page change.
  assert.match(VIEW, /const groups = el\("div", \[GROUPS_HOLDER_MARKER\]\)/);
  assert.match(VIEW, /groups\.replaceChildren\(root\)/);
  assert.doesNotMatch(
    STYLE_EXTRACT(),
    /\$\{SCROLL_MARKER\}\{[^}]*replaceChildren/,
    "the scroller must never be the render target",
  );
});

test("the header is a single row, not a row nested inside a row", () => {
  // `header` already carries TITLE_ROW_CLASSES — it is official's one header row. An earlier build
  // wrapped the h2 + trailing slot in a second element with the same class list, so the outer one
  // added its own `sand-1c436fg` margin-bottom: the header measured 42px instead of 24px and the
  // search field landed at y=113 where official puts it at y=95, dragging every section 18px down.
  // Nothing about it looked broken — the row just sat slightly low — so it is pinned here.
  assert.match(
    VIEW,
    /const header = el\("div", TITLE_ROW_CLASSES\);\s*\n\s*content\.append\(header\)/,
    "the dialog builds exactly one header row and hangs it off the pane content",
  );
  assert.doesNotMatch(
    VIEW,
    /const titleRow = el\("div", TITLE_ROW_CLASSES\)/,
    "a second TITLE_ROW_CLASSES wrapper would double the 18px header margin",
  );
  assert.doesNotMatch(VIEW, /header\.append\(titleRow\)/);
  // The h2 and the trailing slot are the header's direct children.
  assert.match(VIEW, /header\.append\(h2\)/);
  assert.match(VIEW, /header\.append\(trailing\)/);
});

test("both pages are rendered by this extension", () => {
  assert.match(VIEW, /function renderBrowse\(/);
  assert.match(VIEW, /function renderManage\(/);
  // Page 1 heading and the installed preview that opens page 2.
  assert.match(VIEW, /id = "sand-plugins-modal-heading"/);
  assert.match(VIEW, /el\("button", INSTALLED_PREVIEW_CLASSES\)/);
  assert.match(STYLES, /sand-plugins__installed-preview/);
  // Page 2 back bar + title.
  assert.match(VIEW, /el\("div", BACK_BAR_CLASSES\)/);
  assert.match(VIEW, /TEXT\.manageTitle/);
  // The back bar and the installed preview are mutually exclusive, as they are upstream: the
  // preview opens page 2 and is replaced in place by the back bar, never stacked above it.
  const render = VIEW.slice(VIEW.indexOf("const render = (state: MarketplaceViewState)"));
  const manageBranch = render.slice(0, render.indexOf("} else {"));
  const browseBranch = render.slice(render.indexOf("} else {"));
  assert.ok(!manageBranch.includes("INSTALLED_PREVIEW_CLASSES"), "page 2 must not keep the preview");
  assert.ok(browseBranch.includes("buildInstalledPreview"), "page 1 must carry the preview");
});

test("manage sections use jt, so their h3 carries no data-detail-hero-title", () => {
  // Upstream renders 私有技能 with `jt`, which has no `data-detail-hero-title`; only `Us` and the
  // manage h1 do. Adding the attribute to the group headings breaks the scroll-spy that queries it.
  const groupSection = VIEW.slice(VIEW.indexOf("function buildGroupSection"));
  const body = groupSection.slice(0, groupSection.indexOf("\n}\n"));
  assert.match(body, /el\("h3", GROUP_TITLE_CLASSES, title\)/);
  assert.ok(
    !body.includes("data-detail-hero-title"),
    "jt's h3 must not carry data-detail-hero-title",
  );
});

test("the show-all latch renders the total count and is one-way", () => {
  assert.match(VIEW, /showAllLabel\(matchedInstalled\.length\)/);
  assert.match(INDEX, /installedExpanded: true/);
  // Reset on leaving the manage view, matching upstream's `if (!isYoursOpen && isInstalledExpanded)`.
  assert.match(INDEX, /page: "browse", query: "", installedExpanded: false, busy: false/);
});

test("collapsed overflow rows are inert so they cannot be clicked or tabbed into", () => {
  const overflow = VIEW.slice(VIEW.indexOf("Upstream renders the overflow rows"));
  const body = overflow.slice(0, overflow.indexOf("installedBody.append(holder)"));
  assert.match(body, /setAttribute\("aria-hidden", "true"\)/);
  assert.match(body, /setAttribute\("inert", ""\)/);
});

test("row__main holds the name and subtitle as direct column children, not a wrapper", () => {
  // Regression: the name and subtitle were nested inside an extra span carrying the "row meta
  // wrapper" classes. That wrapper computes `display:flex` in ROW direction, so the two spans sat
  // side by side and the pair was squeezed — every row rendered as "Adob…  Development,
  // customization, …". Measured on the official build: `row__main` is `flex-direction:column` with
  // exactly two 231x18 children at y=365 and y=383, the first carrying
  // `sand-9f619 sand-78zum5 sand-6s0dn4 sand-17d4w8g sand-euugli`.
  const start = VIEW.indexOf("function buildRowText");
  const fn = VIEW.slice(start, VIEW.indexOf("\n}\n", start));
  assert.match(fn, /main\.append\(el\("span", ROW_NAME_CLASSES, name\)\)/);
  assert.match(fn, /main\.append\(el\("span", ROW_SUBTITLE_CLASSES, subtitle\)\)/);
  assert.ok(!fn.includes("meta"), "no wrapper span may sit between row__main and its two children");
  assert.ok(!fn.includes("ROW_META_CLASSES"), "the meta class list must not be a separate element");
  assert.match(
    STYLES,
    /export const ROW_NAME_CLASSES = \[\s*"sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-17d4w8g", "sand-euugli"/,
  );
  assert.ok(!STYLES.includes('"sand-plugins-row__name"'), "that class belongs to the manage view");
});

test("a failed catalog load is visible, not an empty marketplace", () => {
  // The catalog is a network call. An earlier revision swallowed the rejection with
  // `.catch(() => [])`, so a `deadline_exceeded` rendered as a marketplace with no sections at
  // all — indistinguishable from a broken build. Upstream has a `CatalogStatus` surface for
  // exactly this, and the port reproduces it.
  assert.match(INDEX, /Promise\.allSettled/);
  assert.match(INDEX, /catalogError: catalogResult\.status === "rejected"/);
  assert.ok(!INDEX.includes("mcp.catalog().catch("), "the catalog call must not swallow its rejection");
  assert.match(VIEW, /state\.loading \|\| state\.catalogError != null/);
  assert.match(VIEW, /TEXT\.loadingCatalog/);
  assert.match(VIEW, /TEXT\.catalogUnavailable/);
});

test("the dialog is a sibling in its own portal layer, not a rewrite of 0.18's dialog", () => {
  // Rewriting 0.18's React-owned children would fight reconciliation; the port renders its own tree
  // and mounts it as a sibling, so upstream's own dialog is never touched.
  assert.match(INDEX, /document\.body\.append\(dialog\.root\)/);
  assert.match(INDEX, /createMarketplaceDialog\(state, handlers\)/);
  for (const file of [INDEX, VIEW]) {
    assert.ok(
      !file.includes('querySelector(\'[role="dialog"]\')'),
      "neither module may reach into 0.18's dialog",
    );
  }
});

/* ------------------------------------------------------------------ *
 * Data wiring
 * ------------------------------------------------------------------ */

test("the controller reads only bridges that already exist", () => {
  // No backend change is required for either page, so the controller must not invent a channel.
  for (const method of ["catalog", "list", "teamPopularity", "install", "authenticate"]) {
    assert.match(
      INDEX,
      new RegExp(`\\b${method}\\?*\\(`),
      `the controller never calls mcp.${method}`,
    );
  }
  assert.ok(!INDEX.includes("clientPersistence"), "skills must not be scraped from the KV store");
  assert.ok(!INDEX.includes("ipcRenderer"), "no raw ipc channel may be invented");
});

test("私有技能 has no invented data source", () => {
  // Upstream feeds it from an agent-scoped query that never crosses the preload bridge here. The
  // port returns an empty list and lets the section render upstream's own empty-state string.
  assert.match(INDEX, /function readPrivateSkills\(\): readonly PrivateSkill\[\] \{\s*return \[\];/);
  assert.match(VIEW, /TEXT\.noPrivateSkills/);
});

test("the detail pane and skill pane are inert rather than invented", () => {
  // Those are third surfaces outside the two pages this port reproduces; opening something
  // fabricated there would be the exact failure mode the project forbids.
  assert.match(INDEX, /onOpenRow: \(row\) => \{[\s\S]{0,320}?void row;/);
  assert.match(INDEX, /onOpenSkill: \(\) => \{/);
});
