import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { applyPair, DISPLAY_PROPS } from "../scripts/lib/i18n-patch-engine.mjs";
import {
  SIDEBAR_TOP_BAR_CLASS_NAMES,
  assertTopBarClassesResolve,
  patchOriginalSidebarTopBarSearch,
} from "../scripts/lib/sidebar-search-renderer-patch.mjs";

const assetsRoot = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
const bundle = await readFile(path.join(assetsRoot, "index-UbX-y3il.js"), "utf8").catch(() => null);
const bundleSkip = bundle == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;

async function readPinnedStylesheets() {
  let sheets = "";
  for (const name of await readdir(assetsRoot).catch(() => [])) {
    if (name.endsWith(".css")) sheets += await readFile(path.join(assetsRoot, name), "utf8");
  }
  return sheets;
}

function isDefined(source, id) {
  const escaped = id.replace(/[$]/g, "\\$");
  return new RegExp("(function " + escaped + "\\(|(?:const|let|var) " + escaped + "=|[,;{ ]" + escaped + "=(?!=))").test(source);
}

test("top-bar search patch applies once to the pinned 0.18 sidebar chunk and stays parseable", { skip: bundleSkip }, () => {
  const patched = patchOriginalSidebarTopBarSearch(bundle);
  assert.doesNotThrow(() => parse(patched, { ecmaVersion: "latest", sourceType: "module" }));
  assert.equal(patched.split("function RSidebarSearchButton(").length - 1, 1);
  for (const id of ["p", "yo", "fr"]) {
    assert.ok(isDefined(patched, id), id + " must be defined in the chunk the button is injected into");
  }
});

test("the search control leaves the sidebar column and lands immediately left of the new-chat button", { skip: bundleSkip }, () => {
  const patched = patchOriginalSidebarTopBarSearch(bundle);
  // The 0.18 bar (a0n) is no longer rendered anywhere in the sidebar column.
  assert.doesNotMatch(patched, /ki=Hn\?null:p\.jsx\(a0n,/);
  assert.match(patched, /ki=null/);
  // a0n itself is intentionally retained as dead code so this stays a relocation.
  assert.match(patched, /function a0n\(n\)\{/);
  // The header receives the opener and mounts the button directly before the "+".
  assert.match(patched, /onNewChat:h,onOpenSearch:Op}=n/);
  assert.match(patched, /onOpenSearch:V,/);
  const mount = patched.indexOf("p.jsx(RSidebarSearchButton,{onOpenSearch:Op})");
  const plus = patched.indexOf('className:"sand-agents-sidebar__new"');
  assert.ok(mount > 0 && plus > mount, "the search button must be mounted before the new-chat button");
  // Both buttons land in the same right-aligned header group, whose className definition
  // is hoisted above the render call (the call site only reads v.className).
  assert.match(patched, /v=\{className:"sand-78zum5 sand-gjt6br sand-6s0dn4 sand-167g77z sand-vc5jky"\}/);
  const group = patched.slice(patched.indexOf("sand-agents-sidebar__new-actions"), mount);
  assert.ok(group.includes("sand-agents-sidebar__new-actions"));
  assert.match(group, /m!=null&&f!=null\?/, "the broadcast/network pair still leads the group when available");
});

test("the relocated button and the plus share one 0.61.0 elevated-circle recipe", { skip: bundleSkip }, () => {
  const patched = patchOriginalSidebarTopBarSearch(bundle);
  for (const needle of [
    'icon:"search",iconSize:"xl"',
    'className:"sand-agents-sidebar__search"',
    'icon:"plus",iconSize:"xl"',
    'shape:"circle",style:[RSidebarElevated,RSidebarTopBarButton]',
  ]) {
    assert.ok(patched.includes(needle), "missing 0.61.0 top-bar button shape: " + needle);
  }
  // 0.61.0's variant:"elevated" has no 0.18 counterpart, so the recipe is injected as a
  // style object. `fr` merges `style` last, which is what makes it win over Mm.root.
  assert.match(patched, /const RSidebarElevated=\{[^}]*\$\$css:!0\}/);
  assert.match(patched, /const RSidebarTopBarButton=\{[^}]*\$\$css:!0\}/);
  // 0.61.0 drops size:"sm" on the plus in favour of the fixed 36x36 top-bar box.
  assert.doesNotMatch(patched, /icon:"plus",onClick:h,size:"sm",style:Ete\.newButton/);
});

test("every class the top-bar buttons rely on is defined by the pinned stylesheet", { skip: bundleSkip }, async () => {
  const sheets = await readPinnedStylesheets();
  assert.ok(sheets.length > 0, "the pinned renderer stylesheet is missing");
  assert.equal(assertTopBarClassesResolve(sheets), SIDEBAR_TOP_BAR_CLASS_NAMES.length);
  assert.throws(() => assertTopBarClassesResolve(sheets, ["sand-14qfxbe", "sand-not-in-the-pin"]), /missing from the pinned renderer stylesheet/);
});

test("the moved label is still reachable by main-i18n's Search pair", { skip: bundleSkip }, () => {
  const patched = patchOriginalSidebarTopBarSearch(bundle);
  // Both spellings i18n-patch-engine tries for each display prop must be present, or the
  // pair throws "i18n pair has no anchor" and the button falls back to English.
  for (const prop of ["aria-label", "content"]) {
    const reachable = DISPLAY_PROPS.some(name => patched.includes(`${prop}:"Search"`) || patched.includes(`"${prop}":"Search"`));
    assert.ok(reachable, `Search is no longer reachable as a ${prop} literal`);
  }
  const { patched: localized, hits } = applyPair(patched, "Search", "搜索", "PANEL");
  assert.ok(hits > 0);
  assert.match(localized, /content:\(RLocT\("Search","搜索"\)\)/);
  assert.match(localized, /"aria-label":\(RLocT\("Search","搜索"\)\)/);
});

test("top-bar search patch fails closed when an anchor is missing or already applied", { skip: bundleSkip }, () => {
  assert.throws(() => patchOriginalSidebarTopBarSearch("function a0n(n){}"), /anchor is missing or ambiguous/);
  assert.throws(() => patchOriginalSidebarTopBarSearch(patchOriginalSidebarTopBarSearch(bundle)), /anchor is missing or ambiguous/);
});

test("the patch module records where every substituted class came from", async () => {
  const source = await readFile(path.resolve(import.meta.dirname, "../scripts/lib/sidebar-search-renderer-patch.mjs"), "utf8");
  // These are 0.61.0 behaviour translated onto 0.18's older design system; each claim is
  // only auditable if the substitution stays written down next to the code.
  for (const claim of [
    "width 36px, height 36px",
    "does not exist in 0.18 (uin = ghost / primary / secondary)",
    'iconSize:"xl"',
    "gap 8px",
    "index-DIQ9cJ4R.js",
  ]) {
    assert.ok(source.includes(claim), "missing documented provenance: " + claim);
  }
});
