import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
const out = mkdtempSync(path.resolve("node_modules/.cache/library-gates-"));
test.after(() => rmSync(out, { recursive: true, force: true }));
await build({entryPoints:[path.resolve("source/shared/library/feature-gates.ts")],bundle:true,platform:"node",format:"esm",outfile:path.join(out,"gates.mjs"),logLevel:"silent"});
await build({entryPoints:[path.resolve("source/electron-main/adapters/production-experiments-binding.ts")],bundle:true,platform:"node",format:"esm",external:["electron"],outfile:path.join(out,"binding.mjs"),logLevel:"silent"});
const gates = await import(path.join(out,"gates.mjs"));
const binding = await import(path.join(out,"binding.mjs"));
test("all four modern Library branches default available through the production gate API", async () => {
  const service = await binding.createElectronProductionExperimentsBinding().create();
  try {
    for (const name of gates.LIBRARY_FEATURE_GATES) assert.equal(service.checkFeatureGate(name), true);
    assert.equal(service.checkFeatureGate("unknown_gate"), false);
  } finally { await service.dispose(); }
});
test("standard experiment overrides still win over Node Library defaults", () => {
  assert.equal(gates.resolveLibraryFeatureGate("grok_bot_library_v2", { SAND_FEATURE_GATE_OVERRIDES: "grok_bot_library_v2=0" }), false);
  assert.equal(gates.resolveLibraryFeatureGate("grok_bot_library_pages", { SAND_FEATURE_GATE_OVERRIDES: "grok_bot_library_pages=true" }), true);
});
test("Node user config supports all and individual gates without inventing upstream rollout", () => {
  assert.equal(gates.resolveLibraryFeatureGate("grok_bot_documents_ui", { SAND_LIBRARY_FEATURE_GATES: "all=1,documents=0" }), false);
  assert.equal(gates.resolveLibraryFeatureGate("grok_bot_library_external_docs", { SAND_LIBRARY_FEATURE_GATES: "external_docs=off" }), false);
  assert.equal(gates.resolveLibraryFeatureGate("grok_bot_library_v2", { SAND_LIBRARY_FEATURE_GATES: "unknown=0" }), true);
});
test("every independent Node gate combination resolves from one comma config", () => {
  const aliases = ["v2", "pages", "documents", "external_docs"];
  for (let mask = 0; mask < 16; mask += 1) {
    const raw = gates.LIBRARY_FEATURE_GATES.map((name, index) => `${aliases[index]}=${(mask & (1 << index)) === 0 ? "0" : "1"}`).join(",");
    for (const [index, name] of gates.LIBRARY_FEATURE_GATES.entries()) {
      assert.equal(gates.resolveLibraryFeatureGate(name, { SAND_LIBRARY_FEATURE_GATES: raw }), (mask & (1 << index)) !== 0, `${raw} ${name}`);
    }
  }
});
test("generic override parsing matches established malformed comma semantics", () => {
  assert.equal(gates.resolveLibraryFeatureGate("grok_bot_library_v2", { SAND_FEATURE_GATE_OVERRIDES: " other=0 , grok_bot_library_v2 = off " }), false);
  assert.equal(gates.resolveLibraryFeatureGate("grok_bot_library_pages", { SAND_FEATURE_GATE_OVERRIDES: "grok_bot_library_pages" }), false);
  assert.equal(gates.resolveLibraryFeatureGate("grok_bot_documents_ui", { SAND_FEATURE_GATE_OVERRIDES: "other=1" }), true);
});
test("the local snapshot remains empty while direct gate queries expose Node branches", async () => {
  const service = await binding.createElectronProductionExperimentsBinding().create();
  try {
    assert.deepEqual(service.getSnapshot(), {});
    assert.equal(service.checkFeatureGate("grok_bot_library_v2"), true);
    assert.equal(service.checkFeatureGate("not_a_registered_original_gate"), false);
  } finally { await service.dispose(); }
});
