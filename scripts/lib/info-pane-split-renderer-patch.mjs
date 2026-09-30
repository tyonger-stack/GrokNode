// Grok Bot 0.62.0 info-pane split sizing, ported onto the checksum-pinned 0.18 renderer chunk.
//
// Evidence (byte-sourced 2026-09-30 from the official Grok Bot macOS app, bundle
// com.anysphere.sand at /Applications/Grok Bot.app, CFBundleShortVersionString 0.62.0,
// read from its Info.plist on 2026-09-30; renderer chunks
// dist/renderer/assets/index-BYEktDeR.js and dist/renderer/assets/index.eager-app-C20nv6Dx.js
// inside its app.asar). The target is the pinned 0.18 chunk index-UbX-y3il.js.
//
// The reported symptom is the split between the transcript and the right-hand column — the
// pane that carries the 详情 / 资料库 / 电脑 tabs, so the "电脑" (VNC) column is the widest
// thing behind that handle. Dragging the handle to the right does not widen the column past
// 480 CSS px, so on any window wider than ~1184 px the column stops growing and the pane
// shows a clipped desktop instead of the full screen.
//
// Both versions compute the pane width in the same helper, and the helper is the only
// difference. 0.62.0, index.eager-app-C20nv6Dx.js @656016:
//
//     const h0e=244,w6=140;
//     function y0e(t){
//       const e=t.pointerWidth-t.zoomExcess;
//       if(e<h0e)return{isCollapse:!0};
//       const n=Math.max(xh,t.maxWidth);              // <-- no fixed ceiling
//       return{isCollapse:!1,width:Math.max(xh,Math.min(n,e))}
//     }
//
// 0.18, index-UbX-y3il.js @2789438, is the same function with one extra term:
//
//     const k3n=244,zUe=140;
//     function w3n(n){
//       const e=n.pointerWidth-n.zoomExcess;
//       if(e<k3n)return{isCollapse:!0};
//       const t=Math.max(DQ,Math.min(ume,n.maxWidth));   // <-- ume = 480
//       return{isCollapse:!1,width:Math.max(DQ,Math.min(t,e))}
//     }
//
// `ume` is the only fixed maximum in either version, and 0.62.0 has deleted it. Its layout
// constant block @560691 is:
//
//     const Tl=280,Gr=240,fi=400,fS=88,Il=320,eo=280,pi=424,to="overview"
//
// Nine constants, of which 0.18's block @2224002 is:
//
//     const W4e=280,use=240,cme=400,Jlt=88,K4e=320,DQ=280,ume=480,dme=424
//
// Mapping them in declaration order: sidebar expanded 280=280, sidebar min 240=240, sidebar
// max 400=400, sidebar collapsed 88=88, info-pane default 320=320, info-pane min 280=280,
// info-pane max 480 -> (absent), min chat column 424=424. Every value that 0.62.0 still has
// is byte-identical to 0.18's; the only delta is the deletion of the 480 ceiling. That is
// the whole change.
//
// The ceiling was never the only thing reading it. `ume` is referenced in five places, and
// all five are the same "clamp the stored/dragged width to 480" decision, so all five are
// removed here — leaving any one of them in place would re-introduce the cap on the next
// reload (the persistence layer would clamp the width back to 480 and the next drag would
// start from there). 0.18 @2225632, the object normaliser:
//
//     infoPane:{isOpen:…, width:RQ(bge(s.width,K4e),DQ,ume)}
//
// The four persistence-layer sites (this one, the localStorage normaliser, the async read
// fallback and setInfoPaneWidth) become unbounded in their upper bound, which is exactly
// 0.62.0's shape there: its equivalent keeps the lower bound and nothing else, e.g.
// `width:Math.max(eo,Ua(n.width,Il))`. The fifth site — the drag helper — is the one that
// actually decides the rendered width, and there the upper bound becomes the window-derived
// maximum, never unbounded. The reasoning for that split is under "Why the upper bound is
// not simply removed" below.
//
// The remaining four sites:
//   * @2225951  RQ(bge(e.infoPaneWidth,K4e),DQ,ume)             localStorage normaliser
//   * @2227093  $Fe(…,"int",{fallback:K4e,min:DQ,max:ume})      async read fallback
//   * @2231018  setInfoPaneWidth: RQ(L,DQ,ume)                   the write path
//   * @2789438  Math.max(DQ,Math.min(ume,n.maxWidth))            the drag helper
//
// Why the drag helper's upper bound is not simply removed. `n.maxWidth` at the drag site is
// not a constant — it is `han({windowWidth:window.innerWidth,sidebar:I})` (@2792294), and
// `han` @2232571 is `function han(n){return n.windowWidth-dme-jlt(n.sidebar)}`, i.e. window
// width minus the 424px minimum chat column minus the live sidebar width. 0.62.0's drag path
// is the same shape, passing the same derived maximum (@660887:
//
//     maxWidth:sU({windowWidth:window.innerWidth,sidebar:E})
//
// ). So the patched helper does not leave the pane unbounded: the real ceiling is the space
// the window actually has after the min chat column and the sidebar, which is what makes a
// wide window show a wide computer column while a narrow one still fits a 280px pane beside
// a 424px transcript. This is why the drag helper is rewritten to `Math.max(DQ,n.maxWidth)`
// — matching 0.62.0's `Math.max(xh,t.maxWidth)` — rather than to an unbounded clamp.
//
// Scope: the five clamp sites plus the constant declaration. Untouched, and identical in
// both versions: the 244px collapse threshold, the 140px zoom correction, the 280px minimum,
// the 424px minimum chat column, the sidebar constants, the resize handle's own classes and
// geometry (`sand-info-pane__resize-handle`, `role:"separator"`, `cursor:"col-resize"`), and
// the CSS variable plumbing (`--sand-info-pane-width` via `Hwe`).
//
// A note on one apparent dead branch, recorded rather than "fixed". 0.62.0's window-fit
// predicates `nhe`/`she`/`rhe` appear in its main chunk only as empty stubs
// (`function nhe(){}` @553956) and its eager-app block still declares them, but nothing in
// 0.62.0's chunk calls them. 0.18's equivalents `uan`/`dan` ARE called (@5496591, @5496893)
// and they take the live `paneWidth`, so a widened pane can make `uan` report "does not
// fit" in 0.18 in a way 0.62.0 cannot. That is a real behavioural difference, but it is a
// second, separate upstream decision (0.62.0 dropped these predicates rather than changing
// them) and touching them would mean inventing a replacement for code 0.62.0 deleted.
// Left alone here; flagged for the record.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The layout constant block, verbatim from the pinned chunk @2224002. Anchors the whole
 * patch and doubles as the gate for the deleted constant: if a future chunk renames, reorders
 * or re-values any of the nine constants, this stops matching and the build fails.
 */
