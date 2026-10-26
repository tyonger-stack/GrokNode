import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { parse } from "acorn";
import { buildAgentsListFadeRendererExtension } from "../scripts/lib/agents-list-fade-renderer-extension.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const CORE = "frontend/src/extensions/agents-list-fade-core.ts";
const ENTRY = "frontend/src/extensions/agents-list-fade-entry.ts";

async function bundleToTmp(entry, format) {
  const dir = await mkdtemp(path.join(tmpdir(), "agents-fade-"));
  const out = path.join(dir, "out.mjs");
  await build({
    entryPoints: [path.join(REPO, entry)],
    bundle: true,
    format,
    platform: "browser",
    target: "es2022",
    outfile: out,
    logLevel: "silent",
  });
  return { dir, out };
}

async function loadCore() {
  const { dir, out } = await bundleToTmp(CORE, "esm");
  try {
    return await import(out);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

/** Map-backed style stub so the writer's set/remove behaviour is asserted headlessly. */
function styleStub() {
  const map = new Map();
  return {
    map,
    setProperty: (name, value) => map.set(name, value),
    removeProperty: (name) => void map.delete(name),
  };
}

const BOTH_ON =
  "linear-gradient(to bottom, rgba(0, 0, 0, var(--scroll-fade-top-start-opacity)) 0px, black var(--scroll-fade-top-size), black calc(100% - var(--scroll-fade-bottom-size)), rgba(0, 0, 0, var(--scroll-fade-bottom-start-opacity)) 100%)";
const TOP_OFF =
  "linear-gradient(to bottom, rgba(0, 0, 0, var(--scroll-fade-top-start-opacity)) 0px, black 0px, black calc(100% - var(--scroll-fade-bottom-size)), rgba(0, 0, 0, var(--scroll-fade-bottom-start-opacity)) 100%)";

test("fade edges follow official's 5px boundary semantics", async () => {
  const core = await loadCore();
  // Official live state 2026-10-26: scrollTop 0, scrollHeight 1512, clientHeight 913.
  assert.deepEqual(core.fadeEdgesFor({ scrollTop: 0, scrollHeight: 1512, clientHeight: 913 }), { top: false, bottom: true });
  // Threshold is inclusive on the boundary: 5 still counts as at-top, 6 does not.
  assert.equal(core.fadeEdgesFor({ scrollTop: 5, scrollHeight: 1512, clientHeight: 913 }).top, false);
  assert.equal(core.fadeEdgesFor({ scrollTop: 6, scrollHeight: 1512, clientHeight: 913 }).top, true);
  // Bottom boundary mirrors it, also inclusive: within 5px of the end counts as
  // at-bottom, 6px shy does not.
  const atBottom = 1512 - 913;
  assert.deepEqual(core.fadeEdgesFor({ scrollTop: atBottom - 6, scrollHeight: 1512, clientHeight: 913 }), { top: true, bottom: true });
  assert.deepEqual(core.fadeEdgesFor({ scrollTop: atBottom - 5, scrollHeight: 1512, clientHeight: 913 }), { top: true, bottom: false });
  assert.deepEqual(core.fadeEdgesFor({ scrollTop: atBottom, scrollHeight: 1512, clientHeight: 913 }), { top: true, bottom: false });
  // Content that fits is at both boundaries: no edges, hence no mask at all.
  assert.deepEqual(core.fadeEdgesFor({ scrollTop: 0, scrollHeight: 400, clientHeight: 913 }), { top: false, bottom: false });
});

test("the mask string is byte-identical to official's block gradient", async () => {
  const core = await loadCore();
  // Both edges on: the exact string official writes when the list is scrolled
  // (live-verified on the official app as ... black 28px ... — here via the vars).
  assert.equal(core.blockFadeMaskImage({ top: true, bottom: true }), BOTH_ON);
  // Top collapsed (at top): official writes the literal 0px, live-verified as
  // "black 0px" while scrollTop=0.
  assert.equal(core.blockFadeMaskImage({ top: false, bottom: true }), TOP_OFF);
  // Bottom collapsed.
  assert.ok(core.blockFadeMaskImage({ top: true, bottom: false }).includes("black calc(100% - 0px)"));
  // No edges: official strips every mask property.
  assert.equal(core.blockFadeMaskImage({ top: false, bottom: false }), null);
});

test("the writer sets and strips exactly official's property set", async () => {
  const core = await loadCore();
  const style = styleStub();
  core.applyScrollFadeProperties(style, { top: false, bottom: true });
  assert.equal(style.map.get("mask-image"), TOP_OFF);
  assert.equal(style.map.get("-webkit-mask-image"), TOP_OFF);
  assert.equal(style.map.get("mask-size"), "100% 100%");
  assert.equal(style.map.get("mask-repeat"), "no-repeat");
  // The agents-list instance vars, live-verified on official's inline style.
  core.applyScrollFadeVars(style);
  assert.equal(style.map.get("--scroll-fade-top-size"), "28px");
  assert.equal(style.map.get("--scroll-fade-bottom-size"), "48px");
  assert.equal(style.map.get("--scroll-fade-top-start-opacity"), "0");
  assert.equal(style.map.get("--scroll-fade-bottom-start-opacity"), "0");
  // Stripping removes all six properties official's cleanup removes.
  style.map.set("mask-composite", "intersect");
  core.applyScrollFadeProperties(style, { top: false, bottom: false });
  assert.equal(style.map.size, 4); // only the four --scroll-fade vars remain
});

test("the entry drives a happy-dom viewport through the official state machine", async () => {
  const window = new Window();
  const previousDocument = globalThis.document;
  const previousMutationObserver = globalThis.MutationObserver;
  const previousRaf = globalThis.requestAnimationFrame;
  let rafCallback = null;
  globalThis.document = window.document;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.requestAnimationFrame = (cb) => {
    rafCallback = cb;
    return 1;
  };
  window.document.body.innerHTML =
    '<div class="sand-agents-list"><div class="ui-scroll-area__viewport"><div class="ui-scroll-area__content">' +
    '<div>avatar</div>'.repeat(12) +
    "</div></div></div>";
  const vp = window.document.querySelector(".ui-scroll-area__viewport");
  let scrollTop = 0;
  Object.defineProperty(vp, "scrollTop", { get: () => scrollTop, configurable: true });
  Object.defineProperty(vp, "scrollHeight", { get: () => 1512, configurable: true });
  Object.defineProperty(vp, "clientHeight", { get: () => 913, configurable: true });
  const { dir, out } = await bundleToTmp(ENTRY, "esm");
  try {
    await import(out);
    // Initial state (at top, official live-verified): top collapsed to 0px, bottom on.
    assert.equal(vp.style.getPropertyValue("--scroll-fade-top-size"), "28px");
    assert.equal(vp.style.getPropertyValue("--scroll-fade-bottom-size"), "48px");
    assert.ok(vp.style.getPropertyValue("mask-image").includes("black 0px"));
    assert.ok(vp.style.getPropertyValue("mask-image").includes("calc(100% - var(--scroll-fade-bottom-size))"));
    // Scroll down → the top edge turns on (rAF-batched).
    scrollTop = 40;
    vp.dispatchEvent(new window.Event("scroll"));
    assert.ok(rafCallback != null, "scroll schedules a frame");
    rafCallback?.();
    assert.ok(vp.style.getPropertyValue("mask-image").includes("black var(--scroll-fade-top-size)"));
    // Scroll to the bottom → the TOP edge stays on (content above) while the bottom
    // collapses to the literal 0px — official's exact behaviour at the lower boundary.
    scrollTop = 1512 - 913;
    vp.dispatchEvent(new window.Event("scroll"));
    rafCallback?.();
    const atBottomMask = vp.style.getPropertyValue("mask-image");
    assert.ok(atBottomMask.includes("black var(--scroll-fade-top-size)"), atBottomMask);
    assert.ok(atBottomMask.includes("calc(100% - 0px)"), atBottomMask);
    // Content that fits the viewport → both edges off → every mask property stripped,
    // the same removal official's ac() performs; the vars survive.
    scrollTop = 0;
    Object.defineProperty(vp, "scrollHeight", { get: () => 400, configurable: true });
    vp.dispatchEvent(new window.Event("scroll"));
    rafCallback?.();
    assert.equal(vp.style.getPropertyValue("mask-image"), "");
    assert.equal(vp.style.getPropertyValue("mask-repeat"), "");
    assert.equal(vp.style.getPropertyValue("--scroll-fade-top-size"), "28px");
  } finally {
    void rm(dir, { recursive: true, force: true });
    globalThis.document = previousDocument;
    globalThis.MutationObserver = previousMutationObserver;
    globalThis.requestAnimationFrame = previousRaf;
  }
});

test("the renderer extension builds with its runtime literals intact", async () => {
  const text = await buildAgentsListFadeRendererExtension();
  // Real-parse the IIFE like the other extension guards — string assertions cannot
  // catch a broken bundle.
  assert.doesNotThrow(() => parse(text, { ecmaVersion: "latest" }));
  for (const marker of ["--scroll-fade-top-size", "--scroll-fade-bottom-size", "ui-scroll-area__viewport", "sand-agents-list"]) {
    assert.ok(text.includes(marker), marker);
  }
  // Byte-anchor: the official gradient's variable references appear verbatim.
  assert.ok(text.includes("var(--scroll-fade-top-start-opacity)"));
  assert.ok(text.includes("calc(100% - "));
});
