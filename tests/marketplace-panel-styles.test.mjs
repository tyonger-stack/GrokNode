// Regression cover for the styling of the two panels this build mounts inside upstream 0.18's
// plugins view (the effective-plugins list and the custom-MCP form).
//
// They used to render raw HTML — browser-default headings, a bulleted `<ul>`, default `<input>`
// boxes and default `<button>`s — inside the otherwise native "连接应用" dialog (2026-10-26,
// user screenshot). The fix gives them upstream 0.18's OWN class recipes, so the guard here is
// the thing that keeps them from silently regressing:
//
//   * every class the recipes use must resolve to a rule in the shipped 0.18 stylesheet. A stylix
//     class name is the hash of its declarations, so a class that exists in one build and not in
//     another is a *no-op*: the element would fall back to the browser default and the panel would
//     be raw HTML again, with every other test still green.
//   * the components must actually apply the recipes (a recipe nothing uses is dead weight).
//   * the elements that used to be unstyled must carry a class.
//
// The stylesheet check needs the staged build; without it the check reports as skipped rather
// than passing silently.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const recipesSource = read("frontend", "src", "recovered", "features", "plugins", "overlay", "marketplace-recipes.ts");
const panelSource = read("frontend", "src", "recovered", "features", "plugins", "overlay", "effective-plugins-panel.tsx");
const formSource = read("frontend", "src", "extensions", "custom-mcp-form.tsx");
const hostSource = read("frontend", "src", "extensions", "custom-mcp-form-host.tsx");

/**
 * Semantic hooks that carry no rule of their own — upstream's own markup uses them the same way
 * (e.g. `sand-button` marks a button for the design system's own selectors).
 */
const SEMANTIC_HOOKS = new Set(["sand-button"]);

const STYLESHEET_DIR = path.join(repoRoot, ".build", "fidelity", "app", "dist", "renderer", "assets");
const stylesheetPath = existsSync(STYLESHEET_DIR)
  ? path.join(STYLESHEET_DIR, readdirSync(STYLESHEET_DIR).find((name) => /^index-.*\.css$/.test(name)) ?? "")
  : null;
const stylesheet = stylesheetPath != null && existsSync(stylesheetPath) ? readFileSync(stylesheetPath, "utf8") : null;

/** Every class token the recipe module hands to the DOM. */
function recipeClasses() {
  const classes = new Set();
  for (const match of recipesSource.matchAll(/"((?:sand|ui)-[a-z0-9]+(?: sand-[a-z0-9]+)*)"/g)) {
    for (const token of match[1].split(" ")) classes.add(token);
  }
  return classes;
}

test("every recipe class resolves to a rule in the shipped stylesheet", { skip: stylesheet == null ? "the staged stylesheet only exists after a build" : false }, () => {
  const missing = [];
  for (const name of recipeClasses()) {
    if (SEMANTIC_HOOKS.has(name)) continue;
    // stylix emits `.sand-xxx:not(#\#):not(#\#):not(#\#){…}` — match the class and its rule body.
    if (!new RegExp(`\\.${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^{]{0,80}\\{[^}]*\\}`).test(stylesheet)) {
      missing.push(name);
    }
  }
  assert.deepEqual(missing, [], "these recipe classes have no rule in the shipped stylesheet, so the panel would render unstyled");
});

test("the panels apply the recipes instead of raw markup", () => {
  // The panel's elements must carry a class; an unclassed element is browser-default HTML.
  for (const source of [panelSource, formSource, hostSource]) {
    assert.doesNotMatch(source, /<h2 className="sand-effective-plugins-title">/, "the panel must not render a bare heading");
    assert.doesNotMatch(source, /<button disabled=\{props\.disabled\} onClick=\{\(\) => setDraft/, "the form must not render a bare button");
  }
  assert.match(panelSource, /sand-effective-plugins-list \$\{GRID\}/, "the installed list must use the two-column grid recipe");
  assert.match(panelSource, /sand-effective-plugins-action \$\{BUTTON_SECONDARY\}/, "the uninstall action must use the button recipe");
  assert.match(formSource, /sand-custom-mcp-input \$\{error/, "the form inputs must use the upstream input recipe");
  assert.match(formSource, /sand-custom-mcp-form-actions \$\{SETUP_ACTIONS\}/, "the form actions must use the upstream action row");
  // The panel dropped its own heading: the dialog's own "已安装" section title sits right above it,
  // and a second one read as a duplicate.
  assert.doesNotMatch(panelSource, /sand-effective-plugins-title/, "the panel must not render its own title any more");
});

test("the recipes cite where they come from", () => {
  for (const marker of ["view-B5Ug8wEm.js", "captured live", "upstream 0.18"]) {
    assert.ok(recipesSource.includes(marker), `the recipe module must document ${marker}`);
  }
});
