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
  PERSISTENCE_UPPER_BOUND,
  REFERENCE_062_DRAG_HELPER,
  REMOVED_INFO_PANE_MAX,
  patchOriginalInfoPaneSplit,
} from "../scripts/lib/info-pane-split-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_CHUNK = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");

const readPinnedChunk = () => readFile(PINNED_CHUNK, "utf8");

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

test("the pinned chunk still carries every anchor this patch depends on", async () => {
  const source = await readPinnedChunk();
  assert.ok(source.includes(LAYOUT_CONSTANTS_BEFORE), "layout constant block anchor drifted");
  assert.ok(source.includes(LAYOUT_018_DRAG_HELPER), "drag helper anchor drifted");
  for (const site of CLAMP_SITES) {
    assert.ok(source.includes(site.before), `clamp site "${site.id}" anchor drifted`);
  }
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

test("a wide window is no longer capped at 480px", async () => {
  const source = await readPinnedChunk();
  const patched = patchOriginalInfoPaneSplit(source);

  // The window in the report is a 16" MacBook Pro's full width. Under 0.18 the pane cannot
  // exceed 480 no matter how far the handle is dragged.
  const at3456 = { windowWidth: 3456, pointerWidth: 3000, sidebarWidth: SIDEBAR_EXPANDED };
  assert.equal(dragPaneWidth(source, at3456).width, REMOVED_INFO_PANE_MAX);
  assert.equal(dragPaneWidth(patched, at3456).width, 2752);
  assert.ok(dragPaneWidth(patched, at3456).width > REMOVED_INFO_PANE_MAX);
});

test("the pane grows with the window instead of pinning at one width", async () => {
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

test("the pane is still bounded by the window, the min chat column and the sidebar", async () => {
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

test("the minimum width and the collapse threshold are unchanged", async () => {
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

test("the drag helper is rewritten, not merely the persisted value", async () => {
  const source = await readPinnedChunk();
  const patched = patchOriginalInfoPaneSplit(source);
  // Both layers mattered: had only the persistence clamps been relaxed, the first drag would
  // still start from and stop at 480, because the drag helper is what writes the CSS var.
  assert.equal(dragPaneWidth(patched, { windowWidth: 3456, pointerWidth: 1e6, sidebarWidth: SIDEBAR_EXPANDED }).width, 2752);
  assert.equal(persistedWidth(patched, 1200), 1200, "a persisted width above 480 is no longer truncated");
  assert.equal(persistedWidth(source, 1200), REMOVED_INFO_PANE_MAX, "0.18 truncated it");
  assert.equal(persistedWidth(patched, 100), INFO_PANE_MIN, "the 280px floor still holds");
});

test("the patch leaves no reference to the deleted ceiling", async () => {
  const patched = patchOriginalInfoPaneSplit(await readPinnedChunk());
  assert.ok(!patched.includes("ume=480"), "the constant is still declared");
  assert.ok(!/\bume\b/.test(patched), "ume is still referenced somewhere in the chunk");
  assert.ok(patched.includes(LAYOUT_CONSTANTS_AFTER));
  // Every other layout constant is byte-identical to 0.18's.
  for (const kept of ["W4e=280", "use=240", "cme=400", "Jlt=88", "K4e=320", "DQ=280", "dme=424"]) {
    assert.ok(patched.includes(kept), `${kept} was altered`);
  }
});

test("the resize handle, the CSS variable and the window-derived maximum are untouched", async () => {
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

test("a drifted anchor fails the patch instead of silently skipping a site", async () => {
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

test("applyOriginalRendererInfoPaneSplit rewrites the staged chunk and records provenance", async (t) => {
  const stageRoot = path.join(REPO_ROOT, ".test-tmp-info-pane-split");
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const { mkdir, rm, writeFile: writeFileStage } = await import("node:fs/promises");
  await mkdir(assetsRoot, { recursive: true });
  t.after(async () => {
    await rm(stageRoot, { recursive: true, force: true });
  });
  const original = await readPinnedChunk();
  await writeFileStage(path.join(assetsRoot, "index-UbX-y3il.js"), original);
  // A second chunk that merely looks similar must not be mistaken for the target.
  await writeFileStage(path.join(assetsRoot, "chunk-other.js"), "export const unrelated = 1;\n");

  const result = await applyOriginalRendererInfoPaneSplit({ stageRoot });
  assert.equal(result.mode, "original-renderer-info-pane-split");
  assert.equal(result.layout.infoPaneMaxPx, null);
  assert.equal(result.chunks[0].path, "dist/renderer/assets/index-UbX-y3il.js");
  assert.equal(result.chunks[0].clampSites, CLAMP_SITES.length);
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
