// Regression cover for the 0.62.0 info-pane split port.
//
// The failure mode this guards is a silent layout cap: the 480px ceiling is a number in a
// `Math.min`, so a build that keeps it still typechecks, still passes every chunk through
// `node --check`, still passes the audit — and simply renders a 480px computer column on a
// 3456px display. A string assertion on the edit would therefore only prove the patch
// rewrote the text it was written to rewrite. These tests instead extract the real drag
// helper out of the chunk, evaluate it with the real argument shape for a range of window
// widths, and compare the *width the pane would actually get*.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  applyOriginalRendererInfoPaneSplit,
  assertInfoPaneSplitShape,
  CLAMP_SITES,
  DRAG_HELPER_UPPER_BOUND,
  LAYOUT_018_DRAG_HELPER,
  LAYOUT_018_DRAG_HELPER_PATCHED,
  LAYOUT_CONSTANTS_AFTER,
  LAYOUT_CONSTANTS_BEFORE,
  OPEN_FIT_SITES,
  OPEN_PANE_CSS_CLAMP,
  PERSISTENCE_UPPER_BOUND,
  REFERENCE_062_DRAG_HELPER,
  REMOVED_INFO_PANE_MAX,
  patchOriginalInfoPaneSplit,
} from "../scripts/lib/info-pane-split-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_CHUNK = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");

const readPinnedChunk = () => readFile(PINNED_CHUNK, "utf8");

// src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped.
// 2026-10-05 补：本文件此前硬读该产物，而 CI 从不执行 `npm run bootstrap`（bootstrap 用的是
// macOS 专有的 hdiutil），于是 13 个依赖产物的文件里有 7 个在 CI 上 ENOENT —— main 的 CI
// 已因此连续红 10 次。写法照抄仓库另外 6 个已守卫的文件，不新造模式。守卫对象取「声明的用例名
// ∩ 实测失败名」，不是靠猜哪个用例读了产物。
const pinnedChunk = await readPinnedChunk().catch(() => null);
const pinnedSkip = pinnedChunk == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;

// 0.18's layout constants, spelled out here rather than read back out of the patch, so the
// tests assert against the audited values and not against whatever the patch happens to emit.
const INFO_PANE_MIN = 280;
const MIN_CHAT_COLUMN = 424;
const SIDEBAR_COLLAPSED = 88;
const SIDEBAR_EXPANDED = 280;
const COLLAPSE_THRESHOLD = 244;
const ZOOM_CORRECTION = 140;

/** The drag helper only, so an assertion cannot match a neighbour in the same chunk. */
function extractDragHelper(source) {
  const start = source.indexOf("function w3n(");
  assert.ok(start >= 0, "w3n (the info-pane drag helper) not found in the chunk");
  const next = source.indexOf("function ", start + 12);
  return source.slice(start, next < 0 ? undefined : next);
}

/**
 * Run the drag helper for real.
 *
 * The helper is lifted out of the chunk verbatim and called with the argument shape its own
 * caller uses (@2792294):
 *
 *     w3n({pointerWidth, zoomExcess: v3n(r), maxWidth: han({windowWidth, sidebar})})
 *
 * with `han` (@2232571) reimplemented from its own source as `windowWidth - 424 - sidebar`,
 * and `v3n` returning 0 for the un-zoomed case. So the number this returns is the width the
 * pane would really be given — the assertion is on behaviour, not on the text of the patch.
 */
function dragPaneWidth(source, { windowWidth, pointerWidth, sidebarWidth }) {
  const helper = extractDragHelper(source).trim();
  // `han` (@2232571) is `windowWidth - 424 - sidebarWidth`, i.e. the space left after the min
  // chat column and the live sidebar. Computed here, not inside the evaluated body, so the
  // helper's own `n.maxWidth` is exactly the value 0.18/0.62.0 hand it.
  const maxWidth = windowWidth - MIN_CHAT_COLUMN - sidebarWidth;
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "k3n", "zUe", "DQ", "ume", "maxWidth", "pointerWidth",
    `${helper}; return w3n({pointerWidth, zoomExcess: 0, maxWidth});`,
  );
  return fn(COLLAPSE_THRESHOLD, ZOOM_CORRECTION, INFO_PANE_MIN, REMOVED_INFO_PANE_MAX, maxWidth, pointerWidth);
}

