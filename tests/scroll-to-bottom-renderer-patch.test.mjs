// Regression cover for the 0.71.2 "Scroll to bottom" button port.
//
// Text checks cannot catch the failures that matter here: an open predicate that
// fires while pinned, a button that never leaves the "exiting" state, a memo cache
// too small for the slots the patch adds, or an injected identifier that is not a
// module-level binding. Each of those is checked by parsing or evaluating the real
// patched bundle, and each checker is mutated to prove it can fail.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parse } from "acorn";

import {
  applyOriginalRendererScrollToBottom,
  assertScrollToBottomStylesResolve,
  patchOriginalScrollToBottom,
  SCROLL_TO_BOTTOM_LIFTED_CSS,
} from "../scripts/lib/scroll-to-bottom-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS = path.join(REPO_ROOT, "src/app/dist/renderer/assets");
const PINNED_CHUNK = path.join(ASSETS, "index-UbX-y3il.js");
const PINNED_CSS = path.join(ASSETS, "index-lCyB53CO.css");
const OFFICIAL_CSS = path.resolve(REPO_ROOT, "../rea-grokbot-0712/app/dist/renderer/assets/index-DkV65EBE.css");
const run = promisify(execFile);

// src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped.
const pinnedChunk = await readFile(PINNED_CHUNK, "utf8").catch(() => null);
const pinnedCss = await readFile(PINNED_CSS, "utf8").catch(() => null);
const bundleSkip = pinnedChunk == null || pinnedCss == null
  ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped."
  : false;
const officialCss = await readFile(OFFICIAL_CSS, "utf8").catch(() => null);
const patched = pinnedChunk == null ? null : patchOriginalScrollToBottom(pinnedChunk);

function moduleLevelBindings(source) {
  const names = new Set();
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id != null) names.add(node.id.name);
    else if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) if (decl.id.type === "Identifier") names.add(decl.id.name);
    } else if (node.type === "ImportDeclaration") {
      for (const spec of node.specifiers) names.add(spec.local.name);
    }
  }
  return names;
}

