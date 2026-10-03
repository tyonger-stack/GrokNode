// Regression cover for the Connect Apps footer pill (the "plugins dock" renderer extension).
//
// The pill used to be hand-approximated with `--cursor-*` tokens and its own geometry, which is
// exactly why it did not match the official build: the official pill draws
// `background-color: var(--sand-bg-elevated)` and `border-color: var(--sand-border-weak)`, so a
// hand-rolled surface can look close and still be a different colour. It is now assembled from the
// official 0.66 class lists instead, which makes the failure modes worth guarding:
//
//   * a class name we assume 0.18 also has. stylix derives the name from the declaration block, so
//     a rule that survives across versions keeps its name — but a rule the official build added
//     later does not exist in 0.18 at all, and the property is then silently dropped. Every class
//     the extension applies must therefore resolve to EITHER a rule in the 0.18 stylesheet OR a
//     lifted rule in the extension itself.
//   * a lifted rule drifting away from the official declaration it was copied from.
//   * the old hand-rolled surface creeping back in (cursor tokens, a count badge, a 4-logo cap).
//
// The class-name resolution check needs the staged 0.18 stylesheet. When that is absent (a clean
// checkout before packaging) the check reports as skipped rather than passing silently.
//
// The last block covers the RAIL ("collapsed sidebar") market row — the second surface upstream
// mounts when the sidebar narrows, where the pill is unmounted and a bare circular `storefront`
// icon button takes its place. Two of those guards exist because the build was green and the
// screenshot was still wrong:
//   * the account row's text span was hidden with `:last-child`, which is the avatar itself in rail
//     state, so the whole footer rendered blank;
//   * the row was created with the marker class on the button but looked up on the wrapper, so
//     every collapse added another 34px row. Both are invisible to the other checks — only a
//     node count taken from the running app catches the second one.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = path.join(repoRoot, "frontend", "src", "extensions", "plugins-dock-entry.ts");
const source = readFileSync(entryPath, "utf8");

const STAGED_ASSETS = path.join(repoRoot, ".build", "fidelity", "app", "dist", "renderer", "assets");

function readStringArray(name) {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match != null, `${name} array is missing from ${path.relative(repoRoot, entryPath)}`);
  return Array.from(match[1].matchAll(/"([^"]+)"/g), (m) => m[1]);
}

function readLiftedRules() {
  const body = source.match(/const LIFTED_OFFICIAL_RULES[\s\S]*?= \[([\s\S]*?)\n\];/);
  assert.ok(body != null, "LIFTED_OFFICIAL_RULES is missing");
  return Array.from(body[1].matchAll(/\[\s*"(\.[^"]+)"\s*,\s*"([^"]+)"\s*\]/g), (m) => ({
    selector: m[1],
    declarations: m[2],
  }));
}

const OFFICIAL_CLASS_ARRAYS = [
  "OFFICIAL_BUTTON_CLASSES",
  "OFFICIAL_ICON_SPAN_CLASSES",
  "OFFICIAL_LABEL_SPAN_CLASSES",
  "OFFICIAL_LOGOS_WRAPPER_CLASSES",
  "OFFICIAL_LOGO_STACK_CLASSES",
  "OFFICIAL_LOGO_SLOT_CLASSES",
  "OFFICIAL_LOGO_ICON_BOX_CLASSES",
  "OFFICIAL_LOGO_IMG_CLASSES",
];

