import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { applyPair, DISPLAY_PROPS } from "../scripts/lib/i18n-patch-engine.mjs";
import {
  SELECTION_CHIP_CLASS_NAMES,
  SELECTION_TOOLBAR_CLASS_NAMES,
  assertSelectionClassesResolve,
  assertSelectionLabelsReachable,
  patchOriginalSelectionAddToPrompt,
} from "../scripts/lib/selection-add-to-prompt-renderer-patch.mjs";
import { MAIN_I18N_PAIRS } from "../scripts/lib/main-i18n-patch.mjs";

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

// The authoritative answer to "can code spliced in at module level reach this symbol?".
// A textual scan is not enough: `rn`, the icon component this patch first used, IS
// assigned somewhere in the chunk — but only inside another function's body, so the
// spliced code threw `rn is not defined` at render time while every textual check,
// typecheck, `npm test` and `node --check` stayed green. Parse instead: only bindings on
// Program.body (and import specifiers) are visible from a module-level splice.
function moduleLevelBindings(source) {
  const names = new Set();
  const addPattern = (node) => {
    if (node == null) return;
    switch (node.type) {
      case "Identifier": names.add(node.name); return;
      case "ObjectPattern":
        for (const prop of node.properties) addPattern(prop.type === "RestElement" ? prop.argument : prop.value);
        return;
      case "ArrayPattern": for (const el of node.elements) addPattern(el); return;
      case "AssignmentPattern": addPattern(node.left); return;
      case "RestElement": addPattern(node.argument); return;
      default: return;
    }
  };
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
      if (node.id != null) names.add(node.id.name);
    } else if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) addPattern(decl.id);
    } else if (node.type === "ImportDeclaration") {
      for (const spec of node.specifiers) names.add(spec.local.name);
    }
  }
  return names;
}

let topLevel = null;

const patched = bundle == null ? null : patchOriginalSelectionAddToPrompt(bundle);
// The two slices below are derived from `patched`, which is null whenever the pinned bundle is
// absent (CI never runs `npm run bootstrap`). Slicing null throws at module load and takes the
// whole file down — which is how this guard read as "done": `bundleSkip` was in place, but the
// derivation below it was not. Every test that consumes these is already skipped by `bundleSkip`,
// so an empty string is the correct derived value when there is no bundle to slice.
const sliceBetween = (from, to) => (patched == null ? "" : patched.slice(patched.indexOf(from), patched.indexOf(to)));
// Everything the patch injects as components: the toolbar and the button it renders.
const toolbar = sliceBetween("function RSelToolbar(", "function e9n({fieldClassName:n,");
// The chip view on its own. 0.18's own code renders `chat-bubbles` elsewhere, so icon
// assertions must be scoped to what this patch injects rather than the whole chunk.
const chipView = sliceBetween("function RSelChip(", "const RSelQuoteNode=");

