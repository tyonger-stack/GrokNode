import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Bundle instead of `transform`: these modules reach the shared locale resolver by
// relative path and a `data:` URL cannot resolve relative specifiers (ESM raises
// ERR_UNSUPPORTED_RESOLVE_REQUEST). esbuild bundles the graph and the test imports
// a real temp file, so each module's own imports resolve exactly as they do on disk.
async function loadTsModule(relativePath) {
  const dir = await mkdtemp(path.join(tmpdir(), "i18n-language-preference-"));
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

async function loadObjectModule(relativePath, exportName) {
  const mod = await loadTsModule(relativePath);
  return mod[exportName];
}

test("source-side locale resolver maps follow-system against navigator-style tags", async () => {
  const locale = await loadTsModule("source/shared/node/i18n/locale.ts");
  assert.deepEqual(locale.SUPPORTED_LOCALES, ["en", "zh-CN"]);
  assert.equal(locale.FALLBACK_LOCALE, "en");
  assert.equal(locale.DEFAULT_LANGUAGE_PREFERENCE, "follow-system");
  assert.equal(locale.isSupportedLocale("en"), true);
  assert.equal(locale.isSupportedLocale("zh-CN"), true);
  assert.equal(locale.isSupportedLocale("fr"), false);
  assert.equal(locale.isLanguagePreference("follow-system"), true);
  assert.equal(locale.isLanguagePreference("zh-CN"), true);
  assert.equal(locale.isLanguagePreference("fr"), false);

  assert.equal(locale.resolveSystemLocale(["en-US"]), "en");
  assert.equal(locale.resolveSystemLocale(["en"]), "en");
  assert.equal(locale.resolveSystemLocale(["zh-Hans"]), "zh-CN");
  assert.equal(locale.resolveSystemLocale(["zh-CN"]), "zh-CN");
  assert.equal(locale.resolveSystemLocale(["fr"]), "en");
  assert.equal(locale.resolveSystemLocale([]), "en");

  assert.equal(locale.resolveLocale("follow-system", ["zh-CN"]), "zh-CN");
  assert.equal(locale.resolveLocale("follow-system", ["en-US"]), "en");
  assert.equal(locale.resolveLocale("en", ["zh-CN"]), "en");
  assert.equal(locale.resolveLocale("zh-CN", ["en-US"]), "zh-CN");
});

test("renderer-side locale mirror stays in lock-step with the canonical source", async () => {
  const source = await loadTsModule("source/shared/node/i18n/locale.ts");
  const mirror = await loadTsModule("frontend/src/i18n/locale.ts");
  assert.deepEqual(mirror.SUPPORTED_LOCALES, source.SUPPORTED_LOCALES);
  assert.equal(mirror.FALLBACK_LOCALE, source.FALLBACK_LOCALE);
  assert.equal(mirror.DEFAULT_LANGUAGE_PREFERENCE, source.DEFAULT_LANGUAGE_PREFERENCE);
  // Behavioural parity: resolve the same inputs through both modules.
  const samples = [["en-US"], ["zh-Hans"], ["fr"], []];
  for (const tags of samples) {
    assert.equal(mirror.resolveLocale("follow-system", tags), source.resolveLocale("follow-system", tags));
  }
  for (const preference of ["en", "zh-CN"]) {
    for (const tags of [["en-US"], ["zh-CN"]]) {
      assert.equal(mirror.resolveLocale(preference, tags), source.resolveLocale(preference, tags));
    }
  }
});

test("every key in en is also present (and non-empty) in zh-CN", async () => {
  const en = await loadObjectModule("frontend/src/i18n/messages/en.ts", "enMessages");
  const zh = await loadObjectModule("frontend/src/i18n/messages/zh-CN.ts", "zhCNMessages");
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();
  assert.deepEqual(zhKeys, enKeys, `zh-CN key set must mirror en; missing=${enKeys.filter((k) => !zhKeys.includes(k))} extra=${zhKeys.filter((k) => !enKeys.includes(k))}`);
  for (const key of enKeys) {
    assert.ok(typeof en[key] === "string" && en[key].length > 0, `en value for ${key} must be non-empty`);
    assert.ok(typeof zh[key] === "string" && zh[key].length > 0, `zh-CN value for ${key} must be non-empty`);
  }
});

test("en dictionary labels follow the Settings → Appearance → Language pattern", async () => {
  const en = await loadObjectModule("frontend/src/i18n/messages/en.ts", "enMessages");
  for (const key of [
    "settings.appearance.title",
    "settings.appearance.theme",
    "settings.appearance.theme.system",
    "settings.appearance.theme.light",
    "settings.appearance.theme.dark",
    "settings.appearance.language",
    "settings.appearance.language.followSystem",
    "settings.appearance.language.english",
    "settings.appearance.language.simplifiedChinese"
  ]) {
    assert.ok(typeof en[key] === "string" && en[key].length > 0, `expected ${key} to be present`);
  }
});

test("GeneralSettingsPanel + Theme/Language pickers consume i18n keys (not hard-coded English)", async () => {
  const panelsSource = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/panels.tsx"), "utf8");
  // Group title + row labels + Theme option labels must all come from the dictionary.
  for (const fragment of [
    'id: "settings.appearance.title"',
    'id: "settings.appearance.theme"',
    'id: "settings.appearance.language"',
    'id: "settings.appearance.theme.system"',
    'id: "settings.appearance.theme.light"',
    'id: "settings.appearance.theme.dark"',
    'id: "settings.appearance.language.followSystem"',
    'id: "settings.appearance.language.english"',
    'id: "settings.appearance.language.simplifiedChinese"'
  ]) {
    assert.ok(panelsSource.includes(fragment), `panels.tsx missing i18n lookup: ${fragment}`);
  }
  // The static English fallback must no longer leak into the panel markup.
  assert.doesNotMatch(panelsSource, /<span>Theme<\/span>/);
  assert.doesNotMatch(panelsSource, /<span>Language<\/span>/);
});