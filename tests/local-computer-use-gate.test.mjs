import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const out = mkdtempSync(path.resolve("node_modules/.cache/local-computer-use-gate-"));
test.after(() => rmSync(out, { recursive: true, force: true }));

await build({
  entryPoints: [path.resolve("source/shared/node/port-0721-features.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(out, "local-0721-features.mjs"),
  logLevel: "silent",
});
await build({
  entryPoints: [path.resolve("source/electron-main/computer-use/local-computer-use-gate.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(out, "gate.mjs"),
  logLevel: "silent",
});

const features = await import(path.join(out, "local-0721-features.mjs"));
const gate = await import(path.join(out, "gate.mjs"));

test("sand_enable_local_cua is a locally resolvable feature gate", () => {
  assert.equal(features.resolveLocal0721Feature("sand_enable_local_cua", {}), true);
  assert.equal(features.resolveLocal0721Feature("sand_enable_local_cua", { GROK_NODE_0721_FEATURES: "0" }), false);
  assert.equal(
    features.resolveLocal0721Feature("sand_enable_local_cua", { SAND_FEATURE_GATE_OVERRIDES: "sand_enable_local_cua=0" }),
    false,
  );
  assert.equal(features.local0721FeatureSnapshot({})["sand_enable_local_cua"], true);
});

test("the marker file carries the official isOn wire shape", () => {
  const markerPath = path.join(out, "marker", "local-computer-use-gate.json");
  gate.writeLocalComputerUseGateSync(true, markerPath);
  assert.deepEqual(JSON.parse(readFileSync(markerPath, "utf8")), { isOn: true });
  assert.equal(statSync(markerPath).mode & 0o777, 0o600);
  assert.deepEqual(gate.readLocalComputerUseGate(markerPath), { isOn: true });

  gate.writeLocalComputerUseGateSync(false, markerPath);
  assert.deepEqual(gate.readLocalComputerUseGate(markerPath), { isOn: false });
});

test("an absent or damaged marker reads back as gate off", () => {
  assert.deepEqual(gate.readLocalComputerUseGate(path.join(out, "does-not-exist.json")), { isOn: false });

  const damagedPath = path.join(out, "damaged.json");
  writeFileSync(damagedPath, "{ not json");
  assert.deepEqual(gate.readLocalComputerUseGate(damagedPath), { isOn: false });

  const wrongShapePath = path.join(out, "wrong-shape.json");
  writeFileSync(wrongShapePath, JSON.stringify({ isOn: "yes" }));
  assert.deepEqual(gate.readLocalComputerUseGate(wrongShapePath), { isOn: false });
});

test("the marker filename matches the official helper contract", () => {
  assert.equal(gate.LOCAL_COMPUTER_USE_GATE_FILENAME, "local-computer-use-gate.json");
  assert.equal(gate.LOCAL_COMPUTER_USE_GATE_NAME, "sand_enable_local_cua");
});

test("publishing writes the marker up front and again on every gate change", () => {
  const markerPath = path.join(out, "published", "local-computer-use-gate.json");
  let isOn = true;
  const listeners = new Set();
  const source = {
    checkFeatureGate: (name) => {
      assert.equal(name, "sand_enable_local_cua");
      return isOn;
    },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const failures = [];
  const publisher = gate.publishLocalComputerUseGate(source, (area, leg, error) => failures.push([area, leg, error]), markerPath);
  try {
    assert.deepEqual(JSON.parse(readFileSync(markerPath, "utf8")), { isOn: true });

    isOn = false;
    for (const listener of listeners) listener();
    assert.deepEqual(JSON.parse(readFileSync(markerPath, "utf8")), { isOn: false });

    isOn = true;
    for (const listener of listeners) listener();
    assert.deepEqual(JSON.parse(readFileSync(markerPath, "utf8")), { isOn: true });
    assert.deepEqual(failures, []);
  } finally {
    publisher.dispose();
  }
  assert.equal(listeners.size, 0);
});

test("a marker write failure is reported instead of thrown", () => {
  const failures = [];
  const blockedRoot = path.join(out, "blocked-root");
  writeFileSync(blockedRoot, "not a directory");
  const publisher = gate.publishLocalComputerUseGate(
    { checkFeatureGate: () => true, subscribe: () => () => {} },
    (area, leg, error) => failures.push([area, leg, error]),
    path.join(blockedRoot, "local-computer-use-gate.json"),
  );
  try {
    assert.equal(failures.length, 1);
    assert.equal(failures[0][0], "local-exec");
    assert.equal(failures[0][1], "marker-write");
  } finally {
    publisher.dispose();
  }
});