function functionBody(source, header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `${header} not found`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${header} does not brace-balance`);
}

/** Every `e[N]` the plane touches must fit the `he.c(N)` it allocates. */
function checkPlaneMemoCache(source) {
  const body = functionBody(source, "function WJn(n){");
  const size = Number(/const e=he\.c\((\d+)\)/.exec(body)[1]);
  const max = Math.max(...[...body.matchAll(/\be\[(\d+)\]/g)].map(m => Number(m[1])));
  assert.ok(max < size, `WJn uses e[${max}] but allocates he.c(${size})`);
  assert.match(body, /p\.jsxs\(p\.Fragment,\{children:\[\$e,tt,ct,lt,RSb\]\}\)/, "the button must render in the plane fragment");
  assert.match(body, /e\[146\]!==RSb/, "the fragment memo must depend on the button element");
}

/** The view must export the 0.71.2 distance, computed from the same geometry fields. */
function checkViewDistance(source) {
  const m = /isPinnedToBottom:H,distanceFromBottomPx:(Math\.max\(0,W-E\.geometry\.viewport\.scrollTopPx-E\.geometry\.viewport\.viewportHeightPx\)),/.exec(source);
  assert.ok(m, "the transcript view does not export distanceFromBottomPx");
  const distance = new Function("W", "E", `return ${m[1]}`);
  const geometry = (scrollTopPx, viewportHeightPx) => ({ geometry: { viewport: { scrollTopPx, viewportHeightPx } } });
  assert.equal(distance(2000, geometry(1000, 600)), 400);
  assert.equal(distance(2000, geometry(1500, 600)), 0, "overscroll clamps to 0 like 0.71.2");
}

function injectedHelpers(source) {
  const start = source.indexOf("const RScrollToBottomThresholdPx=");
  const end = source.indexOf(";(()=>{if(document.getElementById(\"sand-scroll-to-bottom-style\"))", start);
  assert.ok(start >= 0 && end > start, "helpers were not injected before the style block");
  return source.slice(start, end);
}

function evaluateHelpers(source, runtime) {
  return new Function(
    "S", "p", "fr", "Qae", "RLocT",
    `${injectedHelpers(source)}\nreturn { RScrollToBottomOpen, RScrollToBottomButton, RScrollToBottomStyles };`,
  )(runtime.S, runtime.p, runtime.fr, runtime.Qae, runtime.RLocT);
}

function checkOpenPredicate(source) {
  const { RScrollToBottomOpen: open } = evaluateHelpers(source, stubRuntime().runtime);
  const base = { isPinnedToBottom: false, distanceFromBottomPx: 81, isCovered: false, showsJumpToLatestPill: false };
  assert.equal(open(base), true);
  assert.equal(open({ ...base, distanceFromBottomPx: 80 }), false, "80px is still within 0.71.2's threshold");
  assert.equal(open({ ...base, isPinnedToBottom: true }), false);
  assert.equal(open({ ...base, isCovered: true }), false);
  assert.equal(open({ ...base, showsJumpToLatestPill: true }), false, "the jump-to-latest pill takes the slot");
  assert.equal(open({ ...base, distanceFromBottomPx: undefined }), false);
}

/** A one-component hook harness: re-renders while render-phase state updates are pending. */
function stubRuntime() {
  const state = [];
  let cursor = 0;
  let dirty = false;
  const S = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], value => { if (state[slot] !== value) { state[slot] = value; dirty = true; } }];
    },
  };
  const runtime = {
    S,
    p: { jsx: (type, props) => ({ type, props }) },
    fr: "fr",
    Qae: { pillBottom: px => ({ dock: px }) },
    RLocT: (en, zh) => `${en}|${zh}`,
  };
  const render = (Component, props) => {
    let out;
    for (let pass = 0; pass < 10; pass += 1) {
      cursor = 0;
      dirty = false;
      out = Component(props);
      if (!dirty) return out;
    }
    throw new Error("render did not settle");
  };
  return { runtime, render };
}

function checkButtonLifecycle(source) {
  const { runtime, render } = stubRuntime();
  const { RScrollToBottomButton: Button, RScrollToBottomStyles: styles } = evaluateHelpers(source, runtime);
  const onJump = () => {};
  assert.equal(render(Button, { open: false, dockInsetPx: 12, onJump }), null, "closed start renders nothing");
  const entered = render(Button, { open: true, dockInsetPx: 12, onJump });
  assert.equal(entered.type, "fr");
  assert.equal(entered.props["aria-label"], "Scroll to bottom|滚动到底部");
  assert.equal(entered.props.icon, "arrow-down");
  assert.equal(entered.props.iconSize, "xl");
  assert.equal(entered.props.shape, "circle");
  assert.equal(entered.props.onClick, onJump);
  assert.equal(entered.props["data-exiting"], undefined);
  assert.deepEqual(entered.props.style, [styles.button, { dock: 12 }, styles.enter]);
  const exiting = render(Button, { open: false, dockInsetPx: 12, onJump });
  assert.equal(exiting.props["data-exiting"], "");
  assert.equal(exiting.props.style[2], styles.exit);
  const child = {};
  exiting.props.onAnimationEnd({ target: child, currentTarget: {} });
  assert.notEqual(render(Button, { open: false, dockInsetPx: 12, onJump }), null, "a bubbled child animation must not unmount");
  const settled = render(Button, { open: false, dockInsetPx: 12, onJump });
  settled.props.onAnimationEnd({ target: child, currentTarget: child });
  assert.equal(render(Button, { open: false, dockInsetPx: 12, onJump }), null, "exit animation end unmounts");
}

test("patched chunk parses as a module and anchors fail closed on re-application", { skip: bundleSkip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "scroll-to-bottom-"));
  const file = path.join(dir, "chunk.js");
  await writeFile(file, patched, "utf8");
  await run(process.execPath, ["--check", file]);
  assert.throws(() => patchOriginalScrollToBottom(patched), /missing or ambiguous/);
});

test("the transcript view exports 0.71.2's distance-from-bottom", { skip: bundleSkip }, () => {
  checkViewDistance(patched);
});

test("the open predicate matches 0.71.2's dze", { skip: bundleSkip }, () => {
  checkOpenPredicate(patched);
});

test("the button walks hidden → entered → exiting → hidden like 0.71.2's CK", { skip: bundleSkip }, () => {
  checkButtonLifecycle(patched);
});

test("the plane allocates enough memo slots and renders the button", { skip: bundleSkip }, () => {
  checkPlaneMemoCache(patched);
  const body = functionBody(patched, "function WJn(n){");
  assert.match(body, /RSb=i!=null&&!RSbPill\?Wr\.createPortal\(p\.jsx\(RScrollToBottomButton,\{dockInsetPx:o===void 0\?0:o,onJump:t\.scrollToBottom,open:RSbOpen\}\),i\):null/);
  // The pill condition must be the exact one the plane already uses for the down pill.
  assert.ok(body.includes("lt=i!=null&&rt>0&&!ht.hasDismissed&&!J?"));
  assert.ok(body.includes("RSbPill=i!=null&&rt>0&&!ht.hasDismissed&&!J,"));
});

test("injected identifiers are module-level bindings", { skip: bundleSkip }, () => {
  const topLevel = moduleLevelBindings(patched);
  for (const id of ["S", "p", "fr", "Qae", "Wr", "RScrollToBottomOpen", "RScrollToBottomButton", "RScrollToBottomStyles"]) {
    assert.ok(topLevel.has(id), `${id} must be bound at module level`);
  }
});

test("styles: reused classes resolve, lifted rules are 0.71.2 bytes and absent from 0.18", { skip: bundleSkip }, () => {
  assert.deepEqual(assertScrollToBottomStylesResolve(pinnedCss), { reused: 16, lifted: 4 });
  assert.throws(() => assertScrollToBottomStylesResolve(`${pinnedCss}${SCROLL_TO_BOTTOM_LIFTED_CSS}`), /lifted rules already shipped/);
  assert.throws(() => assertScrollToBottomStylesResolve(pinnedCss.replaceAll(".sand-1nqzi6q", ".sand-gone")), /missing reused classes: sand-1nqzi6q/);
  if (officialCss != null) {
    for (const rule of SCROLL_TO_BOTTOM_LIFTED_CSS.split(/(?<=\})(?=[.@])/)) {
      assert.ok(officialCss.includes(rule), `lifted rule is not verbatim 0.71.2: ${rule}`);
    }
  }
});

test("mutations: each checker rejects a reverted or weakened patch", { skip: bundleSkip }, () => {
  const mutate = (from, to) => {
    assert.ok(patched.includes(from), `mutation anchor missing: ${from}`);
    return patched.replace(from, to);
  };
  assert.throws(() => checkViewDistance(mutate("isPinnedToBottom:H,distanceFromBottomPx:", "isPinnedToBottom:H,distanceFromBottomPxX:")));
  assert.throws(() => checkPlaneMemoCache(mutate("function WJn(n){const e=he.c(147),", "function WJn(n){const e=he.c(140),")));
  assert.throws(() => checkOpenPredicate(mutate("&&!n.showsJumpToLatestPill}", "}")));
  assert.throws(() => checkOpenPredicate(mutate("n.distanceFromBottomPx>RScrollToBottomThresholdPx", "n.distanceFromBottomPx>=RScrollToBottomThresholdPx")));
  assert.throws(() => checkButtonLifecycle(mutate('i==="entered"&&o("exiting")', 'i==="entered"&&o("hidden")')));
  assert.throws(() => checkButtonLifecycle(mutate("u&&d.target===d.currentTarget&&o(\"hidden\")", "u&&o(\"hidden\")")));
});

test("applyOriginalRendererScrollToBottom patches a staged copy and records provenance", { skip: bundleSkip }, async () => {
  const stageRoot = await mkdtemp(path.join(tmpdir(), "scroll-to-bottom-stage-"));
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(assets, "index-UbX-y3il.js"), pinnedChunk);
  await writeFile(path.join(assets, "index-lCyB53CO.css"), pinnedCss);
  const record = await applyOriginalRendererScrollToBottom({ stageRoot });
  assert.equal(await readFile(path.join(assets, "index-UbX-y3il.js"), "utf8"), patched);
  assert.equal(record.mode, "original-renderer-scroll-to-bottom");
  assert.deepEqual(record.chunks[0].memoCache, { component: "WJn", before: 140, after: 147 });
  const onDisk = JSON.parse(await readFile(record.provenancePath, "utf8"));
  assert.equal(onDisk.chunks[0].patched.sha256, record.chunks[0].patched.sha256);
  await assert.rejects(applyOriginalRendererScrollToBottom({ stageRoot }), /found 0/);
});
