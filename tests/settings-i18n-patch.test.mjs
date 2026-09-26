import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyOriginalRendererSettingsI18n,
  patchOriginalSettingsI18n,
  SETTINGS_I18N_PAIRS,
  SETTINGS_I18N_GAPS,
} from "../scripts/lib/settings-i18n-patch.mjs";

const NL = String.fromCharCode(10);

// Synthetic upstream Settings panel slice. Every pair EN literal is embedded
// once as a title attribute so the test proves each row applies; the pa
// anchor and the Sa slot mirror the minified shapes in 0.18
// index-BlqerJhg.js without depending on the gitignored staged bundle.
function baseSource() {
  const rows = SETTINGS_I18N_PAIRS.map((pair) => "x({title:" + JSON.stringify(pair[0]) + "})");
  rows.unshift("function pa(){return a.jsx(re,{})}");
  rows.push("l=a.jsx(pa,{}),r=null,i=a.jsx(oa,{}),o=a.jsx(va,{})");
  return rows.join(NL);
}

test("settings-i18n patch inserts prelude and branches every pair literal", async () => {
  const { patched, applied } = patchOriginalSettingsI18n(baseSource());
  assert.equal(applied.length, SETTINGS_I18N_PAIRS.length);
  for (const row of applied) assert.equal(row.hits, 1, "pair must hit exactly once in fixture: " + row.en);
  assert.ok(patched.includes("function RLocFromPref("), "locale resolver must be inserted");
  assert.ok(patched.includes("function RLocT("), "branch helper must be inserted");
  assert.ok(patched.includes("location.reload"), "language flip must reload the renderer");
  assert.ok(patched.includes("function pa(){"), "pa anchor must survive for the language patch");
  assert.ok(
    patched.includes("l=a.jsx(pa,{}),r=null,i=a.jsx(oa,{}),o=a.jsx(va,{})"),
    "Sa slot must stay untouched so the language patch still applies after",
  );
  assert.ok(patched.includes('(RLocT("Appearance","外观"))'), "Appearance must branch to 0.58 wording");
  assert.ok(!patched.includes('title:"Appearance"'), "raw Appearance title must be gone");
  assert.ok(
    patched.includes("(RLocT(" + JSON.stringify("You're up to date") + "," + JSON.stringify("已是最新版本") + "))"),
    "escaped-apostrophe literals must match their raw source form",
  );
  const prelude = patched.slice(0, patched.indexOf("function pa(){"));
  assert.ok(!prelude.includes("(RLocT("), "prelude itself must not contain branch calls");
});

test("settings-i18n patch is fail-closed when a pair anchor is missing", async () => {
  assert.throws(() => patchOriginalSettingsI18n("function pa(){return null}"), /has no anchor/);
  assert.throws(() => patchOriginalSettingsI18n("const x=1;"), /Settings anchor is missing/);
});

test("settings-i18n pair table is 0.58-sourced and gap-disjoint", async () => {
  const idChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-";
  const seen = new Set();
  for (const [en, zh, id] of SETTINGS_I18N_PAIRS) {
    assert.ok(typeof en === "string" && en.length > 0, "EN must be non-empty");
    assert.ok(typeof zh === "string" && zh.length > 0, "ZH must be non-empty, id=" + id);
    assert.ok(!seen.has(en), "duplicate EN entry: " + en);
    seen.add(en);
    assert.ok(id.length >= 5 && id.length <= 8, "unexpected id shape: " + id);
    for (const ch of id) assert.ok(idChars.includes(ch), "unexpected id char in " + id);
  }
  assert.ok(SETTINGS_I18N_PAIRS.length >= 60, "pair table must cover the Settings surface");
  for (const gap of SETTINGS_I18N_GAPS) assert.ok(!seen.has(gap), "gap listed as pair: " + gap);
});

test("settings-i18n stage application writes provenance", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "settings-i18n-"));
  try {
    const assetsDir = path.join(tmp, "dist/renderer/assets");
    await mkdir(assetsDir, { recursive: true });
    await writeFile(path.join(assetsDir, "index-FAKE.js"), baseSource());
    const result = await applyOriginalRendererSettingsI18n({ stageRoot: tmp });
    assert.equal(result.mode, "original-renderer-settings-i18n");
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].role, "settings-panel");
    assert.ok(result.chunks[0].pairsApplied >= 60);
    assert.ok(result.chunks[0].totalReplacements > 0);
    assert.ok(/^[0-9a-f]{64}$/.test(result.chunks[0].original.sha256));
    assert.ok(/^[0-9a-f]{64}$/.test(result.chunks[0].patched.sha256));
    assert.ok(Array.isArray(result.gaps) && result.gaps.length > 0);
    const onDisk = JSON.parse(await readFile(path.join(tmp, "dist/renderer-settings-i18n-extension.json"), "utf8"));
    assert.equal(onDisk.mode, "original-renderer-settings-i18n");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("settings-i18n stage application rejects ambiguous chunks", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "settings-i18n-"));
  try {
    await mkdir(path.join(tmp, "dist/renderer/assets"), { recursive: true });
    await writeFile(path.join(tmp, "dist/renderer/assets/x.js"), "function pa(){}");
    await assert.rejects(applyOriginalRendererSettingsI18n({ stageRoot: tmp }), /Expected one Settings panel chunk/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
