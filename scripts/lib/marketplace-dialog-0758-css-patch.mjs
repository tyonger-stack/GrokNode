/**
 * Official Grok Bot 0.75.8's plugins-dialog geometry, injected into upstream 0.18's stylesheet.
 *
 * ## Why
 *
 * Upstream 0.18 ships the same plugins dialog as official 0.75.8, one generation earlier, but
 * its stylix class recipes were hashed from a different declaration set. The behavioural
 * difference is the dialog WIDTH:
 *
 *   0.18     `sand-1gys7z3` = width:min(1e3px, calc(100vw - 40px))   → 1000px
 *   0.75.8   `sand-h6vr4k`  = width:min(800px, 100vw - 40px)         →  800px
 *
 * Every other official dialog/layout class (`sand-1717udv`, `sand-1da2sx9`, `sand-5vqeur`,
 * `sand-1e6nqfh`, `sand-9f619`, `sand-1n2onr6`, `sand-78zum5`, `sand-dt5ytf`, `sand-2lwn1j`,
 * `sand-7giv3`, `sand--default-marker`) already exists in 0.18's stylesheet with the same
 * declaration — stylix derives a class name purely from its declaration block, so an unchanged
 * rule hashes to the same name on both sides.
 *
 * The five rules that ARE missing are lifted byte-for-byte from official 0.75.8's own stylesheet
 * (`scripts/lib/marketplace-dialog-0758-official.css`), not authored here.
 *
 * @evidence official 0.75.8 `rea-grokbot-0758/app/dist/renderer/assets/index-CFSAhbDS.css`
 * @evidence upstream 0.18 `src/app/dist/renderer/assets/index-lCyB53CO.css`
 * @evidence official 0.75.8 `chunk-view-Bl5Kz6YC.js` `Ms` — the dialog class recipe.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OFFICIAL_CSS_FILE = "marketplace-dialog-0758-official.css";

export async function applyMarketplaceDialog0758Css({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const stylesheets = (await readdir(assets)).filter((name) => /^index-.*\.css$/.test(name));
  if (stylesheets.length !== 1) {
    throw new Error(`Marketplace dialog CSS patch: expected one main stylesheet, found ${stylesheets.length}.`);
  }
  const file = stylesheets[0];
  const cssPath = path.join(assets, file);
  const original = await readFile(cssPath, "utf8");
  const official = await readFile(new URL(`./${OFFICIAL_CSS_FILE}`, import.meta.url), "utf8");
  if (original.includes(".sand-h6vr4k")) {
    console.log(`Marketplace dialog CSS: already present (${file}).`);
    return { file, applied: false, reason: "already-present" };
  }
  const patched = `${original}\n${official}`;
  await writeFile(cssPath, patched);
  const sha256 = (text) => createHash("sha256").update(text).digest("hex");
  const provenance = {
    mode: "marketplace-dialog-0758-css",
    referenceVersion: "0.75.8",
    file: `dist/renderer/assets/${file}`,
    originalSha256: sha256(original),
    patchedSha256: sha256(patched),
    rules: official
      .split("\n")
      .filter((line) => line.startsWith(".sand-"))
      .map((line) => line.slice(0, line.indexOf("{"))),
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-marketplace-dialog-0758-css.json"),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  console.log(`Marketplace dialog CSS: official 0.75.8 geometry added (${file}, ${provenance.rules.length} rules).`);
  return provenance;
}
