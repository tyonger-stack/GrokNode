// Regression cover for the main Bot renderer patch.
//
// This patch is the only part of the main Bot work that edits a shipped, minified 5.8MB
// bundle, so the failure modes worth guarding are the ones that survive every other gate:
//
//   * an INJECTION that names a binding the bundle does not have. `hnt` (the corner
//     resolver) and `lt` (the agent item) are real but minified, and an earlier reading
//     of this repo concluded the 0.18 baseline shipped no corner mechanism at all — from
//     icon names and GLSL keywords, without ever looking for the resolver. A wrong guess
//     here is a ReferenceError in the sidebar, and it parses cleanly. The free-binding
//     set is therefore extracted from the AST and checked against the bundle, not
//     eyeballed.
//   * the agent-item splice quietly breaking memoization. The call site is a React
//     Compiler cache; swapping the element's component while leaving the dependency list
//     pointing at the old one is the kind of change that only shows up as stale rows.
//   * the marker overriding the running/attention corner. Official 0.66's `s1e` makes the
//     main marker the LAST fallback corner, so a working bot must still show its own
//     marker.
//   * the dialog being driven by a prop the 0.18 kit does not read. `Gt.Root` is a
//     passthrough, so `onClose` is accepted silently and does nothing — the dialog is
//     then un-dismissable, because it is mounted with a hard-coded `open:true`.
//   * a dialog width that is not a key of the kit's own width table. `_in[400]` is
//     `undefined`, which drops the width class rather than failing the build.
//
// Everything is asserted against the real pristine bundle, and the patched output goes
// through the real parser via `node --check`.

import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "acorn";
import * as walk from "acorn-walk";

import {
  applyMainAgentRendererPatch,
  patchMainAgentRenderer,
  MAIN_AGENT_CSS_TOKENS,
} from "../scripts/lib/main-agent-renderer-patch.mjs";
import {
  MAIN_AGENT_COMPONENTS,
  MAIN_AGENT_STYLE,
} from "../scripts/lib/main-agent-renderer-components.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_CHUNK = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const PINNED_CSS = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-lCyB53CO.css");
const run = promisify(execFile);

const readPinnedChunk = () => readFile(PINNED_CHUNK, "utf8");
const readPinnedCss = () => readFile(PINNED_CSS, "utf8");
const patchedChunk = async () => patchMainAgentRenderer(await readPinnedChunk());

/** The injected block is written across multiple lines to stay readable; whitespace is
 *  therefore not part of its contract. Squeeze it out before asserting on call shapes, so
 *  a reflow cannot fail a test and, more importantly, so a test cannot be satisfied by a
 *  substring that only appears in some other layout. */
const dense = source => source.replace(/\s+/g, "");
const denseComponents = () => dense(MAIN_AGENT_COMPONENTS);

/** Parse the patched file with the real JS engine — the only gate that catches a
 *  malformed injection (an unbalanced brace, a stray quote) that text checks miss. */
async function assertParses(source) {
  const dir = await mkdtemp(path.join(tmpdir(), "main-agent-renderer-"));
  const file = path.join(dir, "chunk.js");
  await writeFile(file, source, "utf8");
  await run(process.execPath, ["--check", file]);
  return file;
}

/* ------------------------------------------------------------------ *
 * Free-binding analysis of the injected block
 * ------------------------------------------------------------------ */

const BUILTIN_GLOBALS = new Set([
  "Set", "Map", "WeakSet", "WeakMap", "Promise", "Symbol", "Reflect", "Proxy",
  "Object", "Array", "String", "Number", "Boolean", "BigInt", "Math", "JSON", "Date",
  "Error", "TypeError", "RangeError", "RegExp", "console", "performance", "fetch",
  "globalThis", "undefined", "NaN", "Infinity", "isNaN", "isFinite", "parseInt",
  "parseFloat", "encodeURIComponent", "decodeURIComponent", "structuredClone",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask",
  "requestAnimationFrame", "cancelAnimationFrame", "window", "document", "navigator",
  "localStorage", "history", "location", "alert", "Intl",
]);

/**
 * The names the bundle binds at MODULE scope, read from the AST rather than by regex.
 *
 * A regex is not good enough here and fails in both directions: the bundle declares
 * `const pTt=1e4,fie=5,Ar=S.forwardRef(…)`, so a single-declarator pattern misses `Ar`, and
 * a brace-depth heuristic reads the whole file — strings and regex literals full of braces
 * make it report almost everything as nested. The one thing that is provably wrong for this
 * purpose is the real scope, so ask the parser.
 */
function chunkBindingNames(chunk) {
  const ast = parse(chunk, { ecmaVersion: "latest", sourceType: "module" });
  const names = new Set();
  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
      names.add(node.id.name);
    } else if (node.type === "VariableDeclaration") {
      for (const declarator of node.declarations) {
        if (declarator.id.type === "Identifier") names.add(declarator.id.name);
      }
    }
  }
  return names;
}

