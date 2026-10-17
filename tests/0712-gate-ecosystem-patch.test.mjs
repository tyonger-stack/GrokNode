import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

import {
  GATE_NAMES,
  GATES_PINNED_ON,
  insert0712GateEcosystem,
} from "../scripts/lib/0712-gate-ecosystem-patch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TABLE_FIXTURE = `var FLAGS = {
  sand_get_grok_bot_ios: {
    client: true,
    default: false
  },
  sand_usage_page: {
    client: true,
    default: false
  }
};
`;

async function loadInventory() {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "0712-gate-ecosystem-inventory.test.js");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, "source/shared/node/grok-bot-0712-gate-ecosystem.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
  });
  return import(`${outfile}?t=${Date.now()}`);
}

test("insert0712GateEcosystem inserts every gate once and is idempotent", () => {
  const first = insert0712GateEcosystem(TABLE_FIXTURE);
  assert.equal(first.applied, true, first.reason);
  for (const name of GATE_NAMES) {
    assert.match(first.text, new RegExp(`${name}: \\{\\n {4}client: true,\\n {4}default: (true|false)\\n {2}\\}`));
  }
  for (const name of GATES_PINNED_ON) {
    assert.match(
      first.text,
      new RegExp(`${name}: \\{\\n {4}client: true,\\n {4}default: true\\n {2}\\}`),
      `${name} must pin default true`,
    );
  }
  // Documents cluster must stay fail-closed.
  for (const name of ["grok_bot_documents_ui", "grok_bot_pages_search", "grok_bot_canvas_design_mode", "grok_bot_library_pages"]) {
    assert.match(
      first.text,
      new RegExp(`${name}: \\{\\n {4}client: true,\\n {4}default: false\\n {2}\\}`),
      `${name} must stay default false`,
    );
  }
  const second = insert0712GateEcosystem(first.text);
  assert.equal(second.applied, false);
  assert.equal(second.reason, "already-present");
  assert.equal((second.text.match(/grok_bot_multiplayer: \{/g) ?? []).length, 1);
});

test("insert0712GateEcosystem fails closed when the anchor is missing or ambiguous", () => {
  const missing = insert0712GateEcosystem("var FLAGS = {};");
  assert.deepEqual({ applied: missing.applied, reason: missing.reason }, { applied: false, reason: "anchor-missing" });
  const entry = "  sand_usage_page: {\n    client: true,\n    default: false\n  },";
  const ambiguous = insert0712GateEcosystem(`var FLAGS = {\n${entry}\n${entry}\n};`);
  assert.equal(ambiguous.applied, false);
  assert.match(ambiguous.reason, /^anchor-ambiguous:/);
});

test("inventory module Statsig hashes match the documented djb2 values", async () => {
  const inv = await loadInventory();
  for (const gate of inv.GROK_BOT_0712_GATE_ECOSYSTEM) {
    assert.equal(inv.statsigDjb2(gate.name), gate.statsigHash, `${gate.name} hash drift`);
    assert.equal(gate.pinnedDefault, gate.statsigValue, `${gate.name} pin must mirror Statsig evidence`);
    assert.equal(gate.upstreamDefault, false, `${gate.name} upstream FLAGS default is always false`);
  }
  assert.deepEqual([...inv.GROK_BOT_0712_GATES_PINNED_ON].sort(), [...GATES_PINNED_ON].sort());
  assert.equal(inv.GROK_BOT_0712_GATE_NAMES.length, GATE_NAMES.length);
});

test("pinned-on set is exactly multiplayer + draft_revision_highlight", () => {
  assert.deepEqual([...GATES_PINNED_ON].sort(), ["grok_bot_draft_revision_highlight", "grok_bot_multiplayer"].sort());
});

test("the patch really lands on the pristine host bundle, and the result still parses", { skip: !existsSync(path.join(repoRoot, "src", "app", "dist", "host", "host-main.cjs")) }, () => {
  const pristine = path.join(repoRoot, "src", "app", "dist", "host", "host-main.cjs");
  const result = insert0712GateEcosystem(readFileSync(pristine, "utf8"));
  assert.equal(result.applied, true, `the pristine bundle must match an anchor, got ${result.reason}`);
  for (const name of GATE_NAMES) {
    assert.equal((result.text.match(new RegExp(`${name}: \\{`, "g")) ?? []).length, 1, `${name} must appear once as a FLAGS entry`);
  }
  const outfile = path.join(repoRoot, "node_modules", ".cache", "0712-gate-ecosystem-patched-host.cjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  writeFileSync(outfile, result.text);
  execFileSync(process.execPath, ["--check", outfile], { stdio: "pipe" });
});

test("INSERT source keeps documents/pages/canvas off and does not invent true defaults", async () => {
  const patchSource = readFileSync(path.join(repoRoot, "scripts/lib/0712-gate-ecosystem-patch.mjs"), "utf8");
  // Fail-loud if someone rewrites the insert block to enable a Statsig-false gate.
  assert.match(patchSource, /grok_bot_documents_ui: \{\n    client: true,\n    default: false\n  \}/);
  assert.match(patchSource, /grok_bot_pages_search: \{\n    client: true,\n    default: false\n  \}/);
  assert.match(patchSource, /grok_bot_canvas_design_mode: \{\n    client: true,\n    default: false\n  \}/);
  assert.doesNotMatch(patchSource, /grok_bot_documents_ui: \{\n    client: true,\n    default: true\n  \}/);
  assert.match(patchSource, /grok_bot_multiplayer: \{\n    client: true,\n    default: true\n  \}/);
});