export const LAYOUT_CONSTANTS_BEFORE =
  "const W4e=280,use=240,cme=400,Jlt=88,K4e=320,DQ=280,ume=480,dme=424,";

/** 0.62.0's block, minus the deleted ceiling. The eight survivors keep 0.18's own names. */
export const LAYOUT_CONSTANTS_AFTER =
  "const W4e=280,use=240,cme=400,Jlt=88,K4e=320,DQ=280,dme=424,";

/** The value 0.62.0 deleted, kept as a named export so the tests can assert on it directly. */
export const REMOVED_INFO_PANE_MAX = 480;

/** The five clamp sites. Each is (before, after) and each must match exactly once. */
export const CLAMP_SITES = Object.freeze([
  {
    id: "object-normaliser",
    before: "infoPane:{isOpen:typeof s.isOpen==\"boolean\"?s.isOpen:!1,width:RQ(bge(s.width,K4e),DQ,ume)}",
    after: "infoPane:{isOpen:typeof s.isOpen==\"boolean\"?s.isOpen:!1,width:RQ(bge(s.width,K4e),DQ,Number.POSITIVE_INFINITY)}",
  },
  {
    id: "local-storage-normaliser",
    before: "infoPane:{isOpen:typeof e.infoPaneOpen==\"boolean\"?e.infoPaneOpen:!1,width:RQ(bge(e.infoPaneWidth,K4e),DQ,ume)}",
    after: "infoPane:{isOpen:typeof e.infoPaneOpen==\"boolean\"?e.infoPaneOpen:!1,width:RQ(bge(e.infoPaneWidth,K4e),DQ,Number.POSITIVE_INFINITY)}",
  },
  {
    id: "async-read-fallback",
    before: "width:$Fe(r.get($c.infoPaneWidth)??null,\"int\",{fallback:K4e,min:DQ,max:ume})",
    after: "width:$Fe(r.get($c.infoPaneWidth)??null,\"int\",{fallback:K4e,min:DQ,max:Number.POSITIVE_INFINITY})",
  },
  {
    id: "set-width",
    before: "setInfoPaneWidth:L=>{if(y)return;const D=RQ(L,DQ,ume);",
    after: "setInfoPaneWidth:L=>{if(y)return;const D=RQ(L,DQ,Number.POSITIVE_INFINITY);",
  },
  {
    id: "drag-helper",
    before: "const t=Math.max(DQ,Math.min(ume,n.maxWidth));",
    after: "const t=Math.max(DQ,n.maxWidth);",
  },
]);

