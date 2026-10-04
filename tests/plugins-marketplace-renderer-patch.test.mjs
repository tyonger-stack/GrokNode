import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const EXT_DIR = path.join(import.meta.dirname, "..", "frontend/src/extensions");
const DOCK = readFileSync(path.join(EXT_DIR, "plugins-dock-entry.ts"), "utf8");
const STYLES = readFileSync(path.join(EXT_DIR, "marketplace/official-styles.ts"), "utf8");
const VIEW = readFileSync(path.join(EXT_DIR, "marketplace/view.ts"), "utf8");
const MODEL = readFileSync(path.join(EXT_DIR, "marketplace/model.ts"), "utf8");
const INDEX = readFileSync(path.join(EXT_DIR, "marketplace/index.ts"), "utf8");

const MCP_MARKETPLACE = readFileSync(
  path.join(import.meta.dirname, "..", "source/shared/node/mcp/mcp-marketplace.ts"),
  "utf8",
);
/** Comment-stripped source, for guards that must not match their own explanatory prose. */
const MCP_CODE = MCP_MARKETPLACE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The `installStyles` body — where the lifted rules are turned into selectors. */
const STYLE_EXTRACT = () =>
  VIEW.slice(VIEW.indexOf("function installStyles"), VIEW.indexOf("const LAYOUT_MARKER"));

/** The `LIFTED_OFFICIAL_RULES` table literal, so a guard can assert on what is NOT lifted. */
const LIFTED_TEXT = STYLES.slice(
  STYLES.indexOf("export const LIFTED_OFFICIAL_RULES"),
  STYLES.indexOf("/* ------------------------------------------------------------------ *\n * Dialog shell"),
);

function liftedRules() {
  const block = LIFTED_TEXT;
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
  // 43 classes are declared unscoped in 0.66 but not reachable in 0.18. Re-lifting a class 0.18
  // already defines would shadow a working upstream rule, and dropping one leaves the element
  // unstyled. Two of them are the subtle case: 0.18 has the same declaration under the same hash,
  // but scoped to `.sand-plugins-dock-rail`, so it does not apply here.
  const rules = liftedRules();
  assert.equal(rules.length, 43, "expected the 43 official-only declarations");
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
  // Official leaves a 48px band above the scroll viewport (y=49, height 652). That band is a real
  // element, not a margin — see the pinned-search test below.
  assert.match(STYLE_EXTRACT(), /PIN_BAND_MARKER\}\{[^}]*height:48px/);
  assert.doesNotMatch(
    STYLE_EXTRACT(),
    /\$\{SCROLL_MARKER\}\{[^}]*margin-top:48px/,
    "the scroller must not fake the band with a margin now that the band is a real element",
  );
  assert.match(STYLE_EXTRACT(), /PANE_WRAPPER_MARKER\}\{[^}]*padding-inline-end:32px/);
});

test("the 48px band above the scroller is a real element that owns the pinned search", () => {
  // Official 0.66 keeps a 48px strip between the layout top and the scroller at all times: empty
  // while the page is at the top, holding a SECOND copy of the search field once the real one has
  // scrolled out of sight. Measured: band [1,1,798,48] position:relative z-index:2, scroller
  // [1,49,798,652], and a binary search put the switch between scrollTop 78 (one input) and 79
  // (two). It is NOT `position: sticky` — official really renders a second <input>.
  //
  // An earlier revision reserved the 48px with `margin-top: 48px` on the scroller and had no band,
  // which is why the pinned field had nowhere to go when this was first asked for.
  assert.match(
    VIEW,
    /const pinBand = el\("div", PIN_BAND_CLASSES\)/,
    "the band is built from official's own class list",
  );
  assert.match(VIEW, /layout\.append\(pinBand\)/, "the band is a sibling of the scroller");
  assert.match(
    VIEW,
    /const pane = el\("div", PANE_CLASSES\);\s*\n\s*applyClasses\(pane, \[SCROLL_MARKER\]\);\s*\n\s*\n?\s*\/\/[^\n]*\n/,
    "the pane follows the band, so it inherits the 48px offset from layout flow",
  );
  assert.doesNotMatch(STYLE_EXTRACT(), /\$\{SCROLL_MARKER\}\{[^}]*margin-top/);

  // The band's own paint: elevated surface, above the content, with the hairline divider that is
  // visible under the pinned field in official's screenshot.
  const bandRule = STYLE_EXTRACT().match(/\$\{scope\} \.\$\{PIN_BAND_MARKER\}\{[^}]*\}/)?.[0] ?? "";
  assert.match(bandRule, /position:relative/, "official's band is relative, not sticky");
  assert.match(bandRule, /z-index:2/, "the band paints over the scrolling content");
  assert.match(bandRule, /height:48px/);
  assert.match(bandRule, /min-height:48px/);

  // The z-index + border come from official class names carried on the element itself.
  assert.match(STYLES, /"sand-htitgo"/, "z-index:2");
  assert.match(STYLES, /"sand-10e981r"/, "background-color: var(--sand-bg-elevated)");
  assert.match(STYLES, /"sand-19145p9"/, "border-bottom-color: var(--sand-border-weak)");
  const lifted = Object.fromEntries(liftedRules().map(([cls, decl]) => [cls, decl]));
  assert.equal(
    lifted["sand-1wxaq2x"],
    "min-height:48px",
    "the one lift the band needs: official declares min-height and 0.18 ships neither it nor the class",
  );
});

