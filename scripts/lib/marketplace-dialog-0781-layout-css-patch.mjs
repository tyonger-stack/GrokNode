// Official Grok Bot 0.78.1's header and toolbar layout inside the plugins dialog.
//
// Official stacks the title row, the search row and the chip row; upstream 0.18 puts the
// connected-apps entry, the search field, the Bot-templates button and the segmented control into
// one toolbar row. The renderer patch moves official's connected-apps entry into the header row;
// this step gives the header row and the toolbar their official layout.
//
// Read-only apart from the staged stylesheet: this step appends bytes to the staged renderer CSS
// and records its hashes as evidence.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PORT_CSS = new URL("./marketplace-dialog-0781-layout.css", import.meta.url);

export async function applyMarketplaceDialog0781Layout({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const stylesheets = (await readdir(assets)).filter((name) => /^index-.*\.css$/.test(name));
  if (stylesheets.length !== 1) {
    throw new Error(`Marketplace layout patch: expected one main stylesheet, found ${stylesheets.length}.`);
  }
  const file = stylesheets[0];
  const cssPath = path.join(assets, file);
  const originalCss = await readFile(cssPath, "utf8");
  const portCss = (await readFile(PORT_CSS, "utf8")).trim();
  if (originalCss.includes(portCss)) {
    console.log(`Marketplace layout: already present (${file}).`);
    return { file: `dist/renderer/assets/${file}`, applied: false };
  }
  const patchedCss = `${originalCss}\n${portCss}\n`;
  const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
  await writeFile(cssPath, patchedCss);
  const evidence = {
    mode: "marketplace-dialog-0781-layout",
    referenceVersion: "0.78.1",
    referenceAsarSha256: "e8d5e10f94f8b52cd02f696599c8e6503420ad85ceed7b41a27bbff7bff22f4d",
    file: `dist/renderer/assets/${file}`,
    originalSha256: hash(originalCss),
    patchedSha256: hash(patchedCss),
    portCssSha256: hash(portCss),
    portCssBytes: Buffer.byteLength(portCss),
    scope: [".sand-plugins-dialog"],
    officialRows: ["title + connected-apps entry", "search + Bot-templates button", "chip row"],
  };
  await writeFile(
    path.join(stageRoot, "dist/renderer-marketplace-dialog-0781-layout.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(
    `Marketplace layout: official 0.78.1 header and toolbar rows applied to the dialog subtree (${file}, ${evidence.portCssBytes} bytes).`,
  );
  return evidence;
}