/**
 * The four persistence-layer sites have no window in scope, so their upper bound becomes
 * unbounded (`Number.POSITIVE_INFINITY`) — which is exactly 0.62.0's own shape there
 * (`width:Math.max(eo,Ua(n.width,Il))` keeps the lower bound and nothing else). The real
 * ceiling is enforced by the drag helper, which re-derives it from `window.innerWidth` on
 * every frame; these sites only run on load, so an unbounded read here can never widen the
 * pane past what the window holds, it can only fail to narrow it — and `RQ`'s lower bound
 * still applies, so a stale too-small value is still raised to 280.
 */
export const PERSISTENCE_UPPER_BOUND = "Number.POSITIVE_INFINITY";

/** The drag helper's replacement, which is what actually sizes the pane. */
export const DRAG_HELPER_UPPER_BOUND = "n.maxWidth";

/**
 * 0.62.0's drag helper body, for the record. Kept here so the equivalence is checkable in
 * this file rather than only in the header comment: 0.18's helper differs from this by the
 * `Math.min(ume, …)` term and by 0.18's local names, and by nothing else.
 */
export const REFERENCE_062_DRAG_HELPER =
  'function y0e(t){const e=t.pointerWidth-t.zoomExcess;if(e<h0e)return{isCollapse:!0};const n=Math.max(xh,t.maxWidth);return{isCollapse:!1,width:Math.max(xh,Math.min(n,e))}}';

/** 0.18's drag helper, verbatim from @2789438. The patch must reduce it to the 0.62.0 shape. */
export const LAYOUT_018_DRAG_HELPER =
  "function w3n(n){const e=n.pointerWidth-n.zoomExcess;if(e<k3n)return{isCollapse:!0};const t=Math.max(DQ,Math.min(ume,n.maxWidth));return{isCollapse:!1,width:Math.max(DQ,Math.min(t,e))}}";

/** 0.18's drag helper after the patch: byte-for-byte 0.62.0's, in 0.18's identifier spelling. */
export const LAYOUT_018_DRAG_HELPER_PATCHED =
  "function w3n(n){const e=n.pointerWidth-n.zoomExcess;if(e<k3n)return{isCollapse:!0};const t=Math.max(DQ,n.maxWidth);return{isCollapse:!1,width:Math.max(DQ,Math.min(t,e))}}";

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalInfoPaneSplit(source) {
  let patched = replaceExactlyOnce(source, LAYOUT_CONSTANTS_BEFORE, LAYOUT_CONSTANTS_AFTER, "layout constants");
  for (const site of CLAMP_SITES) {
    patched = replaceExactlyOnce(patched, site.before, site.after, `info-pane clamp (${site.id})`);
  }
  return patched;
}

