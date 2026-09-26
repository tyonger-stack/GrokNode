import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyOriginalRendererExtraI18n,
  patchExtraFile,
  EXTRA_I18N_FILES,
} from "../scripts/lib/extra-i18n-patch.mjs";

const NL = String.fromCharCode(10);

function stageSourceFor(entry) {
  const rows = entry.pairs.map((pair) => "x({title:" + JSON.stringify(pair[0]) + "})");
  for (const anchor of entry.anchors) rows.unshift("const probe=" + JSON.stringify(anchor) + ";");
  return rows.join(NL);
}

test("extra-i18n patch appends prelude and branches pair literals per file", async () => {
  for (const entry of EXTRA_I18N_FILES) {
    const { patched, applied } = patchExtraFile(stageSourceFor(entry), entry);
    assert.equal(applied.length, entry.pairs.length, entry.file);
    for (const row of applied) assert.ok(row.hits >= 1, entry.file + " :: " + row.en);
    assert.ok(patched.includes("function RLocT("), entry.file);
    for (const anchor of entry.anchors) assert.ok(patched.includes(anchor), entry.file);
  }
});

test("extra-i18n patch restricts risky pairs to display positions", async () => {
  const entry = { file: "synthetic.js", anchors: ["syn-anchor"], pairs: [["Cancel", "ZH-Cancel", "dEgA5A", "PROP"]], gaps: [] };
  const src = ["const probe=syn-anchor;", "x({title:" + JSON.stringify("Cancel") + "});", "y=s?" + JSON.stringify("Cancel") + ":z;"].join(NL);
  const { patched } = patchExtraFile(src, entry);
  assert.ok(patched.includes("(RLocT(" + JSON.stringify("Cancel") + "," + JSON.stringify("ZH-Cancel") + "))"));
  assert.ok(patched.includes("y=s?" + JSON.stringify("Cancel") + ":z;"), "ternary branch must stay raw in PROP mode");
});

test("extra-i18n patch is fail-closed when a pair anchor is missing", async () => {
  const entry = { file: "synthetic.js", anchors: ["syn-anchor"], pairs: [["Nope Missing", "X", "dEgA5A", "FULL"]], gaps: [] };
  assert.throws(() => patchExtraFile("const probe=syn-anchor;", entry), /has no anchor/);
});

test("extra-i18n tables are 0.58-sourced, mode-shaped and gap-disjoint", async () => {
  const idChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-";
  let total = 0;
  assert.ok(EXTRA_I18N_FILES.length >= 10, "must cover the extra surfaces");
  for (const entry of EXTRA_I18N_FILES) {
    assert.ok(entry.anchors.length >= 1, entry.file);
    const seen = new Set();
    for (const [en, zh, id, mode] of entry.pairs) {
      assert.ok(typeof en === "string" && en.length > 0, entry.file);
      assert.ok(typeof zh === "string" && zh.length > 0, entry.file + " " + id);
      assert.ok(!zh.includes(String.fromCharCode(34)), entry.file + " " + id);
      assert.ok(!seen.has(en), entry.file + " duplicate: " + en);
      seen.add(en);
      assert.ok(id.length >= 5 && id.length <= 8, entry.file + " " + id);
      for (const ch of id) assert.ok(idChars.includes(ch), entry.file + " " + id);
      assert.ok(mode === "FULL" || mode === "PROP" || mode === "PROP_COLON", entry.file + " " + mode);
      total += 1;
    }
    for (const [gap] of entry.gaps) assert.ok(!seen.has(gap), entry.file + " gap listed as pair: " + gap);
  }
  assert.ok(total >= 100, "must carry a full extra-surface table");
});

test("extra-i18n stage application writes provenance per file", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "extra-i18n-"));
  try {
    const assetsDir = path.join(tmp, "dist/renderer/assets");
    await mkdir(assetsDir, { recursive: true });
    for (const [index, entry] of EXTRA_I18N_FILES.entries()) {
      await writeFile(path.join(assetsDir, "chunk-" + index + ".js"), stageSourceFor(entry));
    }
    const result = await applyOriginalRendererExtraI18n({ stageRoot: tmp });
    assert.equal(result.mode, "original-renderer-extra-i18n");
    assert.equal(result.chunks.length, EXTRA_I18N_FILES.length);
    for (const chunk of result.chunks) {
      assert.equal(chunk.role, "extra-surface");
      assert.ok(chunk.pairsApplied > 0);
      assert.ok(chunk.totalReplacements > 0);
      assert.ok(/^[0-9a-f]{64}$/.test(chunk.original.sha256));
      assert.ok(/^[0-9a-f]{64}$/.test(chunk.patched.sha256));
    }
    const onDisk = JSON.parse(await readFile(path.join(tmp, "dist/renderer-extra-i18n-extension.json"), "utf8"));
    assert.equal(onDisk.mode, "original-renderer-extra-i18n");
    assert.equal(onDisk.chunks.length, EXTRA_I18N_FILES.length);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("extra-i18n stage application rejects ambiguous anchors", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "extra-i18n-"));
  try {
    await mkdir(path.join(tmp, "dist/renderer/assets"), { recursive: true });
    const first = EXTRA_I18N_FILES[0];
    await writeFile(path.join(tmp, "dist/renderer/assets/a.js"), stageSourceFor(first));
    await writeFile(path.join(tmp, "dist/renderer/assets/b.js"), stageSourceFor(first));
    await assert.rejects(applyOriginalRendererExtraI18n({ stageRoot: tmp }), /Expected one chunk/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