test("selection patch applies once to the pinned 0.18 chunk and stays parseable", { skip: bundleSkip }, () => {
  assert.doesNotThrow(() => parse(patched, { ecmaVersion: "latest", sourceType: "module" }));
  assert.equal(patched.split("function RSelToolbar(").length - 1, 1);
  // Every identifier the injected components reach for must be a MODULE-LEVEL binding in
  // this chunk. `rn` looked like the icon component (it is used as one) but is only bound
  // inside another component's scope, so referencing it produced a ReferenceError at
  // render time — typecheck, `npm test` and `node --check` were all green. `bt` is the
  // module-level icon component that renders the `ui-icon` glyph 0.62's chip also uses.
  topLevel ??= moduleLevelBindings(patched);
  for (const id of ["p", "S", "bt"]) {
    assert.ok(topLevel.has(id), id + " must be bound at module level for the injected components to reach it");
  }
  assert.match(chipView, /children:p\.jsx\(bt,\{name:"chat-bubble-ellipsis",size:"sm"\}\)/);
  assert.doesNotMatch(chipView, /p\.jsx\(rn,/);
  // Kl is Node.create in this chunk; la is Extension.create and cannot make a node.
  // Building the quote node with the wrong one would register an extension and the
  // composer would silently keep rejecting the inserted content.
  assert.ok(isDefined(patched, "Kl"), "Kl (Node.create) must be in scope for the quote node");
  assert.match(patched, /RSelQuoteNode=Kl\.create\(\{name:"quoteReference"/);
  assert.doesNotMatch(patched, /RSelQuoteNode=la\.create/);
  assert.throws(() => patchOriginalSelectionAddToPrompt(patched), /missing or ambiguous/);
});

test("the toolbar never shadows the chunk's React namespace", { skip: bundleSkip }, () => {
  // A local binding named `p` inside any injected component would shadow the module-level
  // React import and turn every p.jsx call in it into a runtime TypeError that only the
  // mounted view would ever hit. Same trap applies to `S` (React hooks).
  for (const scope of toolbar.split("\nfunction ").slice(1).join("\nfunction ").match(/function RSel[\s\S]*?(?=\nconst |\nfunction e9n)/g) ?? [toolbar]) {
    assert.doesNotMatch(scope, /[,{;(]\s*(?:const|let|var)\s+p\s*=/, "an injected component must not declare a local `p`");
    assert.doesNotMatch(scope, /[,{;(]\s*(?:const|let|var)\s+S\s*=/, "an injected component must not declare a local `S`");
  }
  assert.match(toolbar, /p\.jsx\("div"/);
  assert.match(toolbar, /p\.jsx\("button"/);
});

test("every identifier the injected code reaches for is bound at module level", { skip: bundleSkip }, () => {
  // The `rn` incident cost a full package+deploy+manual round trip: it is used as an
  // icon component in this chunk but is only bound inside another component's scope, so
  // the chip threw ReferenceError at render time while typecheck, `npm test` and
  // `node --check` all stayed green. Rather than keep hand-listing the symbols, read the
  // injected block, collect every bare identifier it uses, and require each one to be a
  // module-level binding. Any future rename then fails here instead of on screen.
  const start = patched.indexOf("const R_SEL_MAX");
  const injected = patched.slice(start, patched.indexOf("function e9n({fieldClassName:n,"));
  assert.ok(start > 0 && injected.length > 0, "could not isolate the injected block");
  // Strip line comments first: prose like "…flashes the toolbar." would otherwise read
  // as a reference to a chunk symbol.
  const code = injected.replace(/\/\/[^\n]*/g, "");
  const ignored = new Set([
    "if", "for", "while", "switch", "return", "typeof", "function", "new", "await", "of", "in", "void", "do", "else", "true", "false", "null", "undefined",
    "Math", "JSON", "String", "Number", "Boolean", "Array", "Object", "document", "window", "getSelection", "setTimeout", "var", "const", "let",
    // Tiptap node-spec method names: object keys, not chunk symbols.
    "addAttributes", "parseHTML", "renderHTML", "renderText", "addNodeView", "addOptions", "addCommands", "create",
  ]);
  const refs = new Set();
  for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*[.(]/g)) {
    if (ignored.has(m[1])) continue;
    refs.add(m[1]);
  }
  // Bindings the injected block introduces itself — parameters, destructured locals and
  // its own top-level helpers, at any scope. Parse the block on its own so a rename
  // cannot hide a real miss.
  const inner = new Set();
  const addPattern = (node) => {
    if (node == null) return;
    switch (node.type) {
      case "Identifier": inner.add(node.name); return;
      case "ObjectPattern":
        for (const prop of node.properties) addPattern(prop.type === "RestElement" ? prop.argument : prop.value);
        return;
      case "ArrayPattern": for (const el of node.elements) addPattern(el); return;
      case "AssignmentPattern": addPattern(node.left); return;
      case "RestElement": addPattern(node.argument); return;
      default: return;
    }
  };
  (function walk(node) {
    if (node == null || typeof node !== "object") return;
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
      if (node.id != null) inner.add(node.id.name);
    }
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) {
      for (const param of node.params) addPattern(param);
    }
    if (node.type === "VariableDeclarator") addPattern(node.id);
    if (node.type === "CatchClause") addPattern(node.param);
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value != null && typeof value.type === "string") walk(value);
    }
  })(parse(code, { ecmaVersion: "latest", sourceType: "module" }));

  const external = [...refs].filter((r) => !inner.has(r));
  assert.ok(external.length >= 4, "expected several chunk symbols, found " + external.join(","));
  topLevel ??= moduleLevelBindings(patched);
  for (const ref of external) {
    assert.ok(topLevel.has(ref), ref + " is used by the injected code but is not a module-level binding in this chunk");
  }
  // Symbols handed to jsx as a value (bt) never appear as `X(` or `X.`, so the sweep
  // above cannot see them; check the ones that matter explicitly instead of letting the
  // set pass vacuously.
  for (const sym of ["p", "bt", "Kl", "VCe", "S"]) {
    assert.ok(code.includes(sym), sym + " should be used by the injected code");
    assert.ok(topLevel.has(sym), sym + " must be a module-level binding in this chunk");
  }
  // Mutation check on the guard itself: the symbol this patch originally used is assigned
  // somewhere in the chunk yet is NOT reachable from a module-level splice. If the parse
  // ever regressed to the textual check, this would pass and the guard would be worthless.
  assert.ok(isDefined(patched, "rn"), "precondition: rn is assigned somewhere in the chunk");
  assert.ok(!topLevel.has("rn"), "rn must not be module-level, or the guard proves nothing");
  assert.ok(inner.has("RSelToolbar") && inner.has("RSelQuoteNode") && inner.has("RSelChip"),
    "the injected block should define the toolbar, the node and its view itself");
});

test("the toolbar waits for the selection to settle instead of tracking the drag", { skip: bundleSkip }, () => {
  // 0.62's O6e: pointerdown hides and remembers the pre-press range; selectionchange
  // only publishes while nothing is pressed; pointerup publishes only when the range
  // actually moved. This is what stops the toolbar flashing mid-drag.
  assert.match(toolbar, /document\.addEventListener\("pointerdown",onDown,!0\)/);
  assert.match(toolbar, /document\.addEventListener\("pointerup",onUp,!0\)/);
  assert.match(toolbar, /document\.addEventListener\("pointercancel",onCancel,!0\)/);
  assert.match(toolbar, /st\.press==null&&show\(snap\(\)\)/, "selectionchange must be gated on no active press");
  assert.match(toolbar, /const onUp=e=>\{const k=st\.press;if\(k==null\|\|k\.pointerId!==e\.pointerId\)return;st\.press=null;const b=snap\(\);if\(b!=null&&RSelSame\(k\.rangeBefore,b\.range\)\)\{st\.dismissed=b\.range;return\}o\(b\)\}/);
  assert.match(toolbar, /rangeBefore:s!=null&&s\.rangeCount>0\?s\.getRangeAt\(0\)\.cloneRange\(\):null/);
  // A click that does not move the caret must not flash the toolbar.
  assert.match(patched, /function RSelSame\(t,e\)\{if\(t==null\|\|e==null\)return!1;return t\.startContainer===e\.startContainer&&t\.startOffset===e\.startOffset&&t\.endContainer===e\.endContainer&&t\.endOffset===e\.endOffset\}/);
  // The effect must unsubscribe from all five listeners.
  for (const ev of ["pointerdown", "pointerup", "pointercancel", "selectionchange", "blur"]) {
    assert.ok(toolbar.includes(`removeEventListener("${ev}"`), "must unsubscribe " + ev);
  }
  // Mutation check: dropping the press gate is exactly the mid-drag regression, and the
  // assertion above has to notice.
  const ungated = toolbar.replace("st.press==null&&show(snap())", "show(snap())");
  assert.notEqual(ungated, toolbar, "mutation fixture failed to apply");
  assert.doesNotMatch(ungated, /st\.press==null&&show\(snap\(\)\)/);
});

test("a pointer press inside the toolbar does not dismiss it", { skip: bundleSkip }, () => {
  // 0.62 guards pointerdown with `$6e(y.target) || (...)`, where `$6e` is
  // `closest("[data-sand-selection-actions], [aria-modal=\"true\"]") != null`. Without it
  // the press on the button itself hides the toolbar in the capture phase, the button
  // unmounts before the click can land, and the control is inert — while a synthetic
  // `el.click()` still works, which is how an earlier build shipped broken and passed
  // every scripted test. Only a real pointer sequence catches this.
  assert.match(patched, /R_SEL_SELF='\[data-sand-selection-actions\], \[aria-modal="true"\]'/);
  assert.match(
    toolbar,
    /const onDown=e=>\{if\(e\.target instanceof Element&&e\.target\.closest\(R_SEL_SELF\)!=null\)return;/,
    "pointerdown must bail out when it lands inside the toolbar or a modal",
  );
  // The guard has to come before anything that hides the toolbar.
  const onDown = /const onDown=e=>\{([\s\S]*?)\};\n/.exec(toolbar);
  assert.ok(onDown != null, "onDown not found");
  assert.ok(onDown[1].indexOf("R_SEL_SELF") < onDown[1].indexOf("o(null)"), "the bail-out must precede the hide");
  // Regression guard: a variant that hides first would still parse and still pass any
  // assertion about the settle machine.
  const reordered = toolbar.replace(
    'if(e.target instanceof Element&&e.target.closest(R_SEL_SELF)!=null)return;\n',
    "",
  );
  assert.doesNotMatch(reordered, /closest\(R_SEL_SELF\)!=null\)return/);
});

test("the quoted text is inserted as a chip node, not as a markdown paragraph", { skip: bundleSkip }, async () => {
  assert.match(patched, /insertQuote:q=>\{const Z=_m\(f\.current\);return Z==null\?!1:Z\.chain\(\)\.focus\(\)\.insertContent\(\[\{type:"quoteReference",attrs:\{quote:q\}\},\{type:"text",text:" "\}\]\)\.run\(\)\}/);
  // The trailing text node is load-bearing, not decoration. quoteReference is an inline
  // atom: with nothing after it the caret has no position to land in, so the FIRST quote
  // sticks and every later one fails silently — "the selection never updates, the same
  // text keeps coming back". Regression guard for exactly that.
  assert.match(patched, /attrs:\{quote:q\}\},\{type:"text",text:" "\}\]\)/);
  assert.doesNotMatch(patched, /attrs:\{quote:q\}\}\]\)\.run\(\)/);
  // Registered on the composer surface only, alongside 0.18's other custom nodes.
  assert.match(patched, /n\.surface==="prompt"&&t\.push\(RSelQuoteNode\),t\}/);
  // The node is inline + atom and keeps the quoted text in an attribute, so the label
  // can be re-rendered (and read back) without re-parsing the document text.
  assert.match(patched, /RSelQuoteNode=Kl\.create\(\{name:"quoteReference",group:"inline",inline:!0,atom:!0,selectable:!0,addAttributes\(\)\{return\{quote:\{default:""\}\}\}/);
  // 0.62's own label wraps the text in double quotes (measured off the live app), and
  // keeps it in the title attribute for the tooltip.
  assert.match(patched, /title:q,style:R_SEL_CHIP_STYLE/);
  assert.match(patched, /children:q===""\?"":'"'\+q\+'"'/);
  assert.match(patched, /renderText\(\{node:t\}\)\{return'"'\+\(t\.attrs\.quote\?\?""\)\+'"'\}/);
  // The node view mirrors 0.62's measured markup: chip > icon wrapper > icon, plus a
  // text span. The icon is aria-hidden, exactly as in 0.62. The root must be this chunk's
  // NodeViewWrapper (`Tge`) — the editor throws "Please use the NodeViewWrapper component
  // for your node view" when the rendered root lacks `data-node-view-wrapper`, and Tge
  // also supplies the `node-quoteReference` class and the `as` tag the way 0.62 does.
  assert.match(patched, /return p\.jsx\(Tge,\{as:"span",className:R_SEL_CHIP_CLASS,"data-type":"quote-reference"/);
  assert.match(patched, /className:R_SEL_CHIP_CLASS,"data-type":"quote-reference",title:q,style:R_SEL_CHIP_STYLE/);
  assert.match(patched, /p\.jsx\("span",\{"aria-hidden":!0,className:R_SEL_CHIP_ICON_CLASS,children:p\.jsx\(bt,\{name:"chat-bubble-ellipsis",size:"sm"\}\)/);
  // 0.18 ships that exact icon name (same glyph), so this is a match, not an
  // approximation. A previous revision used `chat-bubbles` after reading the chip's
  // `cursor-ico` class as the icon name — that class names the `cursor-icons` FONT
  // FAMILY, not the glyph. Resolving an icon means reading `data-icon-name`.
  assert.doesNotMatch(chipView, /p\.jsx\(bt,\{name:"chat-bubbles"/);
  const s = await readFile(path.join(assetsRoot, "index-UbX-y3il.js"), "utf8");
  assert.match(s, /"chat-bubble-ellipsis":"[^"]+"/, "0.18 must ship the icon the official chip uses");
  assert.doesNotMatch(patched, /p\.jsxs\("span",\{className:R_SEL_CHIP_CLASS/);
  for (const sym of ["Tge"]) {
    assert.ok(topLevel.has(sym), sym + " (NodeViewWrapper) must be a module-level binding in this chunk");
  }
  // Regression guard: the superseded markdown-paragraph insert must never come back.
  assert.doesNotMatch(patched, /text:"> "\+q/);
});

test("the toolbar button reproduces 0.62's typography and hover", { skip: bundleSkip }, async () => {
  // 0.62's button class list was read off the live app, not inferred: beyond F6e.button it
  // carries four more classes from the imported `gt.body2` + `Cn.medium` recipes, which
  // never appear as literals in the bundle. Without them the label renders at the wrong
  // size/weight.
  for (const cls of ["ui-11wthnw", "ui-d4r4e8", "ui-12oo3zp", "sand-1rhlpx6"]) {
    assert.ok(patched.includes(cls), "toolbar button must carry " + cls);
  }
  // Hover, measured on 0.62.0: resting rgba(0,0,0,0) -> hovered rgba(119,119,119,0.173),
  // which is --sand-fill-secondary, and nothing else in the computed style changes.
  // 0.62 does it with sand-tfy4bk, and 0.18 declares that class identically — so the
  // hover stays pure CSS. A previous revision dropped it after a stylesheet probe wrongly
  // reported it missing; this assertion is the regression guard for that probe's blind
  // spot (stylex emits `.cls:hover:not(#\#)…{…}`, so a pattern expecting `{` right after
  // the class name finds nothing).
  assert.ok(patched.includes("sand-tfy4bk"), "the button must carry 0.62's hover class");
  const sheets = await readPinnedStylesheets();
  assert.match(
    sheets,
    /\.sand-tfy4bk:hover:not\(#\\?#\)[^{]*\{background-color:var\(--sand-fill-secondary\)\}/,
    "0.18 must declare the hover class with 0.62's exact declaration",
  );
  // And it must actually reach the button, not just exist in the stylesheet.
  const classConst = /const R_SEL_BUTTON_CLASS="([^"]*)"/.exec(patched);
  assert.ok(classConst != null, "button class constant not found");
  assert.ok(classConst[1].split(/\s+/).includes("sand-tfy4bk"), "the hover class is not on the button");
  // No state-driven stand-in: the hover is CSS, exactly as upstream.
  assert.doesNotMatch(toolbar, /onMouseEnter|onMouseLeave|backgroundColor:a\?/);
});

test("the chip reuses only classes the pinned 0.18 stylesheet actually defines", { skip: bundleSkip }, async () => {
  const sheets = await readPinnedStylesheets();
  const total = [...SELECTION_CHIP_CLASS_NAMES, ...SELECTION_TOOLBAR_CLASS_NAMES];
  assert.equal(assertSelectionClassesResolve(sheets), total.length);
  // ui-g2ss61 is 0.18's spelling of 0.62's sand-g2ss61 (height:1lh): the class-name hash
  // comes from the declaration, so the prefix is the only thing that moved between
  // versions. Assert both halves so the substitution is never silently reversed.
  assert.match(sheets, /\.ui-g2ss61(?![-\w])[^{]*\{height:1lh\}/);
  for (const cls of ["sand-1jnr06f", "sand-aalx5g", "sand-lup9mm", "sand-16dsc37"]) {
    assert.match(sheets, new RegExp(`\\.${cls}(?![-\\w])`), cls + " must exist in the pinned stylesheet");
  }
  // Classes 0.18 genuinely lacks are inlined instead of guessed at.
  assert.match(patched, /R_SEL_CHIP_STYLE=\{"paddingInline":"3px","marginInline":"-3px"\}/);
  assert.throws(() => assertSelectionClassesResolve(sheets, ["sand-3y1lgt"]), /missing from the pinned renderer stylesheet/);
});

test("mod+l is split off the focus action and bound to the new behaviour", { skip: bundleSkip }, () => {
  assert.doesNotMatch(patched, /hotkey:"mod\+i, mod\+l"/);
  assert.match(patched, /\{id:"sand\.focusInput",label:"Focus prompt",hotkey:"mod\+i",run:_\.focusPrompt\}/);
  assert.match(patched, /\{id:"sand\.addSelectionToPrompt",label:"Add selection to prompt",hotkey:"mod\+l",run:_\.addSelectionToPrompt\}/);
  assert.match(patched, /_\.focusPrompt,_\.addSelectionToPrompt,B\.actions/);
  assert.match(patched, /RSelAddToPrompt=S\.useCallback\(\(\)=>\{const q=RSelQuoteText\(\);q==null\|\|X\.current\?\.insertQuote\?\.\(q\)===!0\|\|le\(\)\},\[le\]\)/);
  assert.match(patched, /addSelectionToPrompt:RSelAddToPrompt/);
  assert.match(patched, /p\.jsx\(RSelToolbar,\{isMacPlatform:hs,onAddToPrompt:pn\.addSelectionToPrompt\}\)/);
  const reverted = patched.replace(
    '{id:"sand.focusInput",label:"Focus prompt",hotkey:"mod+i",run:_.focusPrompt},{id:"sand.addSelectionToPrompt",label:"Add selection to prompt",hotkey:"mod+l",run:_.addSelectionToPrompt}',
    '{id:"sand.focusInput",label:"Focus prompt",hotkey:"mod+i, mod+l",run:_.focusPrompt}',
  );
  assert.notEqual(reverted, patched, "mutation fixture failed to apply");
  assert.doesNotMatch(reverted, /id:"sand\.addSelectionToPrompt"/);
});

test("the injected selection reader mirrors 0.62's validity and normalisation rules", { skip: bundleSkip }, () => {
  // Validity lives in RSelRange (shared by the toolbar's geometry and the quote text);
  // normalisation lives in RSelQuoteText, mirroring 0.62's pd()/Z5e() split.
  const range = patched.slice(patched.indexOf("function RSelRange("), patched.indexOf("function RSelSame("));
  const read = patched.slice(patched.indexOf("function RSelQuoteText("), patched.indexOf("function RSelChip("));
  assert.match(patched, /R_SEL_INTERACTIVE="button, input, textarea, select, \[contenteditable='true'\], \[contenteditable='plaintext-only'\]"/);
  assert.match(range, /e\.closest\(R_SEL_INTERACTIVE\)!=null\|\|n\.closest\(R_SEL_INTERACTIVE\)!=null\)return null/);
  assert.match(range, /rangeCount===0\|\|t\.isCollapsed\)return null/);
  assert.match(range, /i\.width===0&&i\.height===0\)return null/, "a zero-area range has nothing to anchor the toolbar to");
  assert.match(range, /getRangeAt\(0\)\.cloneRange\(\)/, "the snapshot keeps its own range copy for the dismiss comparison");
  assert.match(read, /t\.range\.toString\(\)\.replace\(\/\\r\\n\?\/gu," "\)\.trim\(\)/);
  assert.match(patched, /R_SEL_MAX=2e4,R_SEL_TRUNC="\[quote truncated\]"/);
  assert.match(read, /i\.length<=R_SEL_MAX\?i:i\.slice\(0,R_SEL_MAX\)\+" "\+R_SEL_TRUNC/);
});

test("the three toolbar labels are localisable and their pairs land", { skip: bundleSkip }, () => {
  for (const label of ["Add to prompt", "Selection actions", "Add selection to prompt"]) {
    const pair = MAIN_I18N_PAIRS.find((row) => row[0] === label);
    assert.ok(pair, "missing i18n pair for " + label);
    assert.equal(pair[3], "PANEL");
    const result = applyPair(patched, label, pair[1], pair[3]);
    assert.ok(result.hits > 0, "pair for " + label + " matched nothing in the patched chunk");
    assert.equal(result.hits, 1, "pair for " + label + " matched " + result.hits + " sites; it must be exactly one");
    assert.ok(result.patched.includes(pair[1]), "pair for " + label + " did not inject its translation");
  }
  assert.ok(DISPLAY_PROPS.includes("aria-label"));
  assert.equal(assertSelectionLabelsReachable(), 2);
  assert.throws(() => assertSelectionLabelsReachable('"data-x":"Selection actions","children":"Add to prompt"'), /localizable Selection actions label/);
  assert.throws(() => assertSelectionLabelsReachable('"aria-label":"Selection actions","data-x":"Add to prompt"'), /localizable Add to prompt label/);
});

test("clean-build runs the selection patch with the renderer extensions, ahead of i18n", async () => {
  const source = await readFile(path.join(import.meta.dirname, "../scripts/clean-build.mjs"), "utf8");
  const importIndex = source.indexOf('from "./lib/selection-add-to-prompt-renderer-patch.mjs"');
  assert.ok(importIndex > 0, "clean-build does not import the selection patch");
  const callIndex = source.indexOf("await applyOriginalRendererSelectionAddToPrompt({ stageRoot });");
  assert.ok(callIndex > 0, "clean-build never calls the selection patch");
  const i18nIndex = source.indexOf("await applyOriginalRendererMainI18n({ stageRoot });");
  assert.ok(callIndex < i18nIndex, "the selection patch must run before the i18n passes");
});
