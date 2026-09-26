import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadTsModule(relativePath) {
  const dir = await mkdtemp(path.join(tmpdir(), "chromium-locale-"));
  const out = path.join(dir, "out.mjs");
  await build({
    entryPoints: [path.join(repoRoot, relativePath)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    outfile: out,
    logLevel: "silent",
  });
  try {
    return await import(out);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

const mod = await loadTsModule("source/electron-main/prefs/chromium-locale.ts");

test("chromium locale maps explicit preferences, follow-system stays unset", () => {
  assert.equal(mod.chromiumLocaleForPreference("zh-CN"), "zh-CN");
  assert.equal(mod.chromiumLocaleForPreference("en"), "en-US");
  assert.equal(mod.chromiumLocaleForPreference("follow-system"), null);
});

test("stored preference reader tolerates missing/corrupt/foreign settings", () => {
  const read = (files) => (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };
  assert.equal(mod.readStoredLanguagePreference(read({ "/s.json": JSON.stringify({ languagePreference: "zh-CN" }) }), "/s.json"), "zh-CN");
  assert.equal(mod.readStoredLanguagePreference(read({ "/s.json": JSON.stringify({ languagePreference: "en" }) }), "/s.json"), "en");
  assert.equal(mod.readStoredLanguagePreference(read({}), "/s.json"), "follow-system");
  assert.equal(mod.readStoredLanguagePreference(read({ "/s.json": "not-json{" }), "/s.json"), "follow-system");
  assert.equal(mod.readStoredLanguagePreference(read({ "/s.json": JSON.stringify({ languagePreference: "fr" }) }), "/s.json"), "follow-system");
});

test("apply appends --lang only for explicit preferences", () => {
  const run = (contents) => {
    const calls = [];
    const preference = mod.applyChromiumLocaleFromPreference({
      appendSwitch: (name, value) => calls.push([name, value]),
      readFile: () => contents,
      settingsPath: "/s.json",
    });
    return { calls, preference };
  };
  assert.deepEqual(run(JSON.stringify({ languagePreference: "zh-CN" })), { calls: [["lang", "zh-CN"]], preference: "zh-CN" });
  assert.deepEqual(run(JSON.stringify({ languagePreference: "en" })), { calls: [["lang", "en-US"]], preference: "en" });
  assert.deepEqual(run(JSON.stringify({})), { calls: [], preference: "follow-system" });
});