/**
 * Fail closed unless the patched chunk really is the 0.62.0 shape. Checks the outcome rather
 * than trusting the edits: the deleted constant must be gone from the layout block, no clamp
 * site may still name it, the drag helper must have collapsed to the 0.62.0 form, and the
 * geometry that is NOT part of this change (the collapse threshold, the zoom correction, the
 * minimums and the chat column) must be untouched.
 */
export function assertInfoPaneSplitShape(patched) {
  if (patched.includes(LAYOUT_CONSTANTS_BEFORE)) {
    throw new Error("Info-pane split patch left the original layout constant block in place.");
  }
  if (!patched.includes(LAYOUT_CONSTANTS_AFTER)) {
    throw new Error("Info-pane split patch did not produce the 0.62.0 layout constant block.");
  }
  if (patched.includes("ume=480")) {
    throw new Error("Info-pane split patch left the 480px info-pane ceiling declared.");
  }
  for (const site of CLAMP_SITES) {
    if (patched.includes(site.before)) {
      throw new Error(`Info-pane split patch left the ${site.id} clamp naming the deleted ceiling.`);
    }
    if (!patched.includes(site.after)) {
      throw new Error(`Info-pane split patch lost the ${site.id} clamp.`);
    }
  }
  if (!patched.includes(LAYOUT_018_DRAG_HELPER_PATCHED)) {
    throw new Error("Info-pane split patch did not reduce the drag helper to the 0.62.0 shape.");
  }
  if (patched.includes("Math.min(ume,")) {
    throw new Error("Info-pane split patch left the drag helper clamping against the deleted ceiling.");
  }
  // Geometry that must survive untouched, in both versions.
  for (const [needle, what] of [
    ["const k3n=244,zUe=140;", "collapse threshold and zoom correction"],
    ["function han(n){return n.windowWidth-dme-jlt(n.sidebar)}", "window-derived pane maximum"],
    ["dme=424", "424px minimum chat column"],
    ['"sand-info-pane__resize-handle"', "resize handle class"],
    ['role:"separator"', "resize handle separator role"],
    ['cursor:"col-resize"', "resize handle cursor"],
    ['setProperty("--sand-info-pane-width"', "info-pane width CSS variable"],
  ]) {
    if (!patched.includes(needle)) {
      throw new Error(`Info-pane split patch lost its ${what}.`);
    }
  }
  return { clampSites: CLAMP_SITES.length };
}

export async function applyOriginalRendererInfoPaneSplit({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    // The drag helper is what locates the target file, so a chunk rename or a second copy
    // both fail closed.
    if (source.includes(LAYOUT_018_DRAG_HELPER) || source.includes(LAYOUT_CONSTANTS_BEFORE)) {
      candidates.push({ name, target, source });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one original renderer chunk for the info-pane split patch, found ${candidates.length}.`,
    );
  }
  const candidate = candidates[0];
  const patched = patchOriginalInfoPaneSplit(candidate.source);
  const checked = assertInfoPaneSplitShape(patched);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-info-pane-split",
    chunks: [
      {
        role: "info-pane-split",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
        clampSites: checked.clampSites,
      },
    ],
    layout: {
      infoPaneMinPx: 280,
      infoPaneDefaultPx: 320,
      infoPaneMaxPx: null,
      maxSource: "windowWidth - 424 (min chat column) - sidebarWidth",
      minChatColumnPx: 424,
      sidebarCollapsedPx: 88,
      sidebarExpandedPx: 280,
      collapseThresholdPx: 244,
    },
    features: ["info-pane-width-follows-window"],
    transformations: ["info-pane-removes-fixed-480px-maximum"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-info-pane-split-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