/** The persisted-width clamp, run for real, the way RQ is defined at @2224550. */
function persistedWidth(source, stored) {
  const RQ = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const DQ = INFO_PANE_MIN;
  const K4e = 320;
  const bge = (n, fallback) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
  const hasInfinity = source.includes(`RQ(bge(s.width,K4e),DQ,${PERSISTENCE_UPPER_BOUND})`);
  const upper = hasInfinity ? Number.POSITIVE_INFINITY : REMOVED_INFO_PANE_MAX;
  return RQ(bge(stored, K4e), DQ, upper);
}

test("the pinned chunk still carries every anchor this patch depends on", { skip: pinnedSkip }, async () => {
  const source = await readPinnedChunk();
  assert.ok(source.includes(LAYOUT_CONSTANTS_BEFORE), "layout constant block anchor drifted");
  assert.ok(source.includes(LAYOUT_018_DRAG_HELPER), "drag helper anchor drifted");
  for (const site of CLAMP_SITES) {
    assert.ok(source.includes(site.before), `clamp site "${site.id}" anchor drifted`);
  }
  for (const site of OPEN_FIT_SITES) {
    assert.ok(source.includes(site.before), `open-fit site "${site.id}" anchor drifted`);
  }
});

/**
 * The window-fit predicates, run for real with the argument shape IDn hands them.
 *
 * The shipped wedge: 0.18's IDn passed the PERSISTED width (`u`) into `uan`/`dan`, so a
 * stored 1216px width on a 1728px window made the pane permanently unopenable. 0.66.0's
 * ZRe/QRe only ever ask whether the window holds the 280px MINIMUM pane. The call sites are
 * what this patch changes, so the test evaluates the predicates against the width the call
 * site actually passes — extracted from the chunk, not restated from memory.
 */