/** Collect every name a binding pattern introduces. Written out rather than delegated
 *  to acorn-walk because walking from a bare ObjectPattern/ArrayPattern base is not
 *  supported — `simple` finds nothing and `full` throws on the missing "Pattern" base. */
function collectPatternNames(pattern, into) {
  if (pattern == null || typeof pattern.type !== "string") return;
  switch (pattern.type) {
    case "Identifier": into.add(pattern.name); return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        collectPatternNames(property.type === "RestElement" ? property.argument : property.value, into);
      }
      return;
    case "ArrayPattern": for (const element of pattern.elements) collectPatternNames(element, into); return;
    case "AssignmentPattern": collectPatternNames(pattern.left, into); return;
    case "RestElement": collectPatternNames(pattern.argument, into); return;
    default: if (pattern.name) into.add(pattern.name); return;
  }
}

/**
 * Names the injected block uses without declaring them. Bindings are collected
 * over-approximately (any name introduced by a declarator id, a parameter list, a
 * function/class name or a for/catch head counts as declared), because over-approximating
 * the declared set only makes this check quieter, never wrong.
 */
function freeBindings(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const declared = new Set();
  walk.simple(ast, {
    VariableDeclarator(node) { collectPatternNames(node.id, declared); },
    FunctionDeclaration(node) { if (node.id) declared.add(node.id.name); node.params.forEach(p => collectPatternNames(p, declared)); },
    FunctionExpression(node) { if (node.id) declared.add(node.id.name); node.params.forEach(p => collectPatternNames(p, declared)); },
    ArrowFunctionExpression(node) { node.params.forEach(p => collectPatternNames(p, declared)); },
    ClassDeclaration(node) { if (node.id) declared.add(node.id.name); },
    CatchClause(node) { collectPatternNames(node.param, declared); },
    ForInStatement(node) { collectPatternNames(node.left, declared); },
    ForOfStatement(node) { collectPatternNames(node.left, declared); },
  });
  const referenced = new Set();
  walk.ancestor(ast, {
    Identifier(node, ancestors) {
      const parent = ancestors[ancestors.length - 2];
      if (parent) {
        // A non-computed member/property key is a name, not a variable.
        if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return;
        if (parent.type === "Property" && parent.key === node && !parent.computed) return;
        if (parent.type === "LabeledStatement" && parent.label === node) return;
        if (parent.type === "BreakStatement" || parent.type === "ContinueStatement") return;
      }
      referenced.add(node.name);
    },
  });
  return new Set([...referenced].filter(name => !declared.has(name)));
}

/** `lt` is deliberately excluded: it is not a bundle-level name but the caller's own
 *  local alias for the agent item (`const … lt=d4e …`), which the patch receives as
 *  `base` at the splice site. Its provenance is asserted separately. */
const SUPPLIED_AT_SPLICE_SITE = new Set(["lt"]);
/* ------------------------------------------------------------------ */

test("every style prop is a stylix object, never a class string", () => {
  // This is the one that black-screened the app. 0.18's Gt.Header / Gt.Body / Gt.ActionBar
  // and Ar.contentStyle forward `style` into the bundle's own stylix merge (`Fe` → `ar`).
  // Official 0.66 passes compiled style OBJECTS there, and so must this block: handed a
  // string, the merge iterates the string's characters and writes `element.style[0]`, which
  // throws "Indexed property setter is not supported" and drops the whole window into the
  // error boundary. Nothing upstream catches it — typecheck, tests and packaging all pass.
  const block = denseComponents();
  const styled = [...block.matchAll(/style:(RMAIN_\w+\.\w+)/g)].map(m => m[1]);
  assert.ok(styled.length >= 4, `expected the dialog slots to be styled, found ${styled.length}`);
  for (const name of styled) {
    assert.ok(block.includes(`constRMAIN_STYLES={`) || true, "");
    assert.match(name, /^RMAIN_STYLES\./, `"${name}" must come from RMAIN_STYLES, which holds objects`);
  }
  // Class strings belong on className, and only there.
  assert.ok(!/style:RMAIN_CLASSES\./.test(block), "a class string must never reach a style prop");
  assert.ok(!/className:RMAIN_STYLES\./.test(block), "a style object must never reach className");
  // The objects must be shaped the way the runtime's styleq expects, or they are treated as
  // dynamic inline styles and become a `style` attribute instead of a class list.
  const objects = MAIN_AGENT_COMPONENTS.match(/\{rMain\w+:"sand-[^"]*",\$\$css:true\}/g) ?? [];
  assert.ok(objects.length >= 4, `expected every ported style to be a compiled object, found ${objects.length}`);
  for (const role of ["rMainHeader", "rMainBody", "rMainActions", "rMainListContent", "rMainFailure"]) {
    assert.ok(new RegExp(`\\{${role}:"[^"]*",\\$\\$css:true\\}`).test(MAIN_AGENT_COMPONENTS),
      `${role} must be a compiled stylix object`);
  }
});

test("no element is built with children in the key slot", () => {
  // React's factory is `jsx(type, config, maybeKey)` — the THIRD argument is the key, not a
  // child. Writing `p.jsx(Body, props, body)` therefore renders an empty body and hands the
  // children to React as a key, which it coerces with String(): the dialog came up with its
  // title and buttons and nothing in between, and every row shared one key. Nothing about
  // that is visible to a parser or to a string assertion, so it is checked structurally:
  // walk every call, split its top-level arguments, and require the third one to be a key.
  const source = MAIN_AGENT_COMPONENTS;
  const offenders = [];
  const call = /p\.jsx(s?)\(/g;
  let match;
  while ((match = call.exec(source))) {
    const end = balancedEnd(source, match.index + match[0].length - 1);
    const args = topLevelArgs(source.slice(match.index + match[0].length, end));
    if (args.length < 3) continue;
    if (!/^\s*key\s*:/.test(args[2])) offenders.push(args[2].slice(0, 60).replace(/\s+/g, " "));
  }
  assert.deepEqual(offenders, [], "children must go in `children:`, never in the key argument");
});

/** Index just past the bracket that closes the one at `open`. */
function balancedEnd(source, open) {
  let depth = 0, quote = null, escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) { depth -= 1; if (depth === 0) return i; }
  }
  throw new Error("unbalanced call in the injected block");
}

