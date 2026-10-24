import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cleanBuild = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/clean-build.mjs");

test("packaged settings mount Vault while Local teams remains hidden", async () => {
  const source = await readFile(cleanBuild, "utf8");
  assert.doesNotMatch(source, /applyLocalTeamsRendererPatch\(/);
  assert.match(source, /applyVaultSettingsRenderer0721\(/);
  assert.doesNotMatch(source, /Local teams & Tailnet/);
});