/** Prose is allowed to name the old tokens (the file header explains why they were wrong); only
 *  executable code is under test here. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the pill is assembled from the official 0.66 class lists", () => {
  const button = readStringArray("OFFICIAL_BUTTON_CLASSES");
  // The rules that carry the official surface. If any of these is dropped the pill silently falls
  // back to an unstyled/transparent button rather than failing.
  for (const className of [
    "sand-10e981r", // background-color: var(--sand-bg-elevated)
    "sand-q03nf1", // border-color: var(--sand-border-weak)
    "sand-mkeg23", // border-width: 1px
    "sand-1y0btm7", // border-style: solid
    "sand-149ho13", // border-radius: 9999px
    "sand-c9qbxq", // height: 36px
    "sand-xhr3t", // gap: 0
    "sand-1iyjqo2", // flex-grow: 1
  ]) {
    assert.ok(button.includes(className), `button class list is missing ${className}`);
  }
  const label = readStringArray("OFFICIAL_LABEL_SPAN_CLASSES");
  for (const className of ["sand-uxw1ft", "sand-lyipyv", "sand-1ncir08"]) {
    assert.ok(label.includes(className), `label class list is missing ${className} (nowrap/ellipsis/max-width)`);
  }

  // The official logo fan-out lives on the stack + slot elements; without them the logos render
  // unstyled at the wrapper's natural size.
  const stack = readStringArray("OFFICIAL_LOGO_STACK_CLASSES");
  assert.ok(stack.includes("sand-1vtibv1"), "logo stack is missing sand-1vtibv1 (height: 18px)");
  const slot = readStringArray("OFFICIAL_LOGO_SLOT_CLASSES");
  assert.ok(slot.includes("sand-1ccui7m"), "logo slot is missing sand-1ccui7m (padding-inline-end)");
});

test("no hand-rolled cursor-token surface is left on the pill", () => {
  // These are the tokens that made the pill a different colour from the official build.
  assert.ok(
    !/--(cursor-bg|cursor-border|cursor-text)-(secondary|tertiary|elevated|primary)/.test(code),
    "the extension still styles the pill with --cursor-* tokens instead of the official --sand-* surface",
  );
});

test("the official surface has no count badge", () => {
  // The 0.66 pill renders exactly three children: collapsed icon, label, logos. A count badge was
  // this build's own invention and has no official counterpart.
  assert.ok(!/sand-plugins-dock-count/.test(source), "the count badge is back; the official pill has none");
  assert.ok(!/已配置 \d* 个连接/.test(source), "the count badge aria-label is back");
  assert.ok(!/String\(installed\.size\)/.test(source), "the installed-count badge is being rendered again");
});

test("logos are capped at the official limit", () => {
  assert.match(source, /const LOGO_LIMIT = 3;/, "LOGO_LIMIT must stay at the official cap of 3");
});

test("the pill advertises suggestions, not the already-configured set", () => {
  // Official semantics: `isPublicListed === true && !isInstalled(item)`, capped at 3. The previous
  // build showed the configured servers, which is the opposite affordance.
  const body = source.match(/function pickSuggestedLogos\([\s\S]*?\n\}/);
  assert.ok(body != null, "pickSuggestedLogos is missing");
  assert.match(body[0], /configured\.has\(String\(entry\.id\)\)/, "suggestions must exclude configured entries");
  assert.match(body[0], /continue;/, "entries without an icon must be skipped");
  assert.ok(
    /local catalog[\s\S]*?exposes neither field/i.test(source),
    "the catalog-shape gap (isPublicListed / teamInstallCounts) must stay documented as uncertainty",
  );
});

test("the MutationObserver only re-enters on the upstream row", () => {
  // A blanket `subtree` callback that also fires on this extension's own writes is what turns a
  // refresh into an endless mutation loop (see .cache/marketplace-resume/ledger.md, hypothesis 3).
  assert.match(
    source,
    /node\.matches\(BUTTON_SELECTOR\) \|\| node\.querySelector\(BUTTON_SELECTOR\) != null/,
    "the observer must gate on the upstream button being inserted",
  );
});

test("re-runs never hide the label this extension rendered", () => {
  // ensureButtonSurface() runs again on every matching mutation. Upstream's own label is found by
  // "a span with text", which is also true of the label span this extension appends — without an
  // explicit exclusion the second pass tags its own label as upstream's and display:none kills the
  // label. A silent, self-inflicted regression that only shows up on the second run.
  assert.match(code, /const isOwnNode = \(node: Element\)/, "own-node guard is missing");
  assert.match(
    code,
    /if \(child === iconSpan \|\| isOwnNode\(child\)\) continue;/,
    "the upstream-label scan must skip the spans this extension owns",
  );
  assert.match(
    code,
    /iconSpan\.classList\.add\(ICON_CLASS\)/,
    "the icon slot must be marked by class, not by child order (::first-child breaks once spans are appended)",
  );
});

test("the label and logos spans carry the marker class at creation time", () => {
  // ensureButtonSurface() finds its own nodes by that marker. If creation forgets to set it, every
  // pass appends ANOTHER label/logos pair and the button grows without bound — observed live as six
  // children with two of them display:none'd. Creating the node and tagging it must not be split.
  assert.match(
    code,
    /label = document\.createElement\("span"\);\s*label\.classList\.add\(LABEL_CLASS\);/,
    "the label must be tagged with LABEL_CLASS in the same step it is created",
  );
  assert.match(
    code,
    /logos = document\.createElement\("span"\);[\s\S]{0,200}?logos\.classList\.add\(LOGOS_CLASS\);/,
    "the logos wrapper must be tagged with LOGOS_CLASS in the same step it is created",
  );
  assert.match(code, /querySelector<HTMLSpanElement>\(`\.\$\{LABEL_CLASS\}`\)/, "the label must be looked up by its marker");
  assert.match(code, /querySelector<HTMLSpanElement>\(`\.\$\{LOGOS_CLASS\}`\)/, "the logos wrapper must be looked up by its marker");
});

test("lifted rules can match the dock button itself, not only its descendants", () => {
  // The button carries the pill classes AND the scope class at the same time. A descendant
  // selector (`.sand-plugins-dock .sand-pdmqnj`) never matches an element that is its own ancestor
  // part, so the pill's own padding/border-radius contributions were silently dropped — the
  // computed padding stayed at the 0.18 default instead of the official 0 12px 0 16px.
  assert.match(
    code,
    /flatMap\(\(\[selector, declarations\]\) => \[\s*`\$\{scope\}\$\{selector\}\{/,
    "each lifted rule must also be emitted in same-element form (${scope}${selector})",
  );
  assert.match(
    code,
    /`\$\{scope\} \$\{selector\}\{/,
    "the descendant form must be kept for rules that target child nodes",
  );
});

test("the 0.18-only sidebar classes cannot out-rank the official pill metrics", () => {  // The 0.18 row still carries 18 classes 0.66 dropped, and they sit later in 0.18's stylesheet,
  // so at equal specificity they beat the official pill classes on gap and padding — measured live
  // as gap:8px / padding-block:6px / padding-inline:8px against the official 0 / 0 / 16px 12px.
  // The values re-asserted here are the official build's own computed values.
  assert.match(
    code,
    /\$\{scope\}\{gap:0 !important;padding-block:0 !important;padding-inline:16px 12px !important;\}/,
    "the official gap/padding must be re-asserted against the 0.18-only classes",
  );
  assert.match(source, /sand-167g77z/, "the comment must name the 0.18-only class that overrides gap");
  assert.match(source, /sand-1yrsyyn/, "the comment must name the 0.18-only classes that override padding-block");
});

test("every applied class name resolves in 0.18 or is lifted verbatim", (t) => {
  const lifted = readLiftedRules();
  const liftedSelectors = new Set(lifted.map((rule) => rule.selector.slice(1)));

  const cssFiles = existsSync(STAGED_ASSETS)
    ? readdirSync(STAGED_ASSETS).filter((name) => name.endsWith(".css"))
    : [];
  if (cssFiles.length === 0) {
    t.skip("staged 0.18 stylesheet not present (run npm run package first)");
    return;
  }
  const css = cssFiles.map((name) => readFileSync(path.join(STAGED_ASSETS, name), "utf8")).join("\n");

  const applied = new Set(OFFICIAL_CLASS_ARRAYS.flatMap(readStringArray));
  // `sand-tool-icon` / `sand-tool-icon--logo` are semantic hooks with no declarations in either
  // stylesheet, so they are expected to resolve to nothing.
  const semanticOnly = new Set(["sand-tool-icon", "sand-tool-icon--logo"]);

  const unresolved = [];
  for (const className of applied) {
    if (semanticOnly.has(className)) continue;
    const inBaseline = new RegExp(`\\.${className}(?![\\w-])[^{]*\\{`).test(css);
    if (!inBaseline && !liftedSelectors.has(className)) unresolved.push(className);
  }
  assert.deepEqual(unresolved, [], "class names with neither a 0.18 rule nor a lifted rule: they would be silently ignored");
});

test("lifted rules are single-line declarations copied from the official stylesheet", () => {
  for (const { selector, declarations } of readLiftedRules()) {
    assert.match(selector, /^\.sand-[a-z0-9]+$/, `unexpected lifted selector: ${selector}`);
    assert.ok(!declarations.includes("}"), `lifted rule ${selector} must be a single declaration block`);
    assert.ok(declarations.trim().length > 0, `lifted rule ${selector} is empty`);
  }
});

test("the hover anchor class is applied — dropping it silently kills every hover rule", () => {
  // `sand--default-marker` is `{"sand--default-marker":"sand--default-marker",$$css:!0}` with no
  // declarations of its own, which makes it look inert. It is not: it is the anchor for every
  // `:where(.sand--default-marker:hover) …` rule in the official stylesheet. An earlier revision of
  // this file dropped it on the "no declarations" reading and the pill's logo hover simply stopped
  // firing, with no error anywhere.
  const button = readStringArray("OFFICIAL_BUTTON_CLASSES");
  assert.ok(
    button.includes("sand--default-marker"),
    "the button must carry sand--default-marker; it is the hover anchor, not an inert marker",
  );
  assert.match(
    source,
    /anchor for[\s\S]*?`:where\(\.sand--default-marker:hover\)/,
    "the reason the class is load-bearing must stay documented next to it",
  );
});

test("the logo fan phases and the hover rules that act on them are both present", () => {
  // Official applies fanStart/fanMiddle/fanEnd by slot index; hovering swaps the outer two to their
  // transformed phase, which is what grows them 18px -> 20px and rotates them outward. A slot with
  // no fan class cannot be hovered into anything.
  for (const className of ["sand-1c071of", "sand-1q77ly", "sand-1nbbp8h", "sand-1rwtdfy"]) {
    assert.ok(code.includes(className), `fan phase class ${className} is missing`);
  }
  const hoverRules = code.match(/const LIFTED_HOVER_RULES[\s\S]*?\n\];/);
  assert.ok(hoverRules != null, "LIFTED_HOVER_RULES is missing");
  assert.match(hoverRules[0], /sand-1q77ly/, "the first (outward-left) hover rule is missing");
  assert.match(hoverRules[0], /sand-1rwtdfy/, "the last (outward-right) hover rule is missing");
  assert.match(hoverRules[0], /sand-1nbbp8h/, "the middle slot's 1px hover lift is missing");
  // Without !important these rules are dead on arrival: 0.18's own `.sand-1c071of:not(#\\#)×3`
  // computes to the same (0,4,0) specificity and wins on source order, because the 0.18 stylesheet is
  // injected into <head> at runtime and can land after this extension's <style>. Verified with
  // CSS.getMatchedStylesForNode: the rule matches, :hover is active, and the slot still computed
  // `transform: none`.
  for (const [, selector, declarations] of hoverRules[0].matchAll(/\[\s*"(\.[^"]+)"\s*,\s*"([^"]+)"\s*\]/g)) {
    assert.match(declarations, /!important$/, `hover rule ${selector} needs !important to out-rank 0.18's .sand-1c071of`);
  }
  assert.match(
    code,
    /`\$\{scope\}:hover \$\{selector\}\$\{selector\}\{/,
    "hover rules must be emitted with the doubled-class specificity bump the official sheet relies on",
  );
  assert.match(
    code,
    /index === 0 \? OFFICIAL_LOGO_FAN_CLASSES\[0\] : index === total - 1 \? OFFICIAL_LOGO_FAN_CLASSES\[2\] : OFFICIAL_LOGO_FAN_CLASSES\[1\]/,
    "the fan phase must be chosen by slot position (start / middle / end)",
  );
});

test("the footer insets match the official build", () => {
  // Measured: official avatar x=16, 0.18 avatar x=20. The 4px is the sum of two upstream
  // differences — the official footer pads `0 16px 16px` (its `sand-mzvs34` does not exist in
  // 0.18) while 0.18 pads `2px 12px 12px`, and 0.18 additionally puts `padding: 0 8px` on the
  // trigger itself. Re-asserting the official values on the footer is enough for the left edge,
  // because the avatar is the trigger's first child and sits in its content box.
  assert.match(
    code,
    /ACCOUNT_FOOTER_SELECTOR\}\{padding-top:0 !important;padding-bottom:16px !important;padding-inline:16px !important;\}/,
    "the footer must use the official 0/16px/16px insets",
  );
  assert.match(source, /sand-mzvs34/, "the class that carries the official footer insets must stay named as the reason");
  // 0.18 also pads the trigger itself (`padding: 0 8px`), which pushes the avatar to x=24 and
  // closes the pill gap to 0. The official trigger is a bare circle with `padding: 0`; zeroing
  // only the inline padding keeps the full-width hit area.
  assert.match(
    code,
    /ACCOUNT_BUTTON_SELECTOR\}\{padding-inline:0 !important;\}/,
    "the trigger's own 8px inline padding must be zeroed so the avatar lands on the official x=16",
  );
  // 16 (footer inset) + 36 (avatar) + 8 (gap) = 60, which is where the pill has to start.
  const footerInset = code.match(/ACCOUNT_FOOTER_SELECTOR\}\{[^}]*padding-inline:16px/);
  assert.ok(footerInset != null, "the footer inline inset must be 16px");
  assert.match(code, /left:60px !important;/, "the pill start must be 16 + 36 + 8");
});

test("the account disc dims on hover and dims further while pressed", () => {
  // Measured on the running official build with a real pointer event:
  //   rest  filter: none
  //   hover filter: brightness(0.9)    <- .sand-1spsku0
  //   press filter: brightness(0.82)   <- .sand-64r99s
  //   transition-property: filter      <- .sand-1eokjkq
  //
  // The trap: this is applied to `filter`, NOT to any background property. A check that reads
  // `backgroundColor` across hover reports "no change" and looks like the interaction is missing —
  // which is exactly what happened the first time round. The same grey the pill paints on hover
  // (`rgba(119,119,119,0.09)`) is what this produces, by a different mechanism.
  //
  // None of the three class names exist in 0.18, so the declarations are lifted.
  assert.match(
    code,
    /ACCOUNT_BUTTON_SELECTOR\}:hover\{filter:brightness\(\.9\) !important;\}/,
    "hover must dim the disc with brightness(0.9), matching the official sand-1spsku0 rule",
  );
  assert.match(
    code,
    /ACCOUNT_BUTTON_SELECTOR\}:active\{filter:brightness\(\.82\) !important;\}/,
    "pressing must dim further to brightness(0.82), matching the official sand-64r99s rule",
  );
  assert.match(
    code,
    /ACCOUNT_BUTTON_SELECTOR\}\{transition-property:filter !important;/,
    "the filter transition must be declared, matching the official sand-1eokjkq rule",
  );
  assert.match(source, /brightness/, "the press-feedback values must stay visible in the source");
  assert.match(
    source,
    /not to any background property/,
    "the measurement trap must stay documented so a future background-only check is not mistaken for a regression",
  );
});

test("the account avatar matches the official 36px", () => {
  // Official's footer pairs a 36x36 circular avatar with the pill in one 36px band; the 0.18 row
  // ships a 28x28 monogram, which is the size difference visible in the screenshot.
  assert.match(
    code,
    /ACCOUNT_BUTTON_SELECTOR\} > span:first-child,\$\{ACCOUNT_AVATAR_SELECTOR\}\{width:36px !important;height:36px !important;\}/,
    "the account avatar must be forced to the official 36px",
  );
  assert.match(code, /ACCOUNT_BUTTON_SELECTOR\}:hover\{background:transparent !important;\}/, "the wide account row must not paint a hover background the official 36px circle does not");
});

test("the pill clears the account avatar with the official 8px gap", () => {
  // Measured on the running official build: avatar right edge 52, pill left edge 60. At the 56px
  // this used to use, the pill sat flush against the avatar with a 0px gap — the two looked welded
  // together, which is the "L 图标和连接应用窗口太近" report.
  assert.match(
    code,
    /`\$\{ENTRY_SELECTOR\}\{position:absolute !important;left:60px !important;/,
    "the pill must start 8px after the avatar's right edge, matching the official build",
  );
  assert.ok(
    !/left:56px !important;right:8px/.test(code),
    "left:56px puts the pill flush against the avatar (0px gap); the official build measures 60px",
  );
  // The right edge has to land on the footer's content box too, not just the left gap. Official
  // button measures x=60 … 383.5 (width 323.5) inside a 399.5px footer, i.e. it stops at
  // 399.5 − 16 — the footer's own right inset. `right:8px` overshot to 391.5, an 8px overhang
  // that made our pill visibly wider than the official one even though both shared a left edge.
  assert.match(
    code,
    /left:60px !important;right:16px !important;/,
    "the pill's right edge must use the footer's 16px inset so its width matches the official 323.5px",
  );
  assert.ok(
    !/left:60px !important;right:8px/.test(code),
    "right:8px overshoots the official right edge by 8px",
  );
});

test("the account trigger is circular, like the official one", () => {
  // Official `border-radius: 9999px` on a 36px box; the 0.18 row is a 10px-radius full-width pill.
  // Only the radius is corrected — the trigger deliberately stays full width so the account menu
  // keeps its real hit area (re-parenting upstream's React node is not an option).
  assert.match(
    code,
    /ACCOUNT_BUTTON_SELECTOR\}\{border-radius:9999px !important;\}/,
    "the account trigger must use the official circular radius",
  );
});

test("the avatar disc is a real surface, so the ported hover feedback can be seen", () => {
  // This guard used to demand `background-color: transparent` on the reasoning that "the official
  // build leaves the disc transparent". Measured on the running official 0.66, that box model is
  // real — its `.sand-kit-base-avatar` computes to `background: rgba(0,0,0,0)`, `border: 0px none`
  // — but it renders an `<img>`, i.e. a photo FILLS the circle. Forcing this build's disc
  // transparent to match the box model therefore left a bare near-black monogram on the sidebar's
  // #f7f7f7 with no disc at all, and the ported `filter: brightness(.9)` / `brightness(.82)` hover
  // and press feedback became invisible: dimming a near-black glyph on a near-white surface moves
  // nothing the eye can see. The report was "no hover colour, and dimmer than the Connect Apps
  // button even at rest".
  //
  // A real pointer test (Input.dispatchMouseEvent, not CSS.forcePseudoState) confirms the ported
  // rules were resolving correctly all along — rest `none`, hover `brightness(0.9)`, pressed
  // `brightness(0.82)`, byte-identical to official. So the rules must stay; what was missing is a
  // disc for them to act on. The fallback is upstream's own surface recipe, the same one the
  // sibling dock pill uses, so the account circle and the pill read as siblings.
  assert.ok(
    !/ACCOUNT_AVATAR_SELECTOR\}\{background-color:transparent !important;\}/.test(code),
    "a transparent disc leaves no monogram background, which is what made the hover feedback invisible",
  );
  assert.match(
    code,
    /ACCOUNT_AVATAR_SELECTOR\}\{background-color:var\(--sand-bg-elevated, #fcfcfc\) !important;/,
    "the disc must get a real fill from the same upstream token the pill uses",
  );
  assert.match(
    code,
    /border:1px solid var\(--sand-border-weak, #1414141a\) !important;box-sizing:border-box !important;/,
    "the ring gives the disc a visible edge; box-sizing keeps the 36px box exact under the border",
  );
  // The ported hover/press rules are the thing being protected — they resolve, they just had
  // nothing to act on. Keep them asserted at their official values.
  assert.match(
    code,
    /ACCOUNT_BUTTON_SELECTOR\}:hover\{filter:brightness\(\.9\) !important;\}/,
    "the official hover step must stay ported",
  );
  assert.match(
    code,
    /ACCOUNT_BUTTON_SELECTOR\}:active\{filter:brightness\(\.82\) !important;\}/,
    "the official press step must stay ported",
  );
  assert.match(
    source,
    /dimming a near-black glyph on a near-white surface moves nothing/,
    "the measurement that overturned the transparent-disc decision must stay documented",
  );
  // 0.18 renders the monogram at 12px / medium; the official avatar is 13.33px / semibold.
  assert.match(
    code,
    /ACCOUNT_AVATAR_SELECTOR\}\{font-size:13\.3333px !important;\}/,
    "the monogram must use the official 13.33px",
  );
  assert.match(
    code,
    /ACCOUNT_AVATAR_SELECTOR\}\{font-weight:var\(--sand-font-weight-semibold,600\) !important;\}/,
    "the monogram must use the official semibold weight (0.18 pins it to medium via sand-1rhlpx6)",
  );
  assert.match(source, /INLINE style/, "the reason !important is required must stay documented");
});

// ---------------------------------------------------------------------------
// Rail ("collapsed sidebar") market row.
//
// Upstream 0.66 renders a SECOND surface once the sidebar collapses: the pill is unmounted and a
// bare circular `storefront` icon button (`lA`) takes its place, between `__rail-new` and
// `__footer`. 0.18 has the identical collapse machinery (`Jlt`/`Ult=210`/`GFe=220` vs 0.66's
// `R_`/`j_=210`/`f2=220`, and both gate the pill on `isCollapsed ? null : <pill/>`) but has no such
// row, so the rail sidebar was missing the entry entirely.
// ---------------------------------------------------------------------------

test("the rail market row exists and is mounted only while the sidebar is collapsed", () => {
  // Upstream is `isCollapsed ? <lA/> : null`, so the row must not linger when the sidebar expands —
  // it would sit next to the pill, which is the opposite of upstream's behaviour.
  const sync = code.match(/function syncRailButton\([\s\S]*?\n\}/);
  assert.ok(sync != null, "syncRailButton is missing");
  assert.match(sync[0], /isSidebarCollapsed\(\)/, "the row's presence must be gated on the collapse state");
  assert.match(sync[0], /removeRailRows\(sidebar\)/, "expanding the sidebar must unmount the row, like upstream");

  // The gate has to read the attribute the sidebar layout code actually writes (`Nle` in 0.18,
  // `wa` in 0.66) — there is no importable hook for it.
  assert.match(
    code,
    /const COLLAPSED_SELECTOR = "\.sand-shell\[data-sidebar-collapsed\]"/,
    "the rail gate must key off the shell's data-sidebar-collapsed attribute",
  );
});

test("the rail row is inserted where upstream puts it, between __rail-new and __footer", () => {
  const ensure = code.match(/function ensureRailButton\([\s\S]*?\n\}\n/);
  assert.ok(ensure != null, "ensureRailButton is missing");
  assert.match(ensure[0], /RAIL_NEW_SELECTOR/, "the row's anchors must include __rail-new");
  assert.match(ensure[0], /RAIL_FOOTER_SELECTOR/, "the row's anchors must include __footer");
  assert.match(
    ensure[0],
    /insertBefore\(wrapper, footer\)/,
    "the row must be inserted immediately before __footer, which is upstream's order",
  );
});

test("the rail row reuses the official 0.66 class lists", () => {
  const wrapper = readStringArray("RAIL_WRAPPER_CLASSES");
  // Byte-identical to the wrapper upstream puts on its own __rail-new row — that is why the two
  // rows stack with no extra layout code. `sand-10b6aqq` is the padding-bottom:6px that gives the
  // row its 34px box, and `sand-r1bnnl` is the entrance animation.
  for (const className of [
    "sand-78zum5", // display: flex
    "sand-dt5ytf", // flex-direction: column
    "sand-6s0dn4", // align-items: center
    "sand-2lah0s", // flex-shrink: 0
    "sand-10b6aqq", // padding-bottom: 6px
    "sand-lvsv26", // -webkit-app-region: no-drag
  ]) {
    assert.ok(wrapper.includes(className), `rail wrapper is missing ${className}`);
  }

  const button = readStringArray("RAIL_BUTTON_CLASSES");
  for (const className of [
    "sand-kit-icon-button",
    "sand-gd8bvy", // width: 28px
    "sand-1fgtraw", // height: 28px
    "sand-149ho13", // border-radius: 9999px
    "sand-jbqb8w", // background-color: transparent
    "sand-1o0liin", // color: var(--sand-text-secondary)
  ]) {
    assert.ok(button.includes(className), `rail button is missing ${className}`);
  }
});

test("the rail glyph is the storefront icon", () => {
  // 0.18 bundles `storefront` in its icon map but never renders it, so the glyph has to be named
  // explicitly. It travels through `--cursor-icon-content`; the `ui-*` classes are the same ones the
  // neighbouring `plus` glyph uses, because the icon component carries no glyph-specific class.
  assert.match(code, /const RAIL_ICON_NAME = "storefront"/, "the rail row must use the storefront glyph");
  assert.match(
    code,
    /glyph\.setAttribute\("data-icon-name", RAIL_ICON_NAME\)/,
    "the glyph must carry data-icon-name so the icon component resolves it",
  );
  assert.match(
    code,
    /glyph\.style\.setProperty\("--cursor-icon-content"/,
    "the glyph must be delivered through --cursor-icon-content; that is how ui-icon paints",
  );
  assert.match(code, /const RAIL_ICON_GLYPH = "\\uF483"/, "the storefront codepoint must be pinned");
  // A missing or wrong codepoint would render an empty button, and the source text alone cannot
  // prove the escape resolves to the intended glyph — so decode it and check the code point.
  const glyph = source.match(/const RAIL_ICON_GLYPH = "(\\u[0-9A-Fa-f]{4})"/);
  assert.ok(glyph != null, "the storefront codepoint literal is missing");
  assert.equal(
    Number.parseInt(glyph[1].slice(2), 16),
    0xf483,
    "the storefront codepoint must be U+F483, read off the live 0.66 renderer",
  );
});

test("the five rail-only official declarations are lifted, not hand-written", () => {
  const body = source.match(/const LIFTED_RAIL_RULES[\s\S]*?= \[([\s\S]*?)\n\];/);
  assert.ok(body != null, "LIFTED_RAIL_RULES is missing");
  const rules = Array.from(body[1].matchAll(/\[\s*"(\.[^"]+)"\s*,\s*"([^"]+)"\s*\]/g), (m) => ({
    selector: m[1],
    declarations: m[2],
  }));
  const bySelector = new Map(rules.map((r) => [r.selector, r.declarations]));
  const expected = new Map([
    [".sand-rez4as", "animation-duration:.2s"],
    [".sand-q56fva", "animation-timing-function:cubic-bezier(.22,1,.36,1)"],
    [".sand-yri2b", "padding-inline-end:0"],
    [".sand-1c1uobl", "padding-inline-start:0"],
    [".sand-1firant", "transition-duration:.12s"],
  ]);
  assert.equal(rules.length, expected.size, "the rail lift set changed; re-verify it against the official stylesheet");
  for (const [selector, declarations] of expected) {
    assert.equal(bySelector.get(selector), declarations, `${selector} must stay byte-identical to the official declaration`);
  }
  // Each must be a single declaration, exactly as copied.
  for (const rule of rules) {
    assert.doesNotMatch(rule.declarations, /;/, `${rule.selector} should be one lifted declaration, not a rule block`);
  }
  // Same dual-emission reason as the pill: these classes sit on the elements themselves, so a
  // descendant-only selector never matches.
  assert.match(
    code,
    /`\.\$\{RAIL_BUTTON_CLASS\}\$\{selector\}\{\$\{declarations\}\}`/,
    "rail rules must also be emitted in same-element form",
  );
  assert.match(
    code,
    /`\.\$\{RAIL_BUTTON_CLASS\} \$\{selector\}\{\$\{declarations\}\}`/,
    "rail rules must also be emitted in descendant form",
  );
});

test("every rail class resolves in 0.18 or is lifted", () => {
  const lifted = new Set(
    Array.from(
      (source.match(/const LIFTED_RAIL_RULES[\s\S]*?= \[([\s\S]*?)\n\];/) ?? [""])[1].matchAll(/\["\.(sand-[^"]+)"/g),
      (m) => m[1],
    ),
  );
  const arrays = [
    "RAIL_WRAPPER_CLASSES",
    "RAIL_BUTTON_CLASSES",
    "RAIL_ICON_SPAN_CLASSES",
    "RAIL_ICON_GLYPH_CLASSES",
  ];
  let css = null;
  const staged = readdirSync(STAGED_ASSETS).filter((f) => f.endsWith(".css"));
  if (staged.length > 0) css = readFileSync(path.join(STAGED_ASSETS, staged[0]), "utf8");
  for (const name of arrays) {
    for (const className of readStringArray(name)) {
      if (!className.startsWith("sand-") && !className.startsWith("ui-")) continue;
      if (lifted.has(className)) continue;
      // `ui-icon`/`cursor-icon` and the `sand-kit-*` hooks are component class names, not stylix
      // hashes: they carry no declaration of their own (the geometry comes from the stylix classes
      // applied alongside), so a missing rule for them is expected rather than a lift candidate.
      if (
        className.startsWith("ui-")
        || className === "cursor-icon"
        || className === "sand-kit-icon-button"
        || className === "sand-kit-icon"
      ) {
        continue;
      }
      if (css == null) continue;
      assert.ok(
        new RegExp(`\\.${className}(?![a-zA-Z0-9_-])`).test(css),
        `${className} (${name}) has no rule in the 0.18 stylesheet and is not lifted`,
      );
    }
  }
});

test("the rail row opens the same surface the pill opens", () => {
  // In rail state the pill is unmounted (`Hn ? null : <s0n/>` in 0.18, `_t ? <lA/> : null` in 0.66),
  // so clicking it would be a no-op. Both entries therefore route through `openMarketplace`, which
  // opens the 0.66 marketplace.
  //
  // This used to fall back to dispatching upstream's `sand.openTools` chord (mod+shift+m) to reach
  // `Rme.open(Uf.plugins())`. That path is deliberately gone: it would open 0.18's own plugins
  // dialog — the same 市场/Yours-tabbed ancestor of this surface — instead of the 0.66 one the pill
  // now shows, so the rail row and the pill would land on different dialogs.
  const body = code.match(/function openPluginsFromRail\([\s\S]*?\n\}/);
  assert.ok(body != null, "openPluginsFromRail is missing");
  assert.match(body[0], /openMarketplace\(\)/, "the rail row must open the marketplace directly");
  assert.ok(
    !body[0].includes("dispatchOpenPluginsCommand"),
    "the rail row must not dispatch the upstream chord any more",
  );
  assert.ok(
    !code.includes("dispatchOpenPluginsCommand()};"),
    "nothing may still route the chord as a marketplace entry point",
  );
  const open = code.match(/function openMarketplace\([\s\S]*?\n\}/);
  assert.ok(open != null, "openMarketplace is missing");
  assert.match(open[0], /marketplaceController\.open\(\)/);
});

test("the marketplace controller is created once, at module scope", () => {
  // The capture-phase interceptor closes over it. Building it per click would drop the dialog the
  // moment a second click arrived mid-open.
  assert.match(code, /const marketplaceController = createMarketplaceController\(\);/);
});

test("the observer can see a rail transition", () => {
  // Collapsing flips one attribute on the shell and touches no child list, so a childList-only
  // observer never fires and the row would appear only after an unrelated re-render.
  const install = code.match(/function install\([\s\S]*?\n\}\n/);
  assert.ok(install != null, "install is missing");
  assert.match(install[0], /record\.type === "attributes"/, "attribute records must be handled");
  assert.match(
    install[0],
    /record\.attributeName === "data-sidebar-collapsed"/,
    "the handler must be filtered to the attribute the layout code writes",
  );
  assert.match(install[0], /attributeFilter: \["data-sidebar-collapsed"\]/, "the observer must be scoped to that attribute");
  // The row lives outside the plugins entry, so the entry-based trigger can never see it.
  assert.match(
    install[0],
    /node\.matches\(SIDEBAR_SELECTOR\) \|\| node\.matches\(RAIL_NEW_SELECTOR\) \|\| node\.matches\(RAIL_FOOTER_SELECTOR\)/,
    "the row's own mount points must trigger a sync",
  );
});

test("the rail row is created once and re-found by its marker class", () => {
  // Same failure as the label/logos pair earlier in this file: a node created without the marker
  // class cannot be found on the next pass, so each pass builds another one and they pile up.
  // The subtle version of this bug: the marker lives on the BUTTON while the lookup asked the
  // WRAPPER for it, so every collapse added another 34px row to the sidebar.
  const build = code.match(/function buildRailButton\([\s\S]*?\n\}\n/);
  assert.ok(build != null, "buildRailButton is missing");
  assert.match(build[0], /button\.classList\.add\(RAIL_BUTTON_CLASS\)/, "the button must carry the marker class at creation");

  const ensure = code.match(/function ensureRailButton\([\s\S]*?\n\}\n/);
  assert.ok(ensure != null, "ensureRailButton is missing");
  assert.match(
    ensure[0],
    /querySelector<HTMLButtonElement>\(`:scope > div > button\.\$\{RAIL_BUTTON_CLASS\}`\)/,
    "the row must be found via the button's marker class, not via the wrapper that never carries it",
  );
  assert.match(ensure[0], /applyClasses\(wrapper, RAIL_WRAPPER_CLASSES\)/, "the official wrapper classes must be applied");
  assert.match(ensure[0], /applyClasses\(existing, RAIL_BUTTON_CLASSES\)/, "the official button classes must be re-asserted on re-entry");
  assert.ok(
    !/querySelector<HTMLElement>\(`:scope > \.\$\{RAIL_BUTTON_CLASS\}`\)/.test(code),
    "the wrapper is never given the marker class, so querying it for one always reports 'not mounted' and duplicates the row",
  );

  // Cleanup must be idempotent: a stale duplicate can only exist if a past pass mis-looked-up.
  assert.match(code, /function removeRailRows\(/, "row removal must be factored out so it can clear every copy");
  assert.match(
    code.match(/function removeRailRows\([\s\S]*?\n\}\n/)[0],
    /querySelectorAll\(`:scope > div > button\.\$\{RAIL_BUTTON_CLASS\}`\)/,
    "removal must target the same lookup as ensure, over all matches",
  );
});

test("the account text slot is hidden without taking the avatar with it in rail state", () => {
  // `:last-child` is right while the sidebar is expanded (avatar span, then name/email span) and
  // catastrophic in rail state: upstream renders only ONE span there, so it is both the first and
  // the last child and the account avatar disappears — the whole footer row came out blank. This
  // was visible in the rail screenshot against the official build, and no other check caught it:
  // typecheck, the tests and the packaging were all green.
  assert.ok(
    !/ACCOUNT_BUTTON_SELECTOR\} > span:last-child/.test(code),
    "the account text span must not be selected with :last-child; in rail state that is the avatar itself",
  );
  assert.match(
    code,
    /ACCOUNT_BUTTON_SELECTOR\} > span:not\(:first-child\)\{display:none !important;\}/,
    "the name/email slot must be hidden via :not(:first-child) so the avatar survives both states",
  );
  // The avatar is the first child, so it must still be sized in both states.
  assert.match(
    code,
    /ACCOUNT_BUTTON_SELECTOR\} > span:first-child,\$\{ACCOUNT_AVATAR_SELECTOR\}\{width:36px !important;height:36px !important;\}/,
    "the avatar must still be forced to the official 36px",
  );
  assert.match(
    source,
    /simultaneously the first and the last child/,
    "the reason this selector is wrong in rail state must stay documented next to it",
  );
});

// ---------------------------------------------------------------------------
// Sign-out row in the account menu.
//
// This build is login-free. `source/electron-preload/preload.ts` hard-codes
// `account.getStatus()` to `{ kind: "logged-in" }`, and upstream renders the row on exactly that
// value (`const P = authStatus === "logged-in"; … P ? <MenuItem …>Log out</MenuItem> : null`).
// Leaving it visible is worse than cosmetic: `logout()` resolves to `{ kind: "logged-out" }` and
// `login()` on this build also resolves to `{ kind: "logged-out" }`, so pressing it strands the app
// in a state it cannot leave.
// ---------------------------------------------------------------------------

test("the sign-out row is hidden, and hidden by icon rather than by label", () => {
  assert.match(
    code,
    /`\.\$\{LOGOUT_MARKER_CLASS\}\{display:none !important;\}`/,
    "the sign-out row must be removed with display:none so it leaves the menu's keyboard order too",
  );
  assert.match(
    code,
    /const LOGOUT_ICON_NAME = "arrow-bracket-from-left"/,
    "the row must be selected by its icon name, which is the only discriminator that is not localized",
  );
  assert.match(
    code,
    /const LOGOUT_ROW_SELECTOR = `\[role="menuitem"\] i\[data-icon-name="\$\{LOGOUT_ICON_NAME\}"\]`/,
    "the selector must key off data-icon-name, not the visible text",
  );
  assert.ok(
    !/退出登录/.test(code),
    "the selector must not depend on the Chinese label; it changes with the locale",
  );
  assert.match(
    source,
    /share one class list and one set of data attributes/,
    "why the icon (and not the class list or the text) is the anchor must stay documented",
  );
});

test("the sign-out row is reached even though the menu lives in a portal", () => {
  // The account menu is a floating layer rendered into a document-root portal, so no sidebar-scoped
  // selector can see it. A sweep wired only to the plugins entry would never run.
  const install = code.match(/function install\([\s\S]*?\n\}\n/);
  assert.ok(install != null, "install is missing");
  assert.match(
    install[0],
    /node\.matches\(LOGOUT_ROW_SELECTOR\) \|\| node\.querySelector\(LOGOUT_ROW_SELECTOR\) != null/,
    "the observer must treat the sign-out row as its own trigger",
  );
  // The sweep has to be idempotent: the menu is re-created on every open.
  const hide = code.match(/function hideSignOutRow\([\s\S]*?\n\}\n/);
  assert.ok(hide != null, "hideSignOutRow is missing");
  assert.match(hide[0], /classList\.contains\(LOGOUT_MARKER_CLASS\)\)\s*continue;/, "the sweep must skip rows it has already marked");
  assert.match(hide[0], /row\.classList\.add\(LOGOUT_MARKER_CLASS\)/, "the row must be marked so the sweep is idempotent");
  assert.match(
    hide[0],
    /icon\.closest<HTMLElement>\('\[role="menuitem"\]'\)/,
    "the icon must be walked up to its own row, not to any menu",
  );
});

test("hiding the sign-out row does not make the observer re-enter itself", () => {
  // The sweep writes a class, and the observer also watches attributes. Only the collapsed-sidebar
  // attribute is in the filter, so a class write cannot re-trigger the callback — but if the filter
  // were ever widened to include `class`, this would become an infinite loop.
  const install = code.match(/function install\([\s\S]*?\n\}\n/);
  assert.match(
    install[0],
    /attributeFilter: \["data-sidebar-collapsed"\]/,
    "the attribute filter must stay narrow; adding `class` would let the sweep re-trigger itself",
  );
});

test("the divider above the sign-out row goes with it", () => {
  // The row sits alone in a `ui-menu__section`, and that section paints its divider on a
  // `::before` (`border-top: 0.5px solid rgba(20,20,20,.15)`). Hiding only the row leaves an empty
  // section with a dangling hairline under the last real item — visible in the screenshot and not
  // catchable by any structural check that only looks for the row.
  const hide = code.match(/function hideSignOutRow\([\s\S]*?\n\}\n/);
  assert.ok(hide != null, "hideSignOutRow is missing");
  assert.match(
    hide[0],
    /document\.querySelectorAll<HTMLElement>\("\.ui-menu__section"\)/,
    "the containing section must be swept too, not only the row",
  );
  assert.match(
    hide[0],
    /getComputedStyle\(item\)\.display !== "none"/,
    "the section must only be dropped when EVERY one of its items is hidden",
  );
  assert.match(
    hide[0],
    /section\.classList\.add\(LOGOUT_MARKER_CLASS\)/,
    "the section must be marked with the same class so the existing display:none rule covers it",
  );
  assert.match(
    source,
    /ui-menu__section/,
    "the section structure must stay named in the source as the reason the divider survives",
  );
});

test("the pill shares one baseline with the avatar and the prompt form", () => {
  // The report was "连接应用 没有和头像图标和输入框 底部对齐，明显比图形图标和输入框更往下".
  // Measured in a 1024px viewport against the running official 0.66 build:
  //   account avatar  bottom = 1008   (footer padding-bottom: 16px)
  //   prompt form     bottom = 1008   (chat input dock padding-bottom: 16px)
  //   our pill        bottom = 1012   (absolute, bottom: 12px against the 1024px aside)
  // so the pill sat exactly 4px low — a difference small enough to pass every structural check and
  // obvious the moment the three edges are put side by side. The aside is the containing block
  // (`position: relative`, full viewport height), so the pill's `bottom` IS its distance from the
  // window's bottom edge and has to be the same 16px the two upstream rows resolve to.
  assert.match(
    code,
    /`\$\{ENTRY_SELECTOR\}\{position:absolute !important;left:60px !important;right:16px !important;bottom:16px !important;/,
    "the pill must be docked 16px from the bottom edge, the same offset as the avatar and the prompt form",
  );
  assert.ok(
    !/bottom:12px !important;/.test(code),
    "bottom:12px lands the pill 4px below the avatar and the input box (the reported misalignment)",
  );
  // The offset is only meaningful while the aside is the full-height positioning context.
  assert.match(
    code,
    /\.sand-agents-sidebar\{position:relative !important;\}/,
    "the sidebar must stay the pill's containing block, or the bottom offset would measure from somewhere else",
  );
  assert.match(
    source,
    /avatar\.bottom === form\.bottom === 1008/,
    "the measurement must stay documented so the 16px is not mistaken for an arbitrary value",
  );
});