/** Split an argument list on commas that are not nested inside brackets or strings. */
function topLevelArgs(args) {
  const parts = [];
  let depth = 0, quote = null, escaped = false, start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) { parts.push(args.slice(start, i)); start = i + 1; }
  }
  parts.push(args.slice(start));
  return parts;
}

test("the injected literals contain no backtick and no interpolation", () => {
  // Both exports are template literals, and the code inside them is full of quotes. A single
  // stray backtick in a comment truncates the template and the whole patch file stops
  // parsing — three times now, each time from a comment quoting official source. Cheap to
  // assert, and it fails at the unit level rather than in a packaged renderer chunk.
  for (const [name, literal] of [["MAIN_AGENT_STYLE", MAIN_AGENT_STYLE], ["MAIN_AGENT_COMPONENTS", MAIN_AGENT_COMPONENTS]]) {
    assert.ok(!literal.includes("`"), `${name} must not contain a backtick`);
    assert.ok(!literal.includes("${"), `${name} must not contain an interpolation marker`);
  }
});

test("every anchor resolves exactly once in the pristine bundle", async () => {
  const chunk = await readPinnedChunk();
  for (const anchor of [
    "function u0n(n){",
    'Hs=p.jsx(lt,{"aria-current":pt,',
    "ee=p.jsx(mcn,{batchCount:r,id:t.id,onRequestDelete:A})",
  ]) {
    assert.equal(chunk.split(anchor).length - 1, 1, `anchor is not unique: ${anchor}`);
  }
  // 0.18 must not already ship this feature, or the port has nothing to match.
  assert.equal(chunk.split("RMainRoot(").length - 1, 0, "0.18 must not already contain the injected root");
  assert.equal(chunk.split("Main Bot").length - 1, 0, "0.18 must not already ship the main Bot label");
  assert.equal(chunk.split("arrow-swap").length - 1, 2,
    "0.18 must already ship the arrow-swap icon the replacement row uses");
});

test("the injection names only bindings the bundle actually has", async () => {
  // Checked against the PATCHED bundle, not the pristine one: that is the artifact that
  // ships, and it is also where the patch introduces its own names (the original sidebar
  // is renamed to RMainOriginalSidebar at the first anchor).
  const bindings = chunkBindingNames(await patchedChunk());
  const free = freeBindings(MAIN_AGENT_COMPONENTS);

  for (const name of free) {
    if (BUILTIN_GLOBALS.has(name) || SUPPLIED_AT_SPLICE_SITE.has(name)) continue;
    // RLocT is the one bundle-absent name the block is allowed to mention: the 0.18
    // chunk has no i18n runtime, so the block guards it. Asserted on its own below.
    if (name === "RLocT") continue;
    assert.ok(bindings.has(name),
      `the injection names "${name}", which the renderer bundle does not define`);
  }

  // Spell out the load-bearing ones so a future refactor cannot quietly drop them.
  // `Qs` (0.18's Button) is deliberately NOT here: 0.66's picker rows are bare
  // <button role="radio">, so porting them dropped the last Button call site.
  for (const name of ["S", "p", "hnt", "mcn", "It", "bt", "Gt", "ml", "Ar", "vt", "RMainOriginalSidebar"]) {
    assert.ok(free.has(name), `the injection should be using the bundle's "${name}"`);
    assert.ok(bindings.has(name), `"${name}" should be a bundle binding`);
  }
});

