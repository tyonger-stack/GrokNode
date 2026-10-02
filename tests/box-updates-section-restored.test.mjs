import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Guard test for the RESTORED "Grok Bot's Computer" (box Update/Reset) section.
// It was removed on 2026-10-01 (b37a3cb) as a misclick guard during the
// silent-host-swap incident, and restored on 2026-10-02: the in-box agent
// reference docs (box-reference-docs.ts) direct users to "Update Grok Bot's
// Computer" as the data-preserving recovery action for a wedged box, so hiding
// it stranded that guidance. Safe now because the local-docker connector's
// recreate is a plain container restart (same pinned digest, same bind-mounted
// host) and forceRecreate rebuilds from LOCAL_DOCKER_BOX_IMAGE_DIGEST — no
// moving tag anywhere on the path. Mutation-tested: re-adding the vKn stub or
// re-introducing the main-edge refusal must turn these red.

const PATCH_PATH = new URL("../scripts/lib/router-renderer-patch.mjs", import.meta.url).pathname;
const MAIN_EDGE_PATH = new URL("../source/electron-main/main-edge.ts", import.meta.url).pathname;

test("the renderer patch no longer stubs the box updates section", () => {
  const source = readFileSync(PATCH_PATH, "utf8");
  assert.ok(!source.includes("patchOriginalBoxUpdatesSection"), "the vKn stub must stay deleted");
  assert.ok(!source.includes("_vKnRemoved"), "the unreachable-inner-function trick must stay deleted");
  assert.ok(!source.includes("box-updates-section-removed"), "provenance must not claim the removal anymore");
  assert.ok(!source.includes("remove-box-updates-section"), "the removal transform must not be recorded");
});

test("main-edge routes updateComputer back through recreateComputer", () => {
  const source = readFileSync(MAIN_EDGE_PATH, "utf8");
  const idx = source.indexOf("updateComputer:");
  assert.ok(idx > 0, "updateComputer handler must exist");
  const end = source.indexOf("},", idx);
  const block = source.slice(idx, end > 0 ? end : idx + 600);
  assert.ok(block.includes("recreateComputer"), "the handler must reach the connector recreate path again");
  assert.ok(block.includes("preserveData: true"), "Update stays the data-preserving recovery action");
  assert.ok(!block.includes("disabled in this reconstructed build"), "the refusal must stay gone");
  assert.ok(!/throw new Error\("Computer updates/.test(block), "the handler must not refuse");
});

test("the updateForeverBox fallback stays wired for dev/remote connectors", () => {
  const source = readFileSync(MAIN_EDGE_PATH, "utf8");
  const idx = source.indexOf("updateComputer:");
  const block = source.slice(idx, idx + 900);
  assert.ok(block.includes("dev-fallback"), "the dev-fallback branch must survive (unreachable on local-docker, used by dev setups)");
  assert.ok(block.includes("updateForeverBox"), "the fallback leg must stay wired");
});
