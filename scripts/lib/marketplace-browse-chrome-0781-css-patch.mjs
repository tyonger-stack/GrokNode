/**
 * The official 0.78.1 browse-page rules that upstream 0.18's stylesheet does not ship.
 *
 * Official's chip row, group action, Bot-templates button, connected status and recommended hero
 * are built from class recipes; most of them already exist in 0.18's stylesheet with the same
 * declaration (stylix derives a class name purely from its declaration block, so an unchanged rule
 * hashes to the same name on both sides). The 28 that are missing are lifted byte-for-byte from
 * official's own stylesheet (`marketplace-browse-chrome-0781-official.css`), not authored here.
 *
 * The 0.75.8 companion file carried six of them and missed three (`sand-fwqdrz`, `sand-8rotk8`,
 * `sand-sa7k8x`), so the 0.75.8 chip row had no background and no selected-state text colour. This
 * file carries all of them.
 *
 * @evidence official 0.78.1 `rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css`
 * @evidence upstream 0.18 `src/app/dist/renderer/assets/index-lCyB53CO.css`
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OFFICIAL_CSS_FILE = "marketplace-browse-chrome-0781-official.css";

export async function applyMarketplaceBrowseChrome0781Css({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const stylesheets = (await readdir(assets)).filter((name) => /^index-.*\.css$/.test(name));
  if (stylesheets.length !== 1) {
    throw new Error(`Marketplace browse chrome CSS patch: expected one main stylesheet, found ${stylesheets.length}.`);
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
    console.log(`Marketplace browse chrome CSS: already present (${file}).`);
  }
  const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
  const patched = missing.length > 0 ? `${original}\n${missing.join("\n")}\n` : original;
  const provenance = {
    mode: "marketplace-browse-chrome-0781-css",
    referenceVersion: "0.78.1",
    file: `dist/renderer/assets/${file}`,
    originalSha256: sha256(original),
    patchedSha256: sha256(patched),
    rules: rules.map((line) => line.slice(0, line.indexOf("{"))),
    appendedRules: missing.map((line) => line.slice(0, line.indexOf("{"))),
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-marketplace-browse-chrome-0781-css.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(
    `Marketplace browse chrome CSS: official 0.78.1 rules added (${file}, ${missing.length} of ${rules.length} appended).`,
  );
  return provenance;
}