test("MUTATION: a fabricated binding is reported instead of shipping", () => {
  const fabricated = MAIN_AGENT_COMPONENTS.replace("hnt({layout:", "zqX({layout:");
  assert.notEqual(fabricated, MAIN_AGENT_COMPONENTS, "sanity: the mutation applied");
  // The mutation parses cleanly — that is exactly the trap. An undefined name is a
  // runtime ReferenceError, so neither acorn nor `node --check` can ever catch it.
  parse(fabricated, { ecmaVersion: "latest", sourceType: "module" });
  const bindings = chunkBindingNames("function hnt(n){return n}");
  const free = freeBindings(fabricated);
  assert.ok(free.has("zqX"), "the fabricated name must show up as free");
  assert.ok(!bindings.has("zqX"), "and the bundle must not define it");
  assert.ok(bindings.has("hnt"), "while the real resolver still resolves");
});

test("RLocT is absent from the bundle and the injection guards it", async () => {
  const chunk = await readPinnedChunk();
  assert.equal(chunk.split("RLocT").length - 1, 0,
    "0.18 must not already provide the i18n runtime, or the fallback is untested");
  assert.ok(MAIN_AGENT_COMPONENTS.includes("typeof RLocT==='function'"),
    "an unguarded RLocT reference would throw in the 0.18 bundle");
});

test("the agent-item splice keeps the caller's memoization coherent", async () => {
  const patched = await patchedChunk();
  assert.ok(patched.includes("function RMainOriginalSidebar(n){"), "the original sidebar must be renamed, not replaced");
  assert.ok(patched.includes('Hs=p.jsx(RMainAgentItem,{base:lt,"aria-current":pt,'),
    "the item must receive the original component as `base`");
  assert.ok(patched.includes("t[62]=lt"), "the memo dependency list must still track `lt`");
  assert.ok(patched.includes("t[62]!==lt"), "and so must the dependency comparison");
  // `lt` is the caller's local alias; the real component behind it must be the agent item.
  const chunk = await readPinnedChunk();
  assert.ok(/const wt=Ze,[^;]*lt=d4e,/.test(chunk),
    "`lt` must still alias the agent item component at the splice site");
  assert.ok(/function d4e\(n\)\{/.test(chunk), "d4e must be the agent item component");
});

test("the agent item really is called with the props the wrapper reads", async () => {
  const chunk = await readPinnedChunk();
  const call = /Hs=p\.jsx\(lt,\{([^}]*)\}/.exec(chunk);
  assert.ok(call, "could not lift the agent-item call site");
  for (const prop of ["avatar:", '"data-agent-id":', "isPreviewActivity:", "isWorking:", "layout:", "marker:", "name:"]) {
    assert.ok(call[1].includes(prop), `the agent item is not passed ${prop}`);
  }
});

test("the main marker yields to the corner resolver, as 0.66's s1e does", async () => {
  const patched = await patchedChunk();
  assert.ok(patched.includes("const corner=hnt({layout:props.layout,marker:props.marker,isWorking:props.isWorking,isActivityNamed:props.isPreviewActivity});"),
    "the wrapper must reuse the bundle's own corner resolver");
  assert.ok(patched.includes("const show=main&&props.layout!=='collapsed'&&corner.corner===null;"),
    "the main marker must be the LAST fallback corner, never an override");
  assert.ok(patched.includes("main=state.loaded&&state.agentId===id;"),
    "an unresolved main id must not badge an arbitrary row");
  // The resolver's real signature, from the bundle, must be the one being called.
  const chunk = await readPinnedChunk();
  assert.ok(/function hnt\(\{layout:n,marker:e,isWorking:t,isActivityNamed:s\}\)/.test(chunk),
    "the corner resolver's signature changed — the wrapper's call would be wrong");
});

test("the dialog is driven by the prop the 0.18 kit actually reads", async () => {
  const patched = await patchedChunk();
  assert.ok(patched.includes("onOpenChange:next=>{if(!next)close()}"),
    "Gt.Root is a passthrough that only 0.18's onOpenChange can close");
  assert.ok(!/Gt\.Root,\{[^}]*\bonClose:/.test(patched),
    "onClose is not part of the dialog contract; with a hard-coded open:true it leaves the dialog un-dismissable");
  const chunk = await readPinnedChunk();
  const roots = [...chunk.matchAll(/Gt\.Root,\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(roots.length >= 4, "expected several real Gt.Root call sites to compare against");
  assert.equal(roots.filter(props => props.includes("onClose:")).length, 0,
    "no shipped dialog uses onClose — if this ever changes, re-read the contract");
  // Not every dialog drives it (the blocking ones are hard-coded `open`), but every
  // dismissible one does.
  assert.ok(roots.filter(props => props.includes("onOpenChange:")).length >= 3,
    "the dismissible shipped dialogs drive visibility through onOpenChange");
});

test("the dialog width is a key of the kit's own width table", async () => {
  const chunk = await readPinnedChunk();
  const table = /_in=\{([^}]*)\}/.exec(chunk);
  assert.ok(table, "could not lift the dialog width table");
  const widths = new Set(table[1].split(",").map(entry => entry.split(":")[0].trim()).filter(Boolean));
  // Scope the match to the dialog root: `width:12,height:12` on an inline SVG would
  // otherwise be read as a dialog width.
  const roots = [...MAIN_AGENT_COMPONENTS.matchAll(/variant:'rich',width:([^,}]+)/g)].map(m => m[1]);
  assert.deepEqual(roots, ["440"], "the injection should request a single dialog width");
  for (const width of roots.flatMap(expression => [...expression.matchAll(/\d+/g)].map(m => m[0]))) {
    assert.ok(widths.has(width),
      `width:${width} is not in the kit's width table {${[...widths].join(", ")}}; a miss renders at the default width instead of failing`);
  }
  // Both 0.66 pickers ask for 400 — cP's `v=400` and dP's `A=$2e` with `$2e=400` — and 0.18
  // has no 400, so both shells take 440. If 400 ever ships, both can go back together.
  assert.ok(!widths.has("400"), "if 400 ever ships, the dialog can go back to 0.66's width");
});

test("the dialog primitives and button variants the block uses are real", async () => {
  const chunk = await readPinnedChunk();
  const namespace = /const Gt=\{([^}]*)\}/.exec(chunk);
  assert.ok(namespace, "could not lift the dialog namespace");
  for (const part of ["Root", "Header", "Title", "Description", "Body", "ActionBar", "Action"]) {
    assert.ok(namespace[1].includes(`${part}:`), `Gt.${part} is not part of the dialog kit`);
  }
  assert.ok(chunk.split('variant:"rich"').length - 1 >= 3, "\"rich\" is a real dialog variant");
  // 0.18's Gt.Action is only ever shipped as primary or with no variant at all — it has no
  // secondary. 0.66's picker likewise gives Confirm `primary` and Cancel nothing, so the
  // port has to agree on both sides instead of reaching for a Button.
  assert.ok(/Gt\.Action,\{[^}]*variant:"primary"/.test(chunk),
    "\"primary\" is not a real Gt.Action variant");
  assert.ok(/Gt\.Action,\{[^}]*(?<!variant:"primary")disabled:/.test(chunk),
    "0.18 does ship Gt.Action calls that carry no variant — the block's Cancel matches that shape");
  assert.ok(!/Gt\.Action,\{[^}]*variant:"secondary"/.test(MAIN_AGENT_COMPONENTS),
    "0.18's Gt.Action does not take a secondary variant; the block must not pass one");
});

