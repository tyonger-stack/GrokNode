import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { patchOriginalBoxUpdatesSection } from "../scripts/lib/router-renderer-patch.mjs";

// Guard test for the "Grok Bot's Computer" (box Update/Reset) section removal.
// The main-edge refusal of `updateComputer` is the hard block; this renderer
// patch removes the misclickable cards. Mutation-tested by design: removing
// either side (the patch or the refusal) makes a check here or in the
// local-docker-host-identity suite go red.

const PATCH_PATH = new URL("../scripts/lib/router-renderer-patch.mjs", import.meta.url).pathname;
const MAIN_EDGE_PATH = new URL("../source/electron-main/main-edge.ts", import.meta.url).pathname;

const ANCHOR = 'function vKn(n){const e=he.c(53)';

test("the box updates section patch stubs vKn to null before its original body", () => {
  const source = `x${ANCHOR},{isUpdateBoxPending:t}})y`;
  const patched = patchOriginalBoxUpdatesSection(source);
  assert.ok(patched.startsWith("xfunction vKn(n){return null;"), "vKn must return null immediately");
  assert.ok(patched.includes("_vKnRemoved"), "original body must be preserved inside an unreachable inner function");
  assert.ok(patched.endsWith("y"), "nothing after the anchor may be dropped");
});

test("the patch anchor is missing → fail closed", () => {
  assert.throws(() => patchOriginalBoxUpdatesSection("no anchor here"), /anchor is missing or ambiguous/);
});

test("main-edge still refuses updateComputer (belt to the renderer suspenders)", () => {
  const source = readFileSync(MAIN_EDGE_PATH, "utf8");
  const idx = source.indexOf("updateComputer:");
  assert.ok(idx > 0, "updateComputer handler must exist");
  const block = source.slice(idx, source.indexOf("}", source.indexOf("throw", idx)) + 1);
  assert.match(block, /disabled in this reconstructed build/, "refusal message must stay");
  assert.ok(!block.includes("recreateComputer"), "the handler must not recreate the computer anymore");
});

test("the shared-chunk anchor is registered in the apply loop", () => {
  const source = readFileSync(PATCH_PATH, "utf8");
  assert.match(source, /boxUpdatesCandidates\.length !== 1/, "fail-closed candidate scan must stay");
  assert.match(source, /patchOriginalBoxUpdatesSection/, "the transform must be wired into applyOriginalRendererRouterPatch");
  assert.match(source, /remove-box-updates-section/, "provenance transformations must record the removal");
});