function extractPredicateDefinitions(source) {
  const names = ["jlt", "Dlt", "uan", "dan"];
  const bodies = [];
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} not found in the chunk`);
    const next = source.indexOf("function ", start + 10);
    bodies.push(source.slice(start, next < 0 ? undefined : next).trim().replace(/;$/, ""));
  }
  return `${bodies.join("\n")};
    const SIDEBAR = { isCollapsed: false, expandedWidth: 400 };
    return {
      fitsAt: paneWidth => uan({ windowWidth: 1728, sidebar: SIDEBAR, paneWidth }),
      fitsTinyWindowAt: paneWidth => uan({ windowWidth: 1000, sidebar: SIDEBAR, paneWidth }),
      growByAt: paneWidth => dan({ windowWidth: 1000, sidebar: SIDEBAR, paneWidth }),
    };`;
}

/** The width each `uan`/`dan` call site passes, taken from the chunk's own call text. */
function paneWidthTheOpenPathPasses(source) {
  const subscribe = source.match(/uan\(\{windowWidth:window\.innerWidth,sidebar:m,paneWidth:(\w+)\}\)/);
  const grow = source.match(/dan\(\{windowWidth:H,sidebar:m,paneWidth:(\w+)\}\)/);
  assert.ok(subscribe, "the fits-subscribe call site is missing");
  assert.ok(grow, "the grow-by call site is missing");
  return { fits: subscribe[1], grow: grow[1] };
}

const evalPredicates = (source) => {
  // eslint-disable-next-line no-new-func
  const fn = new Function("Jlt", "DQ", "dme", extractPredicateDefinitions(source));
  return fn(SIDEBAR_COLLAPSED, INFO_PANE_MIN, MIN_CHAT_COLUMN);
};

test("the open path consults the minimum pane width, never the persisted one", { skip: pinnedSkip }, async () => {
  const source = await readPinnedChunk();
  const patched = patchOriginalInfoPaneSplit(source);

  // The shipped chunk passed the persisted width at both sites — that is the wedge.
  assert.equal(paneWidthTheOpenPathPasses(source).fits, "u");
  assert.equal(paneWidthTheOpenPathPasses(source).grow, "u");
  // 0.18 with a persisted 1216px width on a 1728px window: the pane "does not fit".
  assert.equal(evalPredicates(source).fitsAt(1216), false);

  // The patched chunk asks about the 280px minimum at both sites.
  const passed = paneWidthTheOpenPathPasses(patched);
  assert.equal(passed.fits, "DQ", "the fits predicate still reads the persisted width");
  assert.equal(passed.grow, "DQ", "the grow-by computation still reads the persisted width");
  // With minimum-width semantics the same window fits: sidebar 400 + chat 424 + pane 280 = 1104.
  // The predicate itself is unchanged — what changed is that the call sites stop feeding it
  // the persisted width, so a full-screen window now fits even with 1216px persisted.
  const predicates = evalPredicates(patched);
  assert.equal(predicates.fitsAt(280), true, "a full-screen window fits a minimum pane");
  assert.equal(predicates.fitsAt(1216), false, "the predicate still rejects a 1216px pane — the call site is the fix");
  // A genuinely tiny window still does not fit, and asks to grow by exactly the shortfall.
  assert.equal(predicates.fitsTinyWindowAt(280), false);
  assert.equal(predicates.growByAt(280), 400 + 424 + 280 - 1000);
});

test("reverting either open-fit site reintroduces the wedge the patch exists to remove", { skip: pinnedSkip }, async () => {
  const patched = patchOriginalInfoPaneSplit(await readPinnedChunk());
  // Mutant 1: the subscribe site back on the persisted width — the exact 0.18 behaviour.
  const subscribeReverted = patched.replace(OPEN_FIT_SITES[0].after, OPEN_FIT_SITES[0].before);
  assert.throws(() => assertInfoPaneSplitShape(subscribeReverted), /fits-subscribe/);
  assert.equal(paneWidthTheOpenPathPasses(subscribeReverted).fits, "u");
  // Mutant 2: the grow-by site back on the persisted width.
  const growReverted = patched.replace(OPEN_FIT_SITES[1].after, OPEN_FIT_SITES[1].before);
  assert.throws(() => assertInfoPaneSplitShape(growReverted), /grow-by/);
  assert.equal(paneWidthTheOpenPathPasses(growReverted).grow, "u");
});

test("the render-time clamp the open-fit port leans on is present in chunk and CSS", { skip: pinnedSkip }, async () => {
  const patched = patchOriginalInfoPaneSplit(await readPinnedChunk());
  // The open pane's class pair carries the max-width clamp; without it an oversized stored
  // width would squeeze the chat column below its 424px minimum.
  assert.ok(patched.includes(OPEN_PANE_CSS_CLAMP.classSetPair), "the open class pair lost the clamp class");
  const css = await readFile(
    path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-lCyB53CO.css"),
    "utf8",
  );
  assert.ok(css.includes(OPEN_PANE_CSS_CLAMP.rule), "the pinned CSS lost the open-pane max-width rule");
});

test("the patch is byte-exact against 0.62.0: the drag helper differs only by the 480 term", () => {
  // 0.62.0's helper, in its own identifiers: xh is its info-pane minimum (280), h0e its
  // collapse threshold (244), w6 its zoom correction (140). Normalising the three constants
  // and the parameter name leaves the two helpers directly comparable, and the only term that
  // may still differ is the 480 clamp.
  const renamed = REFERENCE_062_DRAG_HELPER
    .replace(/\bh0e\b/g, "k3n")
    .replace(/\bw6\b/g, "zUe")
    .replace(/\bxh\b/g, "DQ")
    .replace("function y0e(t)", "function w3n(n)")
    .replace("=t.pointerWidth-t.zoomExcess", "=n.pointerWidth-n.zoomExcess")
    .replace("Math.max(DQ,t.maxWidth)", "Math.max(DQ,n.maxWidth)")
    // 0.62.0's local is `n` too; 0.18's is `t`, because `n` is the parameter here.
    .replace("const n=Math.max(DQ,n.maxWidth);", "const t=Math.max(DQ,n.maxWidth);")
    .replace("Math.max(DQ,Math.min(n,e))", "Math.max(DQ,Math.min(t,e))");
  assert.equal(
    LAYOUT_018_DRAG_HELPER_PATCHED,
    renamed,
    "the patched helper does not reproduce 0.62.0's",
  );
  // And the only delta from the original really is the 480 term.
  assert.equal(
    LAYOUT_018_DRAG_HELPER_PATCHED,
    LAYOUT_018_DRAG_HELPER.replace("Math.max(DQ,Math.min(ume,n.maxWidth))", "Math.max(DQ,n.maxWidth)"),
    "the patched helper is not the original with the 480 term removed",
  );
});

test("a wide window is no longer capped at 480px", { skip: pinnedSkip }, async () => {
  const source = await readPinnedChunk();
  const patched = patchOriginalInfoPaneSplit(source);

  // The window in the report is a 16" MacBook Pro's full width. Under 0.18 the pane cannot
  // exceed 480 no matter how far the handle is dragged.
  const at3456 = { windowWidth: 3456, pointerWidth: 3000, sidebarWidth: SIDEBAR_EXPANDED };
  assert.equal(dragPaneWidth(source, at3456).width, REMOVED_INFO_PANE_MAX);
  assert.equal(dragPaneWidth(patched, at3456).width, 2752);
  assert.ok(dragPaneWidth(patched, at3456).width > REMOVED_INFO_PANE_MAX);
});

test("the pane grows with the window instead of pinning at one width", { skip: pinnedSkip }, async () => {
  const source = await readPinnedChunk();
  const patched = patchOriginalInfoPaneSplit(source);
  const previous = { width: -1 };
  for (const windowWidth of [1280, 1440, 1512, 1680, 1920, 2560, 3456]) {
    const { width } = dragPaneWidth(patched, {
      windowWidth,
      pointerWidth: 1e6,
      sidebarWidth: SIDEBAR_EXPANDED,
    });
    assert.ok(
      width > previous.width,
      `pane width did not increase at ${windowWidth}px window (${previous.width} -> ${width})`,
    );
    previous.width = width;
  }
});

test("the pane is still bounded by the window, the min chat column and the sidebar", { skip: pinnedSkip }, async () => {
  const patched = patchOriginalInfoPaneSplit(await readPinnedChunk());
  for (const windowWidth of [1000, 1280, 1920, 2560, 3456]) {
    for (const sidebarWidth of [SIDEBAR_COLLAPSED, SIDEBAR_EXPANDED]) {
      const expected = Math.max(INFO_PANE_MIN, windowWidth - MIN_CHAT_COLUMN - sidebarWidth);
      const actual = dragPaneWidth(patched, {
        windowWidth,
        pointerWidth: 1e6,
        sidebarWidth,
      }).width;
      assert.equal(actual, expected, `unbounded at ${windowWidth}px / sidebar ${sidebarWidth}px`);
    }
  }
});

test("the minimum width and the collapse threshold are unchanged", { skip: pinnedSkip }, async () => {
  const patched = patchOriginalInfoPaneSplit(await readPinnedChunk());
  // Below 244px the pane collapses, exactly as in 0.18 and in 0.62.0.
  const collapsed = dragPaneWidth(patched, {
    windowWidth: 3456,
    pointerWidth: 200,
    sidebarWidth: SIDEBAR_EXPANDED,
  });
  assert.equal(collapsed.isCollapse, true);
  // A narrow window still leaves the 280px minimum in place, never less.
  const narrow = dragPaneWidth(patched, { windowWidth: 900, pointerWidth: 1e6, sidebarWidth: SIDEBAR_EXPANDED });
  assert.equal(narrow.width, INFO_PANE_MIN);
});

test("the drag helper is rewritten, not merely the persisted value", { skip: pinnedSkip }, async () => {
  const source = await readPinnedChunk();
  const patched = patchOriginalInfoPaneSplit(source);
  // Both layers mattered: had only the persistence clamps been relaxed, the first drag would
  // still start from and stop at 480, because the drag helper is what writes the CSS var.
  assert.equal(dragPaneWidth(patched, { windowWidth: 3456, pointerWidth: 1e6, sidebarWidth: SIDEBAR_EXPANDED }).width, 2752);
  assert.equal(persistedWidth(patched, 1200), 1200, "a persisted width above 480 is no longer truncated");
  assert.equal(persistedWidth(source, 1200), REMOVED_INFO_PANE_MAX, "0.18 truncated it");
  assert.equal(persistedWidth(patched, 100), INFO_PANE_MIN, "the 280px floor still holds");
});

test("the patch leaves no reference to the deleted ceiling", { skip: pinnedSkip }, async () => {
  const patched = patchOriginalInfoPaneSplit(await readPinnedChunk());
  assert.ok(!patched.includes("ume=480"), "the constant is still declared");
  assert.ok(!/\bume\b/.test(patched), "ume is still referenced somewhere in the chunk");
  assert.ok(patched.includes(LAYOUT_CONSTANTS_AFTER));
  // Every other layout constant is byte-identical to 0.18's.
  for (const kept of ["W4e=280", "use=240", "cme=400", "Jlt=88", "K4e=320", "DQ=280", "dme=424"]) {
    assert.ok(patched.includes(kept), `${kept} was altered`);
  }
});

test("the resize handle, the CSS variable and the window-derived maximum are untouched", { skip: pinnedSkip }, async () => {
  const patched = patchOriginalInfoPaneSplit(await readPinnedChunk());
  for (const needle of [
    "function han(n){return n.windowWidth-dme-jlt(n.sidebar)}",
    "const k3n=244,zUe=140;",
    '"sand-info-pane__resize-handle"',
    'role:"separator"',
    'cursor:"col-resize"',
    'setProperty("--sand-info-pane-width"',
    "maxWidth:han({windowWidth:window.innerWidth,sidebar:I})",
  ]) {
    assert.ok(patched.includes(needle), `the patch dropped ${needle}`);
  }
  assert.ok(patched.includes(`Math.max(DQ,${DRAG_HELPER_UPPER_BOUND})`));
});

test("the shape assertion fails closed on a chunk that lost an anchor", () => {
  // A chunk that still carries the pre-patch constant block has not been patched at all.
  assert.throws(
    () => assertInfoPaneSplitShape(LAYOUT_CONSTANTS_BEFORE),
    /layout constant block/,
    "an unpatched chunk must not pass",
  );
  // A chunk with the new block but no clamps at all is equally not a patched chunk.
  assert.throws(
    () => assertInfoPaneSplitShape(LAYOUT_CONSTANTS_AFTER),
    /clamp/,
    "a chunk with the new block but no clamps must not pass",
  );
  // A chunk that kept one clamp on the old ceiling must be caught by that specific site.
  const halfPatched =
    LAYOUT_CONSTANTS_AFTER +
    CLAMP_SITES[0].before +
    LAYOUT_018_DRAG_HELPER_PATCHED +
    `const k3n=244,zUe=140;function han(n){return n.windowWidth-dme-jlt(n.sidebar)}dme=424;` +
    `"sand-info-pane__resize-handle"role:"separator"cursor:"col-resize"setProperty("--sand-info-pane-width"`;
  assert.throws(
    () => assertInfoPaneSplitShape(halfPatched),
    /object-normaliser/,
    "a half-patched chunk must be caught by the site that still names the ceiling",
  );
});

test("a drifted anchor fails the patch instead of silently skipping a site", { skip: pinnedSkip }, async () => {
  const source = await readPinnedChunk();
  // Re-introduce the deleted ceiling at one clamp site only: the other four anchors still
  // match, so a patch that ignored the miss would still "succeed".
  const drifted = source.replace(CLAMP_SITES[0].before, CLAMP_SITES[0].before.replace(",ume)", ")"));
  assert.throws(
    () => patchOriginalInfoPaneSplit(drifted),
    /object-normaliser/,
    "a missing clamp site must fail closed",
  );
});

test("a chunk carrying two copies of the target is rejected as ambiguous", () => {
  const source = LAYOUT_CONSTANTS_BEFORE + LAYOUT_018_DRAG_HELPER;
  assert.throws(
    () => patchOriginalInfoPaneSplit(source + source),
    /ambiguous/,
    "a duplicated target must fail closed",
  );
});

test("apply fails closed when no stylesheet is staged to validate the open-pane clamp", { skip: pinnedSkip }, async (t) => {
  const stageRoot = path.join(REPO_ROOT, ".test-tmp-info-pane-split-nocss");
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const { mkdir, rm, writeFile: writeFileStage } = await import("node:fs/promises");
  await mkdir(assetsRoot, { recursive: true });
  t.after(async () => {
    await rm(stageRoot, { recursive: true, force: true });
  });
  await writeFileStage(path.join(assetsRoot, "index-UbX-y3il.js"), await readPinnedChunk());
  await assert.rejects(
    () => applyOriginalRendererInfoPaneSplit({ stageRoot }),
    /no renderer stylesheet/i,
    "a staged tree without the CSS must not pass the open-fit guard silently",
  );
});

test("applyOriginalRendererInfoPaneSplit rewrites the staged chunk and records provenance", { skip: pinnedSkip }, async (t) => {
  const stageRoot = path.join(REPO_ROOT, ".test-tmp-info-pane-split");
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const { mkdir, rm, writeFile: writeFileStage } = await import("node:fs/promises");
  await mkdir(assetsRoot, { recursive: true });
  t.after(async () => {
    await rm(stageRoot, { recursive: true, force: true });
  });
  const original = await readPinnedChunk();
  await writeFileStage(path.join(assetsRoot, "index-UbX-y3il.js"), original);
  // The apply step also guards the stylesheet side of the open-fit port: stage the pinned CSS
  // (found by name, like the build does) so the guard runs against the real rule.
  const { readdir } = await import("node:fs/promises");
  const pinnedCssName = (await readdir(path.join(REPO_ROOT, "src/app/dist/renderer/assets")))
    .find(name => /^index-.*\.css$/.test(name));
  assert.ok(pinnedCssName, "no pinned renderer stylesheet found next to the chunk");
  await writeFileStage(
    path.join(assetsRoot, pinnedCssName),
    await readFile(path.join(REPO_ROOT, "src/app/dist/renderer/assets", pinnedCssName), "utf8"),
  );
  // A second chunk that merely looks similar must not be mistaken for the target.
  await writeFileStage(path.join(assetsRoot, "chunk-other.js"), "export const unrelated = 1;\n");

  const result = await applyOriginalRendererInfoPaneSplit({ stageRoot });
  assert.equal(result.mode, "original-renderer-info-pane-split");
  assert.equal(result.layout.infoPaneMaxPx, null);
  assert.equal(result.layout.openFitPaneWidthPx, INFO_PANE_MIN);
  assert.equal(result.openFit.behaviourChange, true);
  assert.deepEqual(
    result.transformations,
    ["info-pane-removes-fixed-480px-maximum", "info-pane-open-fit-uses-minimum-pane-width"],
  );
  assert.equal(result.chunks[0].path, "dist/renderer/assets/index-UbX-y3il.js");
  assert.equal(result.chunks[0].clampSites, CLAMP_SITES.length);
  assert.equal(result.chunks[0].openFitSites, OPEN_FIT_SITES.length);
  assert.notEqual(result.chunks[0].original.sha256, result.chunks[0].patched.sha256);

  const staged = await readFile(path.join(assetsRoot, "index-UbX-y3il.js"), "utf8");
  assert.equal(staged, patchOriginalInfoPaneSplit(original));
  // The neighbour chunk is untouched.
  assert.equal(await readFile(path.join(assetsRoot, "chunk-other.js"), "utf8"), "export const unrelated = 1;\n");
  assert.equal(result.provenanceBytes > 0, true);
  // The staged chunk must still parse. A bad edit into minified code is the failure mode
  // typecheck and the audit both miss, so it is asserted here on the real bytes.
  const { writeFile: write, rm: rmFile } = await import("node:fs/promises");
  const syntaxProbe = path.join(stageRoot, "syntax-probe.mjs");
  await write(syntaxProbe, staged);
  t.after(async () => {
    await rmFile(syntaxProbe, { force: true });
  });
  const { execFile } = await import("node:child_process");
  await new Promise((resolve, reject) => {
    execFile(process.execPath, ["--check", syntaxProbe], (error) => {
      if (error) reject(new Error(`patched chunk fails node --check: ${error.message}`));
      else resolve();
    });
  });
});