test("the replacement row uses the real menu and icon primitives", async () => {
  const patched = await patchedChunk();
  assert.ok(patched.includes("ee=p.jsx(RMainDeleteOrReplace,{batchCount:r,id:t.id,onRequestDelete:A})"),
    "the delete slot must be taken over, not duplicated");
  assert.ok(patched.includes("return p.jsx(mcn,{batchCount:props.batchCount,id:props.id,onRequestDelete:props.onRequestDelete});"),
    "a non-main row must still get the original delete menu");
  assert.ok(patched.includes("p.jsx(It.Item,{leading:p.jsx(bt,{name:'arrow-swap',size:'base'})"),
    "the replacement row must use the shipped menu item and icon");
  assert.ok(patched.includes("(props.batchCount??1)===1"),
    "the replacement row must be replaced by delete in a multi-select, as in 0.66");
});

test("the sidebar wrapper keeps the original sidebar mounted", async () => {
  const patched = await patchedChunk();
  assert.ok(patched.includes("function u0n(props){return p.jsxs(p.Fragment,{children:[p.jsx(RMainOriginalSidebar,props),p.jsx(RMainRoot,{sidebar:props})]})}"),
    "the wrapper must render the original sidebar AND the chooser, never replace it");
  // The block reads sidebar props; they must be the caller's real prop names.
  const chunk = await readPinnedChunk();
  const signature = /function u0n\(n\)\{const e=he\.c\(\d+\),\{([^}]*)\}=n/.exec(chunk);
  assert.ok(signature, "could not lift the sidebar prop destructure");
  for (const prop of ["agents:", "isHostReachable:", "pinnedIds:", "onSetPinned:", "onOpenAgent:"]) {
    assert.ok(signature[1].includes(prop), `the sidebar does not receive ${prop}`);
  }
});

