import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyOriginalRendererMainI18n,
  patchOriginalMainI18n,
  MAIN_I18N_PAIRS,
  MAIN_I18N_GAPS,
} from "../scripts/lib/main-i18n-patch.mjs";

const NL = String.fromCharCode(10);

// Synthetic main-shell slice. Every pair EN literal is embedded once as a
// title attribute so the test proves each row applies; extra lines pin the
// mode restrictions (logic positions must stay raw).
function baseSource() {
  const rows = MAIN_I18N_PAIRS.map((pair) => "x({title:" + JSON.stringify(pair[0]) + "})");
  rows.unshift("const anchor=sand.navigateBack;");
  rows.push("y=s?" + JSON.stringify("Cancel") + ":z;");
  rows.push("d={46:" + JSON.stringify("Delete") + "};");
  return rows.join(NL);
}

test("main-i18n patch appends prelude and branches every pair literal", async () => {
  const { patched, applied } = patchOriginalMainI18n(baseSource());
  assert.equal(applied.length, MAIN_I18N_PAIRS.length);
  for (const row of applied) assert.ok(row.hits >= 1, "pair must hit at least once: " + row.en);
  assert.ok(patched.includes("function RLocFromPref("), "locale resolver must be appended");
  assert.ok(patched.includes("function RLocT("), "branch helper must be appended");
  assert.ok(patched.includes("location.reload"), "language flip must reload the renderer");
  assert.ok(patched.includes("sand.navigateBack"), "discovery anchor must survive");
  assert.ok(patched.includes('(RLocT("General","通用"))'), "General must branch to 0.58 wording");
  const prelude = patched.slice(patched.indexOf("function RLocFromPref("));
  assert.ok(!prelude.includes("(RLocT("), "prelude itself must not contain branch calls");
});

test("main-i18n patch restricts risky pairs to display positions", async () => {
  const { patched } = patchOriginalMainI18n(baseSource());
  assert.ok(patched.includes('y=s?"Cancel":z;'), "PROP-only Cancel must leave ternary branches raw");
  assert.ok(!patched.includes('y=s?(RLocT("Cancel",'), "PROP-only Cancel must not branch ternaries");
  assert.ok(patched.includes('d={46:"Delete"};'), "digit-key map values must stay raw");
});

test("main-i18n patch is fail-closed when a pair anchor is missing", async () => {
  assert.throws(() => patchOriginalMainI18n("const anchor=sand.navigateBack;"), /has no anchor/);
});

test("main-i18n pair table is 0.58-sourced, mode-shaped and gap-disjoint", async () => {
  const idChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-";
  const seen = new Set();
  for (const [en, zh, id, mode] of MAIN_I18N_PAIRS) {
    assert.ok(typeof en === "string" && en.length > 0, "EN must be non-empty");
    assert.ok(typeof zh === "string" && zh.length > 0, "ZH must be non-empty, id=" + id);
    assert.ok(!zh.includes(String.fromCharCode(34)), "ZH must not contain quotes: " + id);
    assert.ok(!seen.has(en), "duplicate EN entry: " + en);
    seen.add(en);
    assert.ok(id.length >= 5 && id.length <= 8, "unexpected id shape: " + id);
    for (const ch of id) assert.ok(idChars.includes(ch), "unexpected id char in " + id);
    assert.ok(mode === "FULL" || mode === "PROP" || mode === "PROP_COLON", "unexpected mode: " + mode);
  }
  assert.ok(MAIN_I18N_PAIRS.length >= 300, "pair table must cover the main surface");
  for (const [gap] of MAIN_I18N_GAPS) assert.ok(!seen.has(gap), "gap listed as pair: " + gap);
  const modes = new Set(MAIN_I18N_PAIRS.map((row) => row[3]));
  assert.ok(modes.has("PROP") && modes.has("PROP_COLON"), "restricted modes must be present");
});

test("main-i18n stage application writes provenance", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "main-i18n-"));
  try {
    const assetsDir = path.join(tmp, "dist/renderer/assets");
    await mkdir(assetsDir, { recursive: true });
    await writeFile(path.join(assetsDir, "index-FAKE.js"), baseSource());
    const result = await applyOriginalRendererMainI18n({ stageRoot: tmp });
    assert.equal(result.mode, "original-renderer-main-i18n");
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].role, "main-shell");
    assert.ok(result.chunks[0].pairsApplied >= 300);
    assert.ok(result.chunks[0].totalReplacements > 0);
    assert.ok(/^[0-9a-f]{64}$/.test(result.chunks[0].original.sha256));
    assert.ok(/^[0-9a-f]{64}$/.test(result.chunks[0].patched.sha256));
    assert.ok(Array.isArray(result.gaps) && result.gaps.length > 0);
    const onDisk = JSON.parse(await readFile(path.join(tmp, "dist/renderer-main-i18n-extension.json"), "utf8"));
    assert.equal(onDisk.mode, "original-renderer-main-i18n");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("main-i18n stage application rejects ambiguous chunks", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "main-i18n-"));
  try {
    await mkdir(path.join(tmp, "dist/renderer/assets"), { recursive: true });
    await writeFile(path.join(tmp, "dist/renderer/assets/x.js"), "const anchor=sand.navigateBack;");
    await writeFile(path.join(tmp, "dist/renderer/assets/y.js"), "const anchor=sand.navigateBack;");
    await assert.rejects(applyOriginalRendererMainI18n({ stageRoot: tmp }), /Expected one main shell chunk/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
