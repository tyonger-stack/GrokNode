// Official Grok Bot 0.78.1's typography inside the plugins dialog.
//
// Official ships a global form-control reset (`:where(button, input, select, textarea)`) and
// renders its whole app at `--sand-font-weight-regular` = 425, the regular weight of the variable
// font it ships. Upstream 0.18 has the reset only under `.sand-info-pane__inner`, so every button
// inside the marketplace dialog falls back to the browser's `font: 400 13.333px Arial`, and
// upstream's runtime writes 420 where official writes 425.
//
// This step appends the port-scoped copy of both, in official's own `:where()` construction, so the
// rule keeps zero specificity and weighs against upstream's class rules exactly as official's does.
//
// Read-only apart from the staged stylesheet: this step appends bytes to the staged renderer CSS
// and records its hashes as evidence.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PORT_CSS = new URL("./marketplace-dialog-0781-typography.css", import.meta.url);

export async function applyMarketplaceDialog0781Typography({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const stylesheets = (await readdir(assets)).filter((name) => /^index-.*\.css$/.test(name));
  if (stylesheets.length !== 1) {
    throw new Error(`Marketplace typography patch: expected one main stylesheet, found ${stylesheets.length}.`);
  }
  const file = stylesheets[0];
  const cssPath = path.join(assets, file);
  const originalCss = await readFile(cssPath, "utf8");
  const portCss = (await readFile(PORT_CSS, "utf8")).trim();
  if (originalCss.includes(portCss)) {
    console.log(`Marketplace typography: already present (${file}).`);
    return { file: `dist/renderer/assets/${file}`, applied: false };
  }
  const patchedCss = `${originalCss}\n${portCss}\n`;
  const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
  await writeFile(cssPath, patchedCss);
  const evidence = {
    mode: "marketplace-dialog-0781-typography",
    referenceVersion: "0.78.1",
    referenceAsarSha256: "e8d5e10f94f8b52cd02f696599c8e6503420ad85ceed7b41a27bbff7bff22f4d",
    file: `dist/renderer/assets/${file}`,
    originalSha256: hash(originalCss),
    patchedSha256: hash(patchedCss),
    portCssSha256: hash(portCss),
    portCssBytes: Buffer.byteLength(portCss),
    scope: [":where(.sand-plugins-dialog)", ".sand-plugins-dialog"],
    officialGlobalReset:
      ":where(button, input, select, textarea){font-family:inherit;font-size:var(--sand-font-size-sm);font-weight:inherit}",
  };
  await writeFile(
    path.join(stageRoot, "dist/renderer-marketplace-dialog-0781-typography.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(
    `Marketplace typography: official 0.78.1 form-control reset and regular weight applied to the dialog subtree (${file}, ${evidence.portCssBytes} bytes).`,
  );
  return evidence;
}
