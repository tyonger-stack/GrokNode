// P0-5: couldnt-reach dialog comfort copy aligned to official 0.71.2 (LDzo5u).
// Official comfort is the dialog body — not a second top-bar banner.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";

import {
  LDZO5U_EN,
  LDZO5U_ZH,
  VI957D_EN,
  WUMEMD_EN,
  UPDATE_FAILED_EN,
  patchCouldntReachComfort,
  COULDNT_REACH_COMFORT_EVIDENCE,
} from "../scripts/lib/couldnt-reach-comfort-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_CHUNK = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const MAIN_I18N = path.join(REPO_ROOT, "scripts/lib/main-i18n-patch.mjs");
const CLEAN_BUILD = path.join(REPO_ROOT, "scripts/clean-build.mjs");

const pinnedChunk = await readFile(PINNED_CHUNK, "utf8").catch(() => null);
const pinnedSkip =
  pinnedChunk == null
    ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped."
    : false;

test("evidence documents dialog-not-banner and the official gate", () => {
  assert.match(COULDNT_REACH_COMFORT_EVIDENCE.dialogClass, /sand-computer-couldnt-reach-dialog/);
  assert.match(COULDNT_REACH_COMFORT_EVIDENCE.notATopBanner, /dialog only/i);
  assert.match(COULDNT_REACH_COMFORT_EVIDENCE.gate, /escalation==="unreachable"/);
});

test("clean-build wires the comfort patch before main-i18n", async () => {
  const source = await readFile(CLEAN_BUILD, "utf8");
  assert.match(source, /applyOriginalRendererCouldntReachComfort/);
  const comfort = source.indexOf("applyOriginalRendererCouldntReachComfort({ stageRoot })");
  const mainI18n = source.indexOf("applyOriginalRendererMainI18n({ stageRoot })");
  assert.ok(comfort > 0 && mainI18n > comfort, "comfort patch must precede main-i18n");
});

test("main-i18n carries official LDzo5u / wUMeMd / Vi957D pairs", async () => {
  const source = await readFile(MAIN_I18N, "utf8");
  for (const [en, zh, id] of [
    [LDZO5U_EN, LDZO5U_ZH, "LDzo5u"],
    [WUMEMD_EN, null, "wUMeMd"],
    [VI957D_EN, null, "Vi957D"],
  ]) {
    assert.ok(source.includes(en), `missing EN for ${id}`);
    assert.ok(source.includes(`"${id}", "PANEL"`), `missing PANEL pair id ${id}`);
    if (zh) assert.ok(source.includes(zh), `missing ZH for ${id}`);
    assert.ok(source.includes(`${en}", "zero-pattern-hit"`), `missing zero-pattern guard for ${id}`);
  }
});

test("pristine chunk still has agents wording and the dialog gate", { skip: pinnedSkip }, () => {
  assert.ok(pinnedChunk.includes("sand-computer-couldnt-reach-dialog"));
  assert.ok(pinnedChunk.includes('escalation==="unreachable"'));
  assert.ok(
    pinnedChunk.includes(
      "Your agents, files, and logins are safe. If it doesn't reconnect on its own, recover Grok Bot's computer to keep the data.",
    ),
  );
  assert.equal(pinnedChunk.includes(LDZO5U_EN), false);
});

test("patch rewrites agents→Bots comfort to official wording", { skip: pinnedSkip }, () => {
  const patched = patchCouldntReachComfort(pinnedChunk);
  assert.ok(patched.includes(LDZO5U_EN));
  assert.ok(patched.includes(WUMEMD_EN));
  assert.ok(patched.includes(VI957D_EN));
  assert.ok(patched.includes(UPDATE_FAILED_EN));
  assert.equal(
    patched.includes(
      "Your agents, files, and logins are safe. If it doesn't reconnect on its own, recover Grok Bot's computer to keep the data.",
    ),
    false,
  );
  assert.equal(
    patched.includes("Your agents, files, and logins are kept."),
    false,
  );
  // Dialog shell and gate unchanged — no invented second banner.
  assert.ok(patched.includes("sand-computer-couldnt-reach-dialog"));
  assert.ok(patched.includes('escalation==="unreachable"'));
  assert.ok(patched.includes("Couldn't Reach Grok Bot's Computer"));
});

test("patched chunk still parses", { skip: pinnedSkip }, () => {
  const patched = patchCouldntReachComfort(pinnedChunk);
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
});

test("MUTATION: leaving agents wording makes the official EN assert fail", { skip: pinnedSkip }, () => {
  const patched = patchCouldntReachComfort(pinnedChunk);
  const reverted = patched.replaceAll(LDZO5U_EN, "Your agents, files, and logins are safe. If it doesn't reconnect on its own, recover Grok Bot's computer to keep the data.");
  assert.equal(reverted.includes(LDZO5U_EN), false);
  assert.ok(
    reverted.includes("Your agents, files, and logins are safe. If it doesn't reconnect"),
    "mutation fixture must restore agents wording",
  );
});