test("the pinned field is official's second render of the same field, not a CSS sticky", () => {
  // Both inputs carry the identical official class list; the ONLY difference on the shell is the
  // height class — `sand-10w6t97` (32px, in-flow) vs `sand-1fgtraw` (28px, pinned). Both hashes
  // already exist in 0.18's stylesheet, which is why the pinned field measures 718x28 against the
  // in-flow 734x32 with nothing lifted.
  assert.match(VIEW, /function buildSearchField\(\s*compact: boolean,/, "one builder, two sizes");
  assert.match(
    VIEW,
    /inner\.classList\.remove\("sand-10w6t97"\);\s*\n\s*inner\.classList\.add\(PIN_COMPACT_HEIGHT_CLASS\)/,
    "compact swaps the height class rather than restating the field",
  );
  assert.match(VIEW, /buildSearchField\(false, \(value\) => handlers\.onQuery\(value\)\)/);
  assert.match(VIEW, /buildSearchField\(true, \(value\) => handlers\.onQuery\(value\)\)/);
  assert.match(
    STYLES,
    /PIN_COMPACT_HEIGHT_CLASS = "sand-1fgtraw"/,
    "official's pinned shell carries sand-1fgtraw (height: 28px)",
  );
  assert.doesNotMatch(
    LIFTED_TEXT,
    /"sand-1fgtraw"/,
    "0.18 already declares sand-1fgtraw; re-lifting it would shadow a working upstream rule",
  );
  assert.doesNotMatch(
    LIFTED_TEXT,
    /"sand-10w6t97"/,
    "0.18 already declares sand-10w6t97 (height: 32px)",
  );

  // Official's switch is a geometry test between the two boxes, not a magic scroll number: the
  // pinned field appears once the in-flow field's bottom edge passes the band's bottom edge. At
  // rest the field's bottom is below the band, so this is a no-op without a listener.
  assert.match(
    VIEW,
    /const bandBottom = pinBand\.getBoundingClientRect\(\)\.bottom;[\s\S]*?const fieldBottom = searchHolder\.getBoundingClientRect\(\)\.bottom;/,
    "the switch is computed from the two rects",
  );
  assert.match(VIEW, /if \(fieldBottom < bandBottom\) mountPin\(\);\s*\n\s*else unmountPin\(\);/);
  assert.doesNotMatch(
    VIEW,
    /scrollTop\s*[<>=]+\s*\d\d/,
    "no hardcoded scroll offset: a magic 79 would silently drift if either box changed size",
  );

  // Scroll and resize are the only triggers; both must be released on destroy.
  assert.match(VIEW, /pane\.addEventListener\("scroll", onScroll, \{ passive: true \}\)/);
  assert.match(VIEW, /pane\.removeEventListener\("scroll", onScroll\)/);
  assert.match(VIEW, /window\.removeEventListener\("resize", onScroll\)/);

  // Official measures the band EMPTY on the manage page even when scrolled to the bottom. With the
  // page ladder widened to browse / manage / section / detail, the correct predicate is
  // browse-only rather than "not manage" — a section or detail page has no search field either,
  // and an earlier `page === "manage"` check would have pinned one there.
  assert.match(
    VIEW,
    /if \(page !== "browse"\) \{\s*\n\s*unmountPin\(\);/,
    "the pin is a marketplace-homepage affordance only, across the whole page ladder",
  );
  // The `syncPin` body must not name the manage page specifically: with four page kinds, an
  // "everything except manage" gate would pin a search field onto the section and detail pages,
  // which have no search field at all.
  const syncPin = VIEW.slice(VIEW.indexOf("const syncPin"), VIEW.indexOf("const onScroll"));
  assert.doesNotMatch(syncPin, /"manage"/, "syncPin must gate on browse, not exclude one page by name");
  // …and a browse page that stops being scrollable (a search with few hits) must retract it too.
  assert.match(VIEW, /if \(searchHolder\.style\.display === "none"\) \{\s*\n\s*unmountPin\(\);/);
  // Both inputs hold the same query: measured official leaves BOTH holding the typed text.
  assert.match(VIEW, /if \(pinSearch\.input\.value !== state\.query\) pinSearch\.input\.value = state\.query;/);
  assert.match(
    VIEW,
    /const mountPin = \(\): void => \{[\s\S]*?pinBand\.append\(pinRow\);\s*\n\s*if \(pinSearch\.input\.value !== input\.value\) pinSearch\.input\.value = input\.value;/,
    "mounting the pin seeds its value from the in-flow input, so a query typed before scrolling is not lost",
  );
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
  // The dialog now keeps its page ladder in a stack, so the reset rides `pop()` — "leaving manage"
  // is no longer the same statement as "returning to browse", because a manage page can sit on top
  // of a section or detail page and 返回 pops exactly one level.
  assert.match(INDEX, /const pop = \(\): void => \{[\s\S]*?if \(state\.page !== "manage"\) state = \{ \.\.\.state, installedExpanded: false \};/);
  assert.doesNotMatch(
    INDEX,
    /page: "browse", query: "", installedExpanded: false, busy: false/,
    "closing must reset the ladder, not hard-code the browse page",
  );
  // …and closing really does return to the bottom of the stack with a cleared query.
  assert.match(INDEX, /const reset = \(\): void => \{\s*\n\s*stack = \[\{ kind: "browse" \}\];/);
  assert.match(INDEX, /reset\(\);\s*\n\s*state = \{ \.\.\.state, query: "", installedExpanded: false, busy: false \};/);
});

test("collapsed overflow rows are inert so they cannot be clicked or tabbed into", () => {
  const overflow = VIEW.slice(VIEW.indexOf("Upstream renders the overflow rows"));
  const body = overflow.slice(0, overflow.indexOf("installedBody.append(holder)"));
  assert.match(body, /setAttribute\("aria-hidden", "true"\)/);
  assert.match(body, /setAttribute\("inert", ""\)/);
});

test("row__main carries the official three-level name/subtitle subtree", () => {
  // History, because this assertion has been wrong twice in opposite directions:
  //
  //  1. The name and the subtitle were BOTH nested inside the meta wrapper. That wrapper computes
  //     `display:flex` in ROW direction, so the two sat side by side and the pair was squeezed —
  //     every row read "Adob…  Development, customization, …".
  //  2. The fix flattened it by deleting the inner name span and putting the wrapper's own class
  //     list on the element that now holds the name text. That silences the squeeze but leaves
  //     the name carrying the WRAPPER's recipe and, more importantly, drops `sand-plugins-row__name`
  //     — the class official uses to set its type. Text still renders, so no text assertion sees it.
  //
  // The official subtree, read off the running 0.66 build under CDP, is THREE levels:
  //   row__main                       [127,361,231,37]  flex-direction: column
  //     SPAN sand-17d4w8g sand-euugli [127,361,231,18]  the meta wrapper — holds ONLY the name
  //       SPAN sand-plugins-row__name [127,361,38,18]   the name itself
  //     SPAN ...__subtitle            [127,380,231,18]  the subtitle
  // Because the wrapper now has a single child, the original row-direction squeeze cannot recur.
  const start = VIEW.indexOf("function buildRowText");
  const fn = VIEW.slice(start, VIEW.indexOf("\n}\n", start));
  assert.match(fn, /const nameWrapper = el\("span", ROW_NAME_WRAPPER_CLASSES\)/, "the meta wrapper survives");
  assert.match(fn, /nameWrapper\.append\(el\("span", ROW_NAME_CLASSES, name\)\)/, "the name is a child of the wrapper");
  assert.match(fn, /main\.append\(nameWrapper\)/);
  assert.match(fn, /main\.append\(el\("span", ROW_SUBTITLE_CLASSES, subtitle\)\)/);
  assert.ok(
    !/main\.append\(nameWrapper,/.test(fn) && !/nameWrapper\.append\([^)]*subtitle/i.test(fn),
    "the subtitle must NOT join the wrapper — that is the side-by-side regression",
  );

  // The two lists must stay distinct, and the name list must carry official's semantic class.
  assert.match(
    STYLES,
    /export const ROW_NAME_WRAPPER_CLASSES = \[\s*"sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-17d4w8g", "sand-euugli"/,
  );
  assert.match(STYLES, /export const ROW_NAME_CLASSES = \[\s*"sand-plugins-row__name"/);
  const wrapperBlock = STYLES.slice(
    STYLES.indexOf("export const ROW_NAME_WRAPPER_CLASSES"),
    STYLES.indexOf("export const ROW_NAME_CLASSES"),
  );
  assert.ok(
    !wrapperBlock.includes("sand-plugins-row__name"),
    "the wrapper list must not claim the name's semantic class",
  );
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

test("私有技能 reads the host through the skills bridge and never invents a source", () => {
  // This used to assert the empty stub. The backend change (`source/electron-main/skills/`) gives
  // 私有技能 a real source, so the guard's job is unchanged but inverted: the data must come from the
  // gateway via `window.desktop.skills`, and the upstream filter must be applied to the raw records.
  assert.match(INDEX, /const skills = skillsBridge\(\);/);
  assert.doesNotMatch(INDEX, /return \[\];/, "the empty stub is gone; 私有技能 must read the bridge");
  assert.match(INDEX, /skills\.list\(agentId\)/);
  assert.match(INDEX, /privateSkillsFromRecords\(result\.records\)/);
  // Still forbidden: scraping the opaque KV store or inventing a raw IPC channel.
  assert.ok(!INDEX.includes("clientPersistence"), "skills must not be scraped from the KV store");
  assert.ok(!INDEX.includes("ipcRenderer"), "no raw ipc channel may be invented");

  // The agent id comes from the DOM's selected row, with the main bot as fallback — not guessed.
  assert.match(
    INDEX,
    /querySelector<HTMLElement>\('\[data-agent-id\]\[aria-current="page"\]'\)/,
    "the selected agent row carries the id; guessing would read the wrong Bot's skills",
  );
  assert.match(INDEX, /getMainAgent\?\.\(\)/);

  // The bridge's discriminated union is mirrored, not re-invented.
  assert.match(INDEX, /gateway-unreachable/);
  assert.match(INDEX, /gateway-command-failed/);

  // The empty state still exists — but only for a read that actually succeeded and came back empty.
  assert.match(VIEW, /TEXT\.noPrivateSkills/);
  assert.match(
    VIEW,
    /if \(state\.skillsError != null\) \{\s*\n(?:[^\n]*\n)*?[^\n]*buildEmptyState\(state\.skillsError\)/,
    "an unreachable host must show the failure, never the 'you have no skills' empty state",
  );
  assert.match(
    VIEW,
    /\} else if \(matchedSkills\.length === 0\) \{/,
    "the upstream empty state is the else-arm, i.e. only after a successful read",
  );
});

test("私有技能 detail offers 删除 always and 编辑 only for skills the user wrote", () => {
  // Upstream's rule (`view-B5Ug8wEm.js#L1377`): `canEditPrivateSkill` is true only when
  // `source === "workflow"`, all three fields are non-empty, and something actually changed. A
  // `managed` skill is installed by the platform; a save button on it would write to a file the
  // product owns, so the control must not exist at all rather than be disabled.
  assert.match(
    MODEL,
    /export function canEditPrivateSkill\([\s\S]*?return skill\.source === "workflow"/,
  );
  assert.match(
    MODEL,
    /draft\.name\.trim\(\)\.length > 0[\s\S]*?draft\.description\.trim\(\)\.length > 0[\s\S]*?draft\.body\.trim\(\)\.length > 0[\s\S]*?draft\.name !== skill\.name \|\| draft\.description !== skill\.description \|\| draft\.body !== skill\.body/,
    "all three fields must be non-empty AND something must have changed",
  );

  assert.match(VIEW, /function renderSkillDetail\(/);
  assert.match(
    VIEW,
    /const editable = skill\.source === "workflow";/,
    "the edit form is gated on the raw source, not on some UI-side flag",
  );
  assert.match(
    VIEW,
    /if \(editable\) \{[\s\S]*?\} else \{[\s\S]*?TEXT\.skillReadOnly/,
    "a non-editable skill gets an explanation instead of a disabled form",
  );
  // 保存 recomputes on every keystroke, matching upstream's disabled-until-valid button.
  assert.match(VIEW, /save\.disabled = state\.busy \|\| !canEditPrivateSkill\(skill, draft\(\)\);/);
  assert.match(VIEW, /for \(const field of \[nameInput, descInput, bodyInput\]\) \{\s*\n\s*field\.addEventListener\("input", sync\);/);
  assert.match(VIEW, /handlers\.onSaveSkill\(skill, draft\(\)\)/);
  assert.match(VIEW, /handlers\.onDeleteSkill\(skill\)/);

  // Delete and save go through the bridge, not at the filesystem.
  assert.match(INDEX, /skills\.remove\(agentId, skill\.id\)/);
  assert.match(INDEX, /skills\.update\(agentId, skill\.id, \{/);
  // Deleting pops the detail page off the stack: leaving a deleted record's page on screen would
  // show something that no longer exists.
  assert.match(
    INDEX,
    /stack = stack\.filter\(\(page\) => !\(page\.kind === "skill" && page\.skill\.id === skill\.id\)\)/,
  );
  // …and saving re-points the open page at the host's refreshed copy, not the local draft.
  assert.match(INDEX, /const fresh = state\.skills\.find\(\(candidate\) => candidate\.id === skill\.id\);/);
});

test("私有技能 subtitles follow upstream: 已发布 only for plugin, 本地创建 otherwise", () => {
  // Upstream: `source === "plugin" ? "Published" : "Created locally"`, then ` · {description}`.
  // The brief asked for managed-skills/ to read 已发布; upstream's rule keys on `plugin`, and a
  // `managed` skill is platform-installed rather than user-published. Both directories ARE merged
  // (a data-source change, honoured); the label is not relabelled, because relabelling it would
  // contradict the shipped rule the whole port is measured against. Pinned so the deviation is a
  // deliberate, one-line-reversible decision rather than an accident.
  assert.match(
    MODEL,
    /export function skillSubtitle\([\s\S]*?const provenance = skill\.source === "plugin" \? TEXT\.published : TEXT\.localCreated;/,
  );
  assert.match(
    MODEL,
    /\$\{provenance\} · \$\{skill\.description\.length > 0 \? skill\.description : TEXT\.skillFallback\}/,
    "upstream falls back to 'Skill' when the description is empty",
  );
  assert.doesNotMatch(
    MODEL,
    /const provenance = skill\.source === "managed" \? TEXT\.published/,
    "managed skills must NOT be relabelled 已发布 — upstream does not do that",
  );
  // The filter that decides what is in the section at all.
  assert.match(
    MODEL,
    /const source =\s*\n?\s*rawSource === "workflow" \|\| rawSource === "managed" \|\| rawSource === "plugin" \? rawSource : null;/,
    "the three skill sources upstream keeps",
  );
  assert.match(
    MODEL,
    /if \(source === "plugin" && record\.publishedByCurrentUser !== true\) return \[\];/,
    "a plugin skill counts as 私有技能 only when the user published it",
  );
});

test("detail-page affordances that open nothing in 0.66 stay inert", () => {
  // 0.66's detail page has three elements that LOOK like navigation and are not. Each was pressed
  // three times on the running build, once as a real pointer sequence, with the whole dialog's
  // innerText length and a TreeWalker search for tool names as the oracle:
  //
  //   工具 row (button + chevron)   box stays 42px / 1 child; no tool name ever appears
  //   添加账户                      dialog text unchanged, no new dialog
  //   编辑 <account> 账户           same
  //
  // So there is no tool-list page and no account page to reproduce. A bridge method
  // (`mcp.listServerTools`) returning 23 records does not create a surface to render them on —
  // wiring it up would be inventing UI, which is the one thing this port must never do.
  //
  // These are rendered with official's geometry and left without handlers ON PURPOSE. If a future
  // capture shows any of them opening something, this test is the thing to update first.
  assert.match(VIEW, /const toolRow = el\("button", DETAIL_TOOLS_ROW_CLASSES\)/);
  assert.ok(
    !/toolRow\.addEventListener/.test(VIEW),
    "the 工具 row must not grow a handler: 0.66 does not expand it",
  );
  assert.match(VIEW, /toolRow\.append\(glyph\("chevron-right", GLYPH\.chevronDown, 10\)\)/);

  const addAccount = VIEW.slice(VIEW.indexOf("const addAccount = el("));
  assert.match(VIEW, /const addAccount = el\("button", DETAIL_ADD_ACCOUNT_FULL_CLASSES\)/);
  assert.ok(
    !/addAccount\.addEventListener/.test(addAccount),
    "添加账户 has no destination in 0.66",
  );
  const editAccount = VIEW.slice(VIEW.indexOf("const edit = el("));
  assert.ok(
    !/edit\.addEventListener/.test(editAccount),
    "编辑 <account> 账户 has no destination in 0.66",
  );

  // The two elements that DO act, both wired to the same URL, because official's 分享 and its
  // copy-link affordance write the same value (the entry's own homepage).
  assert.match(VIEW, /copy\.addEventListener\("click", \(\) => handlers\.onShare\(row\)\)/);
  assert.match(VIEW, /share\.addEventListener\("click", \(\) => handlers\.onShare\(row\)\)/);
});

test("添加 is a one-shot install: no credential form, no destination picker", () => {
  // The brief asked for "添加到指定位置/分组". 0.66 has no such surface. Pressed on the running
  // build against two entries that bracket the catalog: Ahrefs (0 `fields`) and Capital.com
  // (8 `fields` — CAP_ENV / CAP_API_KEY / CAP_DRY_RUN / CAP_IDENTIFIER / CAP_WS_ENABLED /
  // CAP_API_PASSWORD / CAP_ALLOWED_EPICS / CAP_ALLOW_TRADING). Both times the dialog count, the
  // input count and the detail text were unchanged: no credential form, no destination picker.
  //
  // 26 catalog entries carry `fields[]`; none of them is a surface this page renders. The primary
  // button is therefore a one-shot install, which is exactly what `mcp.install` does here.
  assert.match(INDEX, /await mcp\.install\(\{ pluginId: row\.id, catalogEntry: row\.entry \}\)/);
  assert.doesNotMatch(
    INDEX,
    /installForm|credentialForm|pickDestination|installTarget/,
    "no invented install surface: 0.66 opens nothing between the button and the install",
  );

  // The two primary actions must not mutate the catalog row set locally either: the dialog keeps
  // rendering from the reloaded model rather than patching the clicked row in place.
  assert.match(INDEX, /finally \{\s*\n\s*state = \{ \.\.\.state, busy: false \};\s*\n\s*await reload\(\);/);
});

test("the detail pages are anchored to a capture, not invented", () => {
  // These used to be guarded as deliberately inert: opening something fabricated in a surface this
  // port did not reproduce is the exact failure mode the project forbids. The user has since
  // approved the detail surfaces, so the guard flips from "absent" to "evidence-anchored" — the
  // obligation is unchanged, only the direction. What must hold now is that every field and label
  // they render traces to the CDP capture in docs/MARKETPLACE-066-EVIDENCE.md.
  assert.ok(
    existsSync(path.join(import.meta.dirname, "..", "docs/MARKETPLACE-066-EVIDENCE.md")),
    "the capture the detail surfaces are derived from must be in the repo, not just in a comment",
  );
  const EVIDENCE = readFileSync(
    path.join(import.meta.dirname, "..", "docs/MARKETPLACE-066-EVIDENCE.md"),
    "utf8",
  );

  // The page ladder is a stack, so 返回 pops exactly one level instead of resetting to home.
  assert.match(INDEX, /let stack: readonly Page\[\] = \[\{ kind: "browse" \}\]/);
  assert.match(INDEX, /onOpenRow: \(row\) => \{\s*\n\s*push\(\{ kind: "detail", row \}\);/);
  assert.match(INDEX, /onViewAll: \(group: BrowseGroup\) => \{[\s\S]*?push\(\{ kind: "section", group \}\);/);

  // Every detail label comes from TEXT, i.e. from the capture — never an inline literal.
  for (const label of [
    "share", "uninstall", "viewSource", "copyPluginLink", "detailAccounts", "detailTools",
    "detailInfo", "connectorLabel", "detailApps", "infoFeatures", "infoDeveloper",
    "infoCategory", "infoWebsite", "infoAvailability",
  ]) {
    assert.ok(
      new RegExp(`\\n\\s*${label}:`).test(MODEL),
      `TEXT.${label} must exist and be sourced from the capture`,
    );
  }
  // Each label is consumed by reference rather than re-typed at the call site.
  assert.match(VIEW, /TEXT\.viewSource/);
  assert.match(VIEW, /TEXT\.copyPluginLink/);
  assert.match(VIEW, /TEXT\.uninstall/);

  // The detail body is built from the live row, never from a fixture.
  assert.match(VIEW, /buildPluginDetail\(row, state\.servers\.find/);

  // The skill detail surface is upstream's own and is NOT re-implemented here: 私有技能 rows still
  // route to `onOpenSkill`, and the controller must not fabricate a marketplace page for them.
  assert.match(VIEW, /open\.addEventListener\("click", \(\) => handlers\.onOpenSkill\(skill\)\)/);
});

test("the SKILL.md body wraps instead of being clipped by the pane", () => {
  // A raw markdown blob has long prose lines. A bare `<pre>` neither wraps nor shrinks, so the
  // content overflowed the 734px column and Chromium clipped the right edge — the tail of every
  // long line was simply unreadable, with no scrollbar to reveal it. Wrapping is also the right
  // reading: markdown is prose, not code to align.
  assert.match(VIEW, /const SKILL_BODY_MARKER = "sand-mkt-skill-body";/);
  const rule = STYLE_EXTRACT().match(/\$\{scope\} \.\$\{SKILL_BODY_MARKER\}\{[^}]*\}/)?.[0] ?? "";
  assert.ok(rule.length > 0, "the body block must get its own rule");
  assert.match(rule, /white-space:pre-wrap/, "markdown prose must wrap");
  assert.match(rule, /overflow-wrap:anywhere/, "long unbroken paths/URLs must break too");
  assert.match(rule, /overflow-x:auto/, "and the box must stay scrollable as a backstop");
  assert.match(VIEW, /const pre = el\("pre", DETAIL_DESC_CLASSES, skill\.body\);\s*\n\s*applyClasses\(pre, \[SKILL_BODY_MARKER\]\);/);
});

/* ------------------------------------------------------------------ *
 * CTA recipes — pinned to a live 0.66 geometry dump (2026-10-04)
 *
 * These four controls shipped with recipes that were plausible but wrong: the row
 * 添加 button rendered 32x24 with no fill, the detail 返回 rendered 36x28, 查看源码 lost
 * its icon entirely, and 分享 came out 78px against official's 82. None of that is
 * visible to a text assertion, and all four passed typecheck, the whole suite, and
 * packaging. So the numbers below are the contract, read off the running 0.66 app.
 * ------------------------------------------------------------------ */

const CSS_TEXT = () => {
  const file = cssName();
  if (!file) return "";
  return readFileSync(path.join(import.meta.dirname, "..", ".build/fidelity/app/dist/renderer/assets", file), "utf8");
};

const styleList = (name) => {
  // Tolerate a type annotation between the name and `=` (the substitution table is typed), so
  // locate the export first and take the first `[` after it.
  const decl = STYLES.indexOf(`export const ${name}`);
  assert.ok(decl > 0, `official-styles.ts must export ${name}`);
  // Locate the initializer, not any `[` inside a type annotation
  // (e.g. `ReadonlyArray<readonly [a, b, c, d]>` carries brackets of its own).
  const open = STYLES.indexOf("= [", decl) + 2;
  // Bracket-count to the matching `]`. A plain `indexOf("];")` silently runs into the NEXT
  // declaration whenever the literal is written `] as const;`, and a guard that reads the wrong
  // array still passes — it just stops guarding.
  let depth = 0;
  let close = -1;
  for (let i = open; i < STYLES.length; i++) {
    if (STYLES[i] === "[") depth++;
    else if (STYLES[i] === "]") {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  assert.ok(close > open, `${name} must be a closed array literal`);
  return [...STYLES.slice(open + 1, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};

/** `padding-inline-start:10px` and `padding-left:10px` are the same declaration under LTR. */
const normalizeDecl = (decl) => decl.replace(/\s+/g, "").replace(/^padding-inline-start:/, "padding-left:")
  .replace(/^padding-inline-end:/, "padding-right:")
  .replace(/^border-inline-start-/, "border-left-").replace(/^border-inline-end-/, "border-right-");

/** The `[official, officialDecl, substitute, substituteDecl]` rows, parsed as real tuples. */
const substitutionRows = () => {
  const decl = STYLES.indexOf("export const ACTION_BUTTON_018_SUBSTITUTES");
  assert.ok(decl > 0, "official-styles.ts must export ACTION_BUTTON_018_SUBSTITUTES");
  // Locate the initializer, not any `[` inside a type annotation
  // (e.g. `ReadonlyArray<readonly [a, b, c, d]>` carries brackets of its own).
  const open = STYLES.indexOf("= [", decl) + 2;
  let depth = 0;
  let close = -1;
  for (let i = open; i < STYLES.length; i++) {
    if (STYLES[i] === "[") depth++;
    else if (STYLES[i] === "]") {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  assert.ok(close > open, "the substitution table must be a closed array literal");
  return [...STYLES.slice(open, close).matchAll(/\[\s*"([^"]+)",\s*"([^"]*)",\s*"([^"]+)",\s*"([^"]*)",?\s*\]/g)]
    .map((m) => ({ official: m[1], officialDecl: m[2], substitute: m[3], substituteDecl: m[4] }));
};

test("the row 添加 button carries the official 0.66 recipe, not the guessed sand-kit-button one", () => {
  const classes = styleList("ACTION_BUTTON_CLASSES");
  const official = styleList("ACTION_BUTTON_OFFICIAL_CLASSES");

  // Official's geometry carriers — each verified present in 0.18's stylesheet.
  for (const cls of ["sand-d7y6wv", "sand-9h44rk", "sand-exx8yu", "sand-2vl965", "sand-18d9i69", "sand-17d4w8g", "sand-uxw1ft", "sand-1kxuqrf", "sand-1wd3ewq", "sand-1k6tqyu"]) {
    assert.ok(classes.includes(cls), `ACTION_BUTTON_CLASSES must keep ${cls}; without it the pill loses its official geometry`);
  }
  assert.ok(classes.includes("sand-button"), "official's marker class is carried for className parity");
  assert.ok(!classes.includes("sand-kit-button"), "the guessed sand-kit-button recipe is what produced the 32x24 pill");
  assert.ok(!classes.includes("sand-167g77z"), "sand-167g77z is gap:8px from the wrong recipe");

  // The emitted list must be official's, modulo exactly the documented substitutions.
  const rows = substitutionRows();
  assert.equal(rows.length, 7, "seven substitutions are documented");
  const replaced = new Map(rows.map((r) => [r.official, r.substitute]));
  for (const r of rows) {
    assert.ok(official.includes(r.official), `${r.official} should be part of official's class list`);
    assert.ok(classes.includes(r.substitute), `${r.substitute} (the 0.18 stand-in for ${r.official}) must be emitted`);
    assert.ok(!classes.includes(r.official), `${r.official} has no rule in 0.18's stylesheet — emitting it would be a no-op`);
    // The substitute must carry the SAME declaration as the official class it replaces, modulo
    // logical-vs-physical property naming. Both sides are read out of the installed stylesheets.
    assert.equal(normalizeDecl(r.substituteDecl), normalizeDecl(r.officialDecl), `${r.substitute} must stand in for ${r.official} with the same value`);
  }
  const expected = official.map((c) => replaced.get(c) ?? c);
  assert.deepEqual(classes, expected, "the emitted recipe must equal official's, with only the documented substitutions applied");
});

test("no style list we emit references a class 0.18's stylesheet does not define", () => {
  // The root cause of the 32x24 pill: seven official classes were emitted verbatim while 0.66's
  // stylesheet — not 0.18's — was what defined them. Semantic markers carry no rule in EITHER
  // stylesheet, so they are allowed through by name.
  //
  // Scope: the lists this change touched. `sand-yri2b`/`sand-1c1uobl`/`sand-1firant`/
  // `sand-1iolv91` still appear verbatim in several PRE-EXISTING lists (detail title, close
  // button, back bar); those controls already measure correctly in the deployed build, so
  // rewriting them is out of scope here and is recorded as a known gap in EVIDENCE §22 rather
  // than silently forgotten.
  const css = CSS_TEXT();
  const SEMANTIC = new Set([
    "sand-button", "sand-kit-button", "sand-kit-icon", "sand-kit-icon-button", "sand-plugins-dialog__close",
  ]);
  const LISTS = [
    "ACTION_BUTTON_CLASSES", "DETAIL_BACK_BUTTON_CLASSES", "MANAGE_BACK_BUTTON_CLASSES",
    "SHARE_ICON_CLASSES", "SHARE_LABEL_CLASSES", "DETAIL_SHARE_BUTTON_CLASSES", "DETAIL_PRIMARY_BUTTON_CLASSES",
  ];
  if (css === "") return; // staged CSS absent — the structural guards above still apply
  for (const name of LISTS) {
    for (const cls of styleList(name)) {
      if (SEMANTIC.has(cls)) continue;
      if (cls.startsWith("ui-")) continue; // the icon font rules live in the other layer
      assert.ok(new RegExp(`\\.${cls}[{,:\\s]`).test(css), `${name} emits ${cls}, which the 0.18 stylesheet does not define`);
    }
  }
});

test("查看源码 keeps its external-link icon inside the anchor", () => {
  // Official: <a><text/><i class="ui-icon"/></a> → 69px wide. Appending the glyph to the wrapper
  // span left a text-only anchor at 52px and dropped the icon with no error anywhere.
  const block = VIEW.slice(VIEW.indexOf("const sourceRow = el("), VIEW.indexOf("titleCol.append(sourceRow)"));
  assert.match(block, /link\.append\(glyph\("arrow-up-right", GLYPH\.externalLink, 13\)\)/);
  assert.ok(!/sourceRow\.append\(glyph\(/.test(block), "the glyph must not be appended to the wrapper span");
  assert.ok(block.indexOf("link.append(glyph") < block.indexOf("sourceRow.append(link)"), "icon is appended into the anchor, then the anchor into the row");
});

test("分享 is an icon box plus a label span, not bare button text plus a glyph", () => {
  // Official's children are [sand-kit-icon 18x18][label span 28x20] = 82x36 total. Passing the
  // label as button text and appending an unwrapped 14px glyph gave 78px.
  const block = VIEW.slice(VIEW.indexOf("const share = el("), VIEW.indexOf("actions.append(share)"));
  assert.ok(!/el\("button", DETAIL_SHARE_BUTTON_CLASSES, TEXT\.share\)/.test(block), "the label must not be the button's text node");
  assert.match(block, /el\("span", SHARE_ICON_CLASSES\)/);
  assert.match(block, /share\.append\(shareIcon\)/);
  assert.match(block, /el\("span", SHARE_LABEL_CLASSES, TEXT\.share\)/);
  assert.ok(block.indexOf("share.append(shareIcon)") < block.indexOf("SHARE_LABEL_CLASSES"), "the icon box comes first");
  assert.match(VIEW, /glyph\("link", GLYPH\.share, 14\)/, "official's 分享 glyph is the link glyph at 14px");
});

test("the detail bar's icon-only 返回 and the manage page's labelled ‹ 市场 are different controls", () => {
  // Sharing one recipe rendered the icon-only back button 36x28 instead of 28x28. Official sizes
  // the detail bar's back from sand-gd8bvy/sand-1fgtraw, which the manage button does not carry.
  const detailBack = styleList("DETAIL_BACK_BUTTON_CLASSES");
  assert.ok(detailBack.includes("sand-gd8bvy") && detailBack.includes("sand-1fgtraw"), "28x28 comes from the explicit width/height classes");
  const manageBack = styleList("MANAGE_BACK_BUTTON_CLASSES");
  assert.ok(!manageBack.includes("sand-gd8bvy"), "the manage back button is not the 28x28 icon button");
  for (const cls of ["sand-11wthnw", "sand-d4r4e8", "sand-12oo3zp", "sand-19aaqeu"]) {
    assert.ok(manageBack.includes(cls), `official's manage back carries ${cls}`);
  }
  const bar = VIEW.slice(VIEW.indexOf("const bar = el(\"div\", DETAIL_BAR_CLASSES)"), VIEW.indexOf("const bar = el(\"div\", BACK_BAR_CLASSES)"));
  assert.match(bar, /el\("button", DETAIL_BACK_BUTTON_CLASSES\)/);
  const manage = VIEW.slice(VIEW.indexOf("const bar = el(\"div\", BACK_BAR_CLASSES)"));
  assert.match(manage.slice(0, 400), /el\("button", MANAGE_BACK_BUTTON_CLASSES\)/);
});

/* ------------------------------------------------------------------ *
 * Detail-page value parity (added after three wrong strings shipped)
 *
 * All three of these shipped wrong with the suite fully green, because nothing asserted the
 * rendered *values* — only that the rows existed. The strings below are transcribed from
 * official 0.66's own zh-CN message catalog, not measured one UI click at a time.
 * ------------------------------------------------------------------ */

test("the add-account row reads 添加其他账户, not 添加账户", () => {
  // Official's catalog carries BOTH strings: `FGnQEW` = 添加其他账户 and `MPPZ54` = 添加账户.
  // Only FGnQEW is the detail row — MPPZ54 is a different surface entirely (it resolves to
  // "Lisää tili" in Finnish, i.e. "Add language", so it is an unrelated key in a shared catalog).
  // An earlier capture here transcribed the row as 添加账户 and the suite never noticed.
  assert.match(MODEL, /addAccount:\s*"添加其他账户"/);
  assert.doesNotMatch(
    MODEL,
    /addAccount:\s*"添加账户"/,
    "官方 0.66 的 .sand-plugins-detail__add-account 文案是 添加其他账户",
  );
});

test("信息 · 网站 shows the publisher website while 查看源码 keeps the repository URL", () => {
  // Gmail on official 0.66: `信息 · 网站` = cursor.com (from the top-level `websiteUrl`) and
  // `查看源码` href = https://github.com/cursor/plugins (from `repositoryUrl`). Collapsing the two
  // into one field rendered github.com in the 网站 row.
  assert.match(MODEL, /const websiteUrl = str\(entry\.websiteUrl\) \|\| str\(entry\.homepage\);/);
  assert.match(MODEL, /const sourceUrl = str\(entry\.repositoryUrl\) \|\| str\(entry\.homepage\);/);
  assert.match(MODEL, /TEXT\.infoWebsite, value: displayHost\(websiteUrl\)/);
  assert.match(MODEL, /sourceUrl,/);

  // Both fields must survive BOTH projections. The second one has already dropped `categoryKeys`
  // once, and a field added to `toPlugin` alone leaves the renderer with `undefined`.
  assert.match(
    MCP_MARKETPLACE,
    /websiteUrl: publisher\?\.websiteUrl \|\| undefined,[\s\S]*?repositoryUrl: plugin\.repositoryUrl \|\| undefined,[\s\S]*?homepage: plugin\.repositoryUrl \|\| undefined,/,
    "toPlugin must carry websiteUrl and repositoryUrl as separate fields, and must not prefer the repo for homepage",
  );
  // The website lives on the PUBLISHER and upstream hoists it. The wire `Plugin` message has no
  // top-level website field, so reading `plugin.websiteUrl` inside `toPlugin` is always undefined
  // — which is how the 网站 row came to render `github.com` on every entry while looking correctly
  // wired. Scope the ban to toPlugin: `marketplacePluginToView` reading `plugin.websiteUrl` is
  // correct, because there `plugin` is our own already-hoisted SandMarketplacePlugin.
  const TO_PLUGIN = MCP_CODE.slice(
    MCP_CODE.indexOf("function toPlugin("),
    MCP_CODE.indexOf("export async function fetchMarketplaceMcpPlugins"),
  );
  assert.doesNotMatch(
    TO_PLUGIN,
    /websiteUrl: plugin\.websiteUrl/,
    "the wire Plugin has no top-level websiteUrl; upstream reads publisher.websiteUrl and hoists it",
  );
  assert.match(
    MCP_MARKETPLACE,
    /export interface SandMarketplacePlugin[\s\S]*?publisher\?: \{ name: string; displayName: string; isUserOwned: boolean \}/,
    "the projected publisher shape is lossy — it is not the wire shape, so it cannot be used to conclude the wire lacks a field",
  );
});

test("信息 · 类别 renders official's localized label, not the raw English category", () => {
  // Live 0.66 detail pages read 精选 (Gmail/FEATURED), 研究 (Ahrefs/RESEARCH) and 支付
  // (1inch/PAYMENTS). The last one is the proof this is not the bucket label: PAYMENTS buckets to
  // `finance` whose section title is 财务, yet the 类别 row says 支付.
  assert.match(MODEL, /\{ label: TEXT\.infoCategory, value: categoryDetailLabel\(entry\) \}/);
  assert.doesNotMatch(
    MODEL,
    /\{ label: TEXT\.infoCategory, value: str\(entry\.category\) \}/,
    "the raw catalog category is English (Featured/Research) and is not what official renders",
  );

  // The whole 16-entry table, transcribed from official's own `E` table + zh-CN catalog.
  const table = MODEL.slice(
    MODEL.indexOf("const CATEGORY_DETAIL_LABELS"),
    MODEL.indexOf("export function categoryDetailLabel"),
  );
  for (const [key, label] of [
    ["FEATURED", "精选"],
    ["INFRASTRUCTURE", "基础设施"],
    ["DATA_ANALYTICS", "数据分析"],
    ["PRODUCTIVITY", "效率"],
    ["PAYMENTS", "支付"],
    ["AGENT_ORCHESTRATION", "智能体编排"],
    ["CANVAS", "画布"],
    ["INBOX_AND_COLLABORATION", "收件箱与协作"],
    ["SCHEDULING", "日程安排"],
    ["DOCUMENTS_AND_FILES", "文档与文件"],
    ["SALES", "销售"],
    ["CUSTOMER_SUPPORT", "客户支持"],
    ["FINANCE_AND_LEGAL", "财务与法务"],
    ["RESEARCH", "研究"],
    ["DESIGN", "设计"],
    ["LOGIN_AND_CREDENTIAL_MANAGEMENT", "登录与凭据管理"],
  ]) {
    assert.match(table, new RegExp(`${key}:\\s*"${label}"`), `${key} must render ${label}`);
  }
  // An unmapped key must fall back to the raw category, which is what official does when
  // `categoryKey` misses its own table — never to a guessed translation.
  assert.match(MODEL, /return str\(entry\.category\);/);
});
