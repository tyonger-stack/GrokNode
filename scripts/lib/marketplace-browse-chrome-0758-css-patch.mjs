/**
 * The three official 0.75.8 chip rules that upstream 0.18's stylesheet does not ship.
 *
 * Official's chip recipe (`Ni.chip` / `Ni.chipSelected` in `chunk-view-Bl5Kz6YC.js`) is built from
 * 25 class recipes; 22 of them already exist in 0.18's stylesheet with the same declaration
 * (stylix derives a class name purely from its declaration block, so an unchanged rule hashes to
 * the same name on both sides). The three that are missing are lifted byte-for-byte from official's
 * own stylesheet (`marketplace-browse-chrome-0758-official.css`), not authored here.
 *
 * @evidence official 0.75.8 `rea-grokbot-0758/app/dist/renderer/assets/index-CFSAhbDS.css`
 * @evidence upstream 0.18 `src/app/dist/renderer/assets/index-lCyB53CO.css`
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OFFICIAL_CSS_FILE = "marketplace-browse-chrome-0758-official.css";

export async function applyMarketplaceBrowseChrome0758Css({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const stylesheets = (await readdir(assets)).filter((name) => /^index-.*\.css$/.test(name));
  if (stylesheets.length !== 1) {
    throw new Error(`Marketplace browse chrome CSS patch: expected one main stylesheet, found ${stylesheets.length}.`);
  }
  const file = stylesheets[0];
  const cssPath = path.join(assets, file);
  const original = await readFile(cssPath, "utf8");
  const official = await readFile(new URL(`./${OFFICIAL_CSS_FILE}`, import.meta.url), "utf8");
  if (original.includes(".sand-1x57ub9")) {
    console.log(`Marketplace browse chrome CSS: already present (${file}).`);
    return { file, applied: false, reason: "already-present" };
  }
  const patched = `${original}\n${official}`;
  await writeFile(cssPath, patched);
  const sha256 = (text) => createHash("sha256").update(text).digest("hex");
  const provenance = {
    mode: "marketplace-browse-chrome-0758-css",
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
    path.join(stageRoot, "dist", "renderer-marketplace-browse-chrome-0758-css.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(`Marketplace browse chrome CSS: official 0.75.8 chip rules added (${file}, ${provenance.rules.length} rules).`);
  return provenance;
}
