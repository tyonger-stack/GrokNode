/**
 * Official Grok Bot 0.78.1's plugins-dialog geometry, injected into upstream 0.18's stylesheet.
 *
 * ## Why
 *
 * Upstream 0.18 ships the same plugins dialog as official 0.78.1, two generations earlier, but its
 * stylix class recipes were hashed from a different declaration set. The behavioural difference is
 * the dialog WIDTH:
 *
 *   0.18     `sand-1gys7z3` = width:min(1e3px, calc(100vw - 40px))   → 1000px
 *   0.75.8   `sand-h6vr4k`  = width:min(800px, 100vw - 40px)         →  800px
 *   0.78.1   `sand-1sdb7ul` = width:min(900px, 100vw - 32px)         →  900px
 *
 * The height cap moves with it: 0.75.8 shipped it as `sand-z03ioa`, official 0.78.1 ships the same
 * declaration (`height:min(700px,100vh - 96px)`) as `sand-xe7e0x`. Measured live on official
 * 0.78.1: the dialog is 900×702.
 *
 * The eight rules that ARE missing are lifted byte-for-byte from official 0.78.1's own stylesheet
 * (`marketplace-dialog-0781-official.css`), not authored here. Every other official dialog/layout
 * class already exists in 0.18's stylesheet with the same declaration — stylix derives a class name
 * purely from its declaration block, so an unchanged rule hashes to the same name on both sides.
 *
 * @evidence official 0.78.1 `rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css`
 * @evidence upstream 0.18 `src/app/dist/renderer/assets/index-lCyB53CO.css`
 * @evidence official 0.78.1 `chunk-view-KV06RTpF.js` — the dialog class recipe.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OFFICIAL_CSS_FILE = "marketplace-dialog-0781-official.css";

export async function applyMarketplaceDialog0781Css({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const stylesheets = (await readdir(assets)).filter((name) => /^index-.*\.css$/.test(name));
  if (stylesheets.length !== 1) {
    throw new Error(`Marketplace dialog CSS patch: expected one main stylesheet, found ${stylesheets.length}.`);
  }
  const file = stylesheets[0];
  const cssPath = path.join(assets, file);
  const original = await readFile(cssPath, "utf8");
  const official = await readFile(new URL(`./${OFFICIAL_CSS_FILE}`, import.meta.url), "utf8");
  const rules = official.split("\n").filter((line) => line.startsWith(".sand-"));
  // Another patch in the chain may already carry one of these rules, so only the missing ones are
  // appended. The rule text is the identity, not the class name.
  const missing = rules.filter((rule) => !original.includes(rule));
  if (missing.length > 0) {
    await writeFile(cssPath, `${original}\n${missing.join("\n")}\n`);
  } else {
    console.log(`Marketplace dialog CSS: already present (${file}).`);
  }
  const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
  const patched = missing.length > 0 ? `${original}\n${missing.join("\n")}\n` : original;
  const provenance = {
    mode: "marketplace-dialog-0781-css",
    referenceVersion: "0.78.1",
    file: `dist/renderer/assets/${file}`,
    originalSha256: sha256(original),
    patchedSha256: sha256(patched),
    rules: rules.map((line) => line.slice(0, line.indexOf("{"))),
    appendedRules: missing.map((line) => line.slice(0, line.indexOf("{"))),
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-marketplace-dialog-0781-css.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(
    `Marketplace dialog CSS: official 0.78.1 geometry added (${file}, ${missing.length} of ${rules.length} appended).`,
  );
  return provenance;
}
