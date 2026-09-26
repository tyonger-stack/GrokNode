import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { applyOriginalRendererLanguagePatch } from "../scripts/lib/language-renderer-patch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Synthesise the upstream renderer slice we care about: `function pa(){...}` is
// the Appearance renderer; `Sa(s)` is the General settings shell that mounts
// the four section slots. The injected `RLangSection` lands in slot `r`.
const baseSource = [
  'const dummy="intentionally avoiding the anchor";',
  "function pa(){return a.jsx(re,{title:\"Appearance\"})}",
  'function Sa(s){const e=H.c(9);let l,r,i,o;',
  "e[3]===Symbol.for(\"react.memo_cache_sentinel\")?(l=a.jsx(pa,{}),r=null,i=a.jsx(oa,{}),o=a.jsx(va,{}),e[3]=l,e[4]=r,e[5]=i,e[6]=o):(l=e[3],r=e[4]);",
  "return l}",
].join("\n");

test("language patch anchors against the upstream Settings panel chunk", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "lang-patch-"));
  try {
    const assetsDir = path.join(tmp, "dist/renderer/assets");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(assetsDir, { recursive: true });
    const target = path.join(assetsDir, "index-FAKE.js");
    await writeFile(target, baseSource);
    const result = await applyOriginalRendererLanguagePatch({ stageRoot: tmp });
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].role, "panel");
    assert.ok(result.features.includes("settings-general-language"));
    const patched = await readFile(target, "utf8");
    assert.ok(patched.includes("function RLangLocale("), "RLangLocale resolver must be inserted");
    assert.ok(patched.includes("function RLangSection()"), "RLangSection must be inserted");
    assert.ok(patched.includes("r=a.jsx(RLangSection,{})"), "Sa slot must render the new section");
    assert.ok(patched.includes("window.desktop?.language"), "patched section must read window.desktop.language");
    assert.ok(patched.includes('"follow-system"') && patched.includes('"en"') && patched.includes('"zh-CN"'), "patched section must list the three locales");
    // Row title + Follow System localise with the resolved locale (0.59.1 parity);
    // explicit locales keep their endonyms in both locales.
    assert.ok(patched.includes('"语言"'), "patched section must include the zh-CN row title");
    assert.ok(patched.includes('"跟随系统"'), "patched section must include the zh-CN Follow System label");
    assert.ok(patched.includes('"Follow System"'), "patched section must include the en Follow System label");
    assert.ok(patched.includes('"aria-label":title'), "SandSelect must target the localised row title");
    // Anchor must remain in place after patching.
    assert.ok(patched.includes("function pa(){"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("language patch rejects when no upstream Settings panel chunk is present", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "lang-patch-"));
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(tmp, "dist/renderer/assets"), { recursive: true });
    await writeFile(path.join(tmp, "dist/renderer/assets/x.js"), "function pa(){}");
    await assert.rejects(
      applyOriginalRendererLanguagePatch({ stageRoot: tmp }),
      /Expected one original Settings panel chunk/,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});