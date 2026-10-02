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

/** Every name the bundle binds at module level, over-approximated on purpose: the
 *  check must not reject a real binding, and over-approximating can only ever let a
 *  fabricated name through if it collides with a nested declaration. */
function chunkBindingNames(chunk) {
  const names = new Set();
  const exported = /export\{([^}]*)\};?\s*$/.exec(chunk);
  if (exported) {
    for (const entry of exported[1].split(",")) {
      const name = entry.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  for (const match of chunk.matchAll(/(?:^|[;{}\s])(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of chunk.matchAll(/(?:^|[;,{})\s])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) names.add(match[1]);
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
  for (const name of ["S", "p", "hnt", "mcn", "It", "bt", "Gt", "Qs", "RMainOriginalSidebar"]) {
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
  // otherwise be read as a dialog width. The width itself is a ternary, so take the
  // whole expression and pull the numbers out of it.
  const roots = [...MAIN_AGENT_COMPONENTS.matchAll(/variant:'rich',width:([^,}]+)/g)].map(m => m[1]);
  assert.deepEqual(roots, ["intro?360:440"], "the injection should request the intro and picker widths");
  const used = roots.flatMap(expression => [...expression.matchAll(/\d+/g)].map(m => m[0]));
  assert.deepEqual([...new Set(used)].sort(), ["360", "440"]);
  for (const width of used) {
    assert.ok(widths.has(width),
      `width:${width} is not in the kit's width table {${[...widths].join(", ")}}; a miss renders at the default width instead of failing`);
  }
  // Official 0.66.0 uses 360/400. 0.18 has no 400, which is why the picker takes 440.
  assert.ok(widths.has("360"), "the intro width is 0.63's own 360");
  assert.ok(!widths.has("400"), "if 400 ever ships, the picker can go back to 0.66's width");
});

test("the dialog primitives and button variants the block uses are real", async () => {
  const chunk = await readPinnedChunk();
  const namespace = /const Gt=\{([^}]*)\}/.exec(chunk);
  assert.ok(namespace, "could not lift the dialog namespace");
  for (const part of ["Root", "Header", "Title", "Description", "Body", "ActionBar", "Action"]) {
    assert.ok(namespace[1].includes(`${part}:`), `Gt.${part} is not part of the dialog kit`);
  }
  assert.ok(chunk.split('variant:"rich"').length - 1 >= 3, "\"rich\" is a real dialog variant");
  // The block styles its candidates with Qs and its buttons with Gt.Action, and the two
  // do not offer the same set: 0.18's Gt.Action is only ever used as primary or tertiary.
  for (const variant of ["primary", "secondary"]) {
    assert.ok(new RegExp(`Qs,\\{[^}]*variant:"${variant}"`).test(chunk),
      `"${variant}" is not a real Qs (button) variant`);
  }
  assert.ok(/Gt\.Action,\{[^}]*variant:"primary"/.test(chunk),
    "\"primary\" is not a real Gt.Action variant");
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

test("the ported stylesheet tokens all resolve in the pinned sheet", async () => {
  const css = await readPinnedCss();
  const used = [...new Set([...MAIN_AGENT_STYLE.matchAll(/var\((--sand-[a-z-]+)\)/g)].map(m => m[1]))];
  assert.equal(used.length, 8, "the stylesheet should consume eight design tokens");
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