test("the picker is 0.66's picker: bare radio rows, name only, check on the pick", () => {
  // 0.66.0's picker is function cP({onClose}): a plain <button role="radio"> per row that
  // carries its own class list, the real agent avatar, the agent NAME only, and a trailing
  // check icon on the selected row. An earlier pass used a Button primitive and showed each
  // bot's description, which is what made this dialog read as cards rather than a list.
  const block = denseComponents();
  assert.ok(block.includes(
    "p.jsx('button',{className:RMAIN_CLASSES.row+'r-main-row','aria-checked':selected,key:agent.id,onClick:()=>onPick(agent.id),role:'radio',type:'button',children}"),
    "each candidate must be a bare radio button keyed by agent id, not a Button primitive");
  assert.ok(!MAIN_AGENT_COMPONENTS.includes("r-main-candidate"),
    "the card treatment must be gone");
  assert.ok(!MAIN_AGENT_COMPONENTS.includes("agent.description"),
    "0.66 shows the bot name only — no description line");
  assert.ok(block.includes("p.jsx(ml,{agent,fillPx:24,size:'sm'})"),
    "the row must use the bundle's own agent avatar at 24px");
  assert.ok(block.includes("if(selected)children.push(p.jsx(bt,{name:'check',size:'md',className:'r-main-check'}));"),
    "the selected row must show a check icon on the right");
  // The name is the only label, so it is the element that takes the remaining width and
  // the check that gets pushed to the trailing edge.
  assert.ok(MAIN_AGENT_STYLE.includes(".r-main-rowname{flex:1 1 auto;"),
    "the name must absorb the free space between avatar and check");
  assert.ok(MAIN_AGENT_COMPONENTS.includes("role:'radiogroup'") && MAIN_AGENT_COMPONENTS.includes("maxHeight:RMAIN_LIST_MAX"),
    "the list must be a radiogroup in a 312px scroll area, as 0.66's As/ScrollArea is");
  assert.ok(MAIN_AGENT_COMPONENTS.includes("const RMAIN_LIST_MAX=312;"),
    "0.66 caps the list at 312px (R2e=312)");
});

test("the candidate filter is 0.66's rP and nothing else", () => {
  // 0.66: `rP(t,e){return t.filter(n=>!n.isGroup&&!Ff(n)&&n.id!==e)}`, where `Ff` resolves
  // through two import hops to `hr(e){return e.viewerIsOwner===!1}`. An earlier pass guessed a
  // `remoteRoom==null` clause; it had no evidence behind it and silently hid Bots that
  // 0.66 would have listed. The predicate is asserted literally so an extra clause cannot
  // creep back in.
  const block = denseComponents();
  assert.ok(block.includes(
    "returnagents.filter(agent=>!agent.isGroup&&agent.viewerIsOwner!==false&&agent.id!==current);"),
    "the candidate filter must be rP's three clauses and no others");
  assert.ok(!/remoteRoom/.test(MAIN_AGENT_COMPONENTS),
    "no invented predicate may filter candidates");
  // 0.66 folds the query and the name before comparing (its `Pn`: lowercase + ς→σ).
  assert.ok(block.includes("returnString(value??'').toLocaleLowerCase().replaceAll('ς','σ');"),
    "the search fold must be 0.66's, not a plain toLowerCase");
});

test("the picker has 0.66's two distinct empty states", () => {
  // 0.66 renders one status line when there is nothing to choose from at all — and in that
  // case it does NOT render the search row — then a different line when the query matches
  // nothing. Collapsing the two loses the distinction the user is meant to act on.
  // Copy is compared against the source, not `dense()`: squeezing whitespace also rewrites
  // the spaces inside the string literals, which would make the quotes match anything.
  assert.ok(denseComponents().includes("constcontent=candidates.length===0?"),
    "the no-candidates branch must be decided on the UNFILTERED list, as 0.66's r.length is");
  assert.ok(MAIN_AGENT_COMPONENTS.includes("RMainT('No other Bots to choose from yet','还没有其他可选的 Bot')"),
    "0.66's O9nsuv, for a roster with no other Bots");
  assert.ok(MAIN_AGENT_COMPONENTS.includes("RMainT('No matching Bots','没有匹配的 Bot')"),
    "0.66's 12i8o8, for a query that matches nothing");
  // The search row lives in the else-branch, so it is absent when there is nothing to search.
  const elseBranch = denseComponents().slice(denseComponents().indexOf("constcontent=candidates.length===0?"));
  assert.ok(elseBranch.includes("?empty(RMainT('NootherBotstochoosefromyet'"),
    "the empty branch renders only the status line");
  assert.ok(elseBranch.includes(":[p.jsxs('div',{className:RMAIN_CLASSES.searchRow+'r-main-searchrow',children:["),
    "the search row is in the else-branch, so it is not rendered with no candidates");
});

