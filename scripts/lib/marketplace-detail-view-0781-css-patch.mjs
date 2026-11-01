/**
 * The official 0.78.1 detail-view rules that upstream 0.18's stylesheet does not ship.
 *
 * Official's plugin detail page is built from class recipes; most of them already exist in 0.18's
 * stylesheet with the same declaration (stylix derives a class name purely from its declaration
 * block, so an unchanged rule hashes to the same name on both sides). The ones that are missing
 * are lifted byte-for-byte from official's own stylesheet
 * (`marketplace-detail-view-0781-official.css`), not authored here.
 *
 * @evidence official 0.78.1 `rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css`
 * @evidence upstream 0.18 `src/app/dist/renderer/assets/index-lCyB53CO.css`
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OFFICIAL_CSS_FILE = "marketplace-detail-view-0781-official.css";

export async function applyMarketplaceDetailView0781Css({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const stylesheets = (await readdir(assets)).filter((name) => /^index-.*\.css$/.test(name));
  if (stylesheets.length !== 1) {
    throw new Error(`Marketplace detail view CSS patch: expected one main stylesheet, found ${stylesheets.length}.`);
  }
  const file = stylesheets[0];
  const cssPath = path.join(assets, file);
  const original = await readFile(cssPath, "utf8");
  const official = await readFile(new URL(`./${OFFICIAL_CSS_FILE}`, import.meta.url), "utf8");
  const rules = official.split("\n").filter((line) => line.startsWith(".sand-"));
  // Another patch in the chain may already carry one of these rules, so only the missing ones are
  // appended. The rule text is the identity, not the class name.
  //
  // The comparison is line-exact on purpose. A plain substring search would read
  // `.r-conversation-computer-card .sand-1lun4ml{…}` as "the rule for sand-1lun4ml is already
  // there", because the scoped rule contains the unscoped one as a substring — and the unscoped
  // rule is the one that actually applies to the detail page's button.
  const originalLines = new Set(original.split("\n").map((line) => line.trim()));
  const missing = rules.filter((rule) => !originalLines.has(rule.trim()));
  if (missing.length > 0) {
    await writeFile(cssPath, `${original}\n${missing.join("\n")}\n`);
  } else {
    console.log(`Marketplace detail view CSS: already present (${file}).`);
  }
  const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
  const patched = missing.length > 0 ? `${original}\n${missing.join("\n")}\n` : original;
  // Fail closed: after this step every official rule must stand on its own line, unscoped.
  const patchedLines = new Set(patched.split("\n").map((line) => line.trim()));
  const unresolved = rules.filter((rule) => !patchedLines.has(rule.trim()));
  if (unresolved.length > 0) {
    throw new Error(
      `Marketplace detail view CSS patch: ${unresolved.length} official rule(s) are not present ` +
        `as standalone rules in ${file}: ${unresolved.map((r) => r.slice(0, 60)).join(" | ")}`,
    );
  }
  const provenance = {
    mode: "marketplace-detail-view-0781-css",
    referenceVersion: "0.78.1",
    file: `dist/renderer/assets/${file}`,
    originalSha256: sha256(original),
    patchedSha256: sha256(patched),
    rules: rules.map((line) => line.slice(0, line.indexOf("{"))),
    appendedRules: missing.map((line) => line.slice(0, line.indexOf("{"))),
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-marketplace-detail-view-0781-css.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(
    `Marketplace detail view CSS: official 0.78.1 rules added (${file}, ${missing.length} of ${rules.length} appended).`,
  );
  return provenance;
}
