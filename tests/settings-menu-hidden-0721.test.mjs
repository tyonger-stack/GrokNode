import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cleanBuild = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/clean-build.mjs");

test("packaged settings do not mount the Vault or Local teams menus", async () => {
  const source = await readFile(cleanBuild, "utf8");
  assert.doesNotMatch(source, /applyLocalTeamsRendererPatch\(/);
  assert.doesNotMatch(source, /applyVaultSettingsRenderer0721\(/);
  assert.doesNotMatch(source, /Local teams & Tailnet/);
  assert.doesNotMatch(source, /label:"Vault"/);
});