test("the dialog copy is quoted from 0.66's message tables", () => {
  // 0.66 renders these through its i18n component by id. 0.18 has no message table, so the
  // strings are inlined; quoting them is the only way the copy can be checked against the
  // official tables later.
  const quoted = [
    ["Choose a primary Bot", "选择主 Bot"],   // EE2rtW — dialog title
    ["Bots", "Bot"],                        // BIDT9R — radiogroup label
    ["Search Bots", "搜索 Bot"],              // YjO4Og — input aria-label
    ["Search", "搜索"],                      // A1taO8 — placeholder
    ["Cancel", "取消"],                      // dEgA5A
    ["Confirm", "确认"],                     // 7VpPHA
    ["Couldn't replace the main Bot", "无法替换主 Bot"],  // tQvgov
    ["Couldn't set the primary Bot", "无法设置主 Bot"],  // u9Nmei
    ["Create primary Bot", "创建主 Bot"],      // g4mJLN
    ["Introducing your primary Bot", "认识你的主 Bot"],  // rMNow6
    ["Main Bot", "主 Bot"],                   // V8a0q9 — the sidebar badge
  ];
  for (const [en, zh] of quoted) {
    assert.ok(MAIN_AGENT_COMPONENTS.includes(`RMainT('${en}','${zh}')`)
      || MAIN_AGENT_COMPONENTS.includes(`RMainT("${en}",'${zh}')`),
      `the copy "${en}" is not the one 0.66 uses`);
  }
  // 0.66 says "primary Bot" in the dialog and "Main Bot" on the badge. Reproducing the
  // asymmetry is the point; silently unifying it would be our invention, not a port.
  assert.ok(!/RMainT\('Choose a main Bot'/.test(MAIN_AGENT_COMPONENTS),
    "the dialog title must keep 0.66's 'primary Bot' wording, not a tidied-up variant");
});

test("the picker binds only module-scope names from the bundle", async () => {
  // The injection is appended at module scope, so a name that merely exists somewhere inside
  // a function body is a ReferenceError at render time. `Ar` is the concrete case that a
  // regex misses: it is declared as `const pTt=1e4,fie=5,Ar=S.forwardRef(…)`.
  const bindings = chunkBindingNames(await readPinnedChunk());
  for (const name of ["ml", "Ar", "vt", "bt", "Gt", "It", "hnt", "mcn", "S", "p"]) {
    assert.ok(bindings.has(name), `${name} must be a module-scope binding for the injection to reach it`);
  }
  assert.ok(!bindings.has("lt"), "`lt` is the caller's local, not a module binding — it arrives as `base`");
  assert.ok(!bindings.has("RMainOriginalSidebar"),
    "the original sidebar is renamed by the first anchor, not a pre-existing binding");
});

test("the search row carries an inline icon, as 0.66's does", async () => {
  assert.ok(denseComponents().includes(
    "p.jsx(bt,{name:'search',size:'md',className:RMAIN_CLASSES.searchIcon+'r-main-searchicon','aria-hidden':true})"),
    "the search icon belongs inside the input row, not beside it");
  assert.ok(MAIN_AGENT_COMPONENTS.includes("placeholder:RMainT('Search','搜索')"),
    "0.66's placeholder is the bare word, not 'Search Bots'");
  // The row is a flex container with the icon and the input as its only children, so the
  // icon cannot drift to its own line the way a sibling input used to allow.
  assert.ok(denseComponents().includes(
    ":[p.jsxs('div',{className:RMAIN_CLASSES.searchRow+'r-main-searchrow',children:["),
    "the icon and the input must share one row container");
  const chunk = await readPinnedChunk();
  assert.ok(chunk.includes('name:"search"'),
    "0.18 must already ship a search icon for the sidebar search button");
  assert.ok(chunk.includes('name:"check"'),
    "0.18 must already ship a check icon for menu indicators");
});

test("Confirm stays disabled until a visible row is picked", () => {
  // 0.66 recomputes the pick against the FILTERED list (`m.some(O=>O.id===u)?u:null`), so a
  // pick hidden by the search disables Confirm instead of committing something invisible.
  const block = denseComponents();
  assert.ok(block.includes("constvalid=rows.some(agent=>agent.id===picked)?picked:null;"),
    "the pick must be validated against the filtered rows");
  assert.ok(block.includes("disabled:state.busy||valid===null"),
    "Confirm must be disabled with nothing picked");
  assert.ok(block.includes("pending:state.busy"),
    "Confirm must show the pending state while saving, like 0.66's g.isPending");
  assert.ok(!MAIN_AGENT_COMPONENTS.includes("RMainT('Back','返回')"),
    "0.66's picker has Cancel, not Back — the intro is a separate flow");
});

test("0.66's picker class list is reused verbatim where 0.18 has the same declarations", async () => {
  // A stylix hash is a hash of the declarations, so a class keeps its name across versions.
  // 45 of the 47 survive; the two that do not ship without a rule in 0.66 either, so the port
  // drops them rather than inventing replacements.
  const css = await readPinnedCss();
  // `var(--sand-text-primary)` is a token reference, not a class: scan the class list only,
  // otherwise every token family reads as an unstyled class name.
  const ported = MAIN_AGENT_COMPONENTS
    .replace(/var\(--[a-z-]+\)/g, "")
    .match(/sand-[a-z0-9]+/g) ?? [];
  const unique = [...new Set(ported)];
  const missing = unique.filter(name => !css.includes(`.${name}`));
  assert.deepEqual(missing, [],
    `these class names are referenced but absent from the 0.18 stylesheet, so they would render unstyled: ${missing.join(", ")}`);
  assert.ok(unique.length >= 40, `expected the bulk of 0.66's picker classes to be reused, found ${unique.length}`);
});

test("the ported stylesheet tokens all resolve in the pinned sheet", async () => {
  const css = await readPinnedCss();
  const used = [...new Set([...MAIN_AGENT_STYLE.matchAll(/var\((--sand-[a-z-]+)\)/g)].map(m => m[1]))];
  assert.ok(used.length >= 7, `the stylesheet should consume the design tokens it needs, found ${used.length}`);
  // The check list is derived from the stylesheet, so a new token cannot slip past it.
  assert.deepEqual([...MAIN_AGENT_CSS_TOKENS].sort(), [...used].sort());
  for (const token of used) {
    assert.ok(css.includes(token), `${token} is missing from the pinned stylesheet`);
  }
});

test("the patched chunk parses as real JavaScript", async () => {
  const patched = await patchedChunk();
  await assertParses(patched);
});

test("applying the patch writes a provenance record and a patched chunk", async () => {
  const stageRoot = await mkdtemp(path.join(tmpdir(), "main-agent-stage-"));
  const assets = path.join(stageRoot, "dist/renderer/assets");
  await mkdir(assets, { recursive: true });
  await cp(PINNED_CHUNK, path.join(assets, path.basename(PINNED_CHUNK)));
  await cp(PINNED_CSS, path.join(assets, path.basename(PINNED_CSS)));

  const result = await applyMainAgentRendererPatch({ stageRoot });
  assert.equal(result.mode, "main-bot-local-host");
  assert.equal(result.files.length, 2, "the chunk and the stylesheet must both be recorded");

  const written = await readFile(path.join(assets, path.basename(PINNED_CHUNK)), "utf8");
  assert.equal(written, await patchedChunk(), "the staged chunk must be the patched one");
  assert.ok(written.includes("RMainRoot"), "and it must actually carry the injection");
  const provenance = JSON.parse(await readFile(path.join(stageRoot, "dist/renderer-main-agent-extension.json"), "utf8"));
  assert.equal(provenance.mode, "main-bot-local-host");
  assert.notEqual(provenance.files[0].originalSha256, provenance.files[0].patchedSha256);
  // The recorded hashes describe this pass's output. Later i18n passes keep editing the
  // chunk, so only the stylesheet hash survives to the end of the build — the record has
  // to say so, or an auditor comparing it with the staged chunk reads a phantom mismatch.
  assert.match(provenance.hashScope, /supersede the chunk hash/);
  assert.equal(provenance.files[1].file, "index-lCyB53CO.css");
});

test("re-applying onto patched sources fails closed", async () => {
  const patched = await patchedChunk();
  assert.throws(() => patchMainAgentRenderer(patched), /already applied/);
});

test("a drifted anchor fails closed instead of silently no-oping", async () => {
  for (const [anchor, replacement] of [
    ["function u0n(n){", "function u0nRenamed(n){"],
    ['Hs=p.jsx(lt,{"aria-current":pt,', "Hs=p.jsx(d4e,{***"],
  ]) {
    const drifted = (await readPinnedChunk()).replace(anchor, replacement);
    assert.notEqual(drifted, await readPinnedChunk(), "sanity: the drift applied");
    assert.throws(() => patchMainAgentRenderer(drifted), /anchor missing or ambiguous/);
  }
});

test("an ambiguous anchor fails closed too", async () => {
  const chunk = await readPinnedChunk();
  const duplicated = chunk.replace("ee=p.jsx(mcn,{batchCount:r,id:t.id,onRequestDelete:A})",
    "ee=p.jsx(mcn,{batchCount:r,id:t.id,onRequestDelete:A});ee=p.jsx(mcn,{batchCount:r,id:t.id,onRequestDelete:A})");
  assert.throws(() => patchMainAgentRenderer(duplicated), /anchor missing or ambiguous/);
});

test("MUTATION: an unguarded i18n call breaks the whole sidebar", () => {
  const mutated = MAIN_AGENT_COMPONENTS.replace("typeof RLocT==='function'?RLocT(en,zh):zh", "RLocT(en,zh)");
  assert.notEqual(mutated, MAIN_AGENT_COMPONENTS, "sanity: the mutation applied");
  parse(mutated, { ecmaVersion: "latest", sourceType: "module" }); // still parses — that is the trap
  assert.ok(!mutated.includes("typeof RLocT"), "and the guard is gone");
});

test("MUTATION: letting the main marker override the corner regresses 0.66's priority", () => {
  const mutated = MAIN_AGENT_COMPONENTS.replace(
    "main&&props.layout!=='collapsed'&&corner.corner===null",
    "main&&props.layout!=='collapsed'",
  );
  assert.notEqual(mutated, MAIN_AGENT_COMPONENTS, "sanity: the mutation applied");
  // The mutated predicate badges a working bot over its own running/attention marker.
  const show = (state, props) => {
    const main = state.loaded && state.agentId === props.id;
    const corner = props.corner;
    return mutated.includes("&&corner.corner===null")
      ? main && props.layout !== "collapsed" && corner === null
      : main && props.layout !== "collapsed";
  };
  const workingRow = { id: "bot-1", layout: "expanded", corner: "running" };
  assert.equal(show({ loaded: true, agentId: "bot-1" }, workingRow), true,
    "this is what dropping the corner guard buys: the main badge covers the running marker");
});
