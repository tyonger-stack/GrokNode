// Official Grok Bot 0.78.1's theme tokens for the plugins dialog.
//
// The ported 0.78.1 chip rules consume `--sand-bg-primary`, `--sand-bg-secondary` and
// `--sand-text-inverted`. Official 0.78.1 resolves them from its runtime theme palette; upstream
// 0.18 ships an older palette that does not define them, so `var()` is invalid at computed-value
// time and the chip surfaces degrade to transparent.
//
// Official defines its palette on `:root`. This reconstruction keeps upstream 0.18's token set for
// the rest of the app — the same scope-limited convention this repository already uses for the
// 0.75.8 info-pane port and the 0.75.3 composer port — so the official values are applied to the
// marketplace dialog subtree only.
//
// Read-only apart from the staged stylesheet: this step appends bytes to the staged renderer CSS
// and records its hashes as evidence.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PORT_CSS = new URL("./marketplace-dialog-0781-theme-tokens.css", import.meta.url);

export async function applyMarketplaceDialog0781ThemeTokens({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const stylesheets = (await readdir(assets)).filter((name) => /^index-.*\.css$/.test(name));
  if (stylesheets.length !== 1) {
    throw new Error(`Marketplace theme-token patch: expected one main stylesheet, found ${stylesheets.length}.`);
  }
  const file = stylesheets[0];
  const cssPath = path.join(assets, file);
  const originalCss = await readFile(cssPath, "utf8");
  const portCss = (await readFile(PORT_CSS, "utf8")).trim();
  if (originalCss.includes(portCss)) {
    console.log(`Marketplace theme tokens: already present (${file}).`);
    return { file: `dist/renderer/assets/${file}`, applied: false };
  }
  const patchedCss = `${originalCss}\n${portCss}\n`;
  const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
  await writeFile(cssPath, patchedCss);
  const evidence = {
    mode: "marketplace-dialog-0781-theme-tokens",
    referenceVersion: "0.78.1",
    referenceAsarSha256: "e8d5e10f94f8b52cd02f696599c8e6503420ad85ceed7b41a27bbff7bff22f4d",
    file: `dist/renderer/assets/${file}`,
    originalSha256: hash(originalCss),
    patchedSha256: hash(patchedCss),
    portCssSha256: hash(portCss),
    portCssBytes: Buffer.byteLength(portCss),
    scope: [".sand-plugins-dialog", 'html[data-theme="cursor-dark"] .sand-plugins-dialog'],
  };
  await writeFile(
    path.join(stageRoot, "dist/renderer-marketplace-dialog-0781-theme-tokens.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(
    `Marketplace theme tokens: official 0.78.1 palette applied to the dialog subtree (${file}, ${evidence.portCssBytes} bytes).`,
  );
  return evidence;
}
