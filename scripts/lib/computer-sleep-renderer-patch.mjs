// 电脑休眠/唤醒 — build pass: appends the overlay runtime (official asleep stage +
// shape-aware mascot + hover pill) to the ENTRY chunk, and CSS rules to the stylesheet.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import {
  COMPUTER_SLEEP_CSS_TOKENS,
  COMPUTER_SLEEP_TOKEN_SHIMS,
  computerSleepOverlayRuntime,
  computerSleepStyles,
  loadOfficialAsleepArtifacts,
  loadOfficialOpenPill,
  loadOfficialShapeSvgs,
} from "./computer-sleep-renderer-components.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
const JS_MARKER = "/* grok-node computer sleep overlay";

export function patchComputerSleepRenderer(source, runtime) {
  if (source.includes(JS_MARKER)) throw new Error("Computer-sleep renderer patch was already applied.");
  const patched = source + runtime;
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return patched;
}

function officialCssTokens(css) {
  return [...new Set([...css.matchAll(/var\((--sand-[a-z0-9-]+)\)/g)].map(match => match[1]))].sort();
}

export async function applyComputerSleepRendererPatch({ stageRoot }) {
  const rendererRoot = path.join(stageRoot, "dist", "renderer");
  const html = await readFile(path.join(rendererRoot, "index.html"), "utf8");
  const scripts = [...html.matchAll(/src="\.\/(assets\/[^"]+\.js)"/g)].map(match => match[1]);
  const entryScripts = scripts.filter(name => /\/index-[^/]+\.js$/.test(name));
  if (entryScripts.length !== 1) throw new Error(`Computer-sleep patch: expected exactly one entry index script, found ${entryScripts.length}.`);
  const entryPath = path.join(rendererRoot, entryScripts[0]);
  const source = await readFile(entryPath, "utf8");
  if (!source.includes("sand-box-vnc-pool")) throw new Error("Computer-sleep patch: computer view root class sand-box-vnc-pool missing from entry chunk.");

  const [{ html: stageHtml, css: officialCss }, shapeSvgs, { html: pillHtml, css: pillCss }] = await Promise.all([
    loadOfficialAsleepArtifacts(),
    loadOfficialShapeSvgs(),
    loadOfficialOpenPill(),
  ]);

  const cssFiles = (await readdir(path.join(rendererRoot, "assets"))).filter(file => /^index-.*\.css$/.test(file));
  if (cssFiles.length !== 1) throw new Error(`Computer-sleep patch: expected one main renderer stylesheet, found ${cssFiles.length}.`);
  const cssPath = path.join(rendererRoot, "assets", cssFiles[0]);
  const css = await readFile(cssPath, "utf8");
  if (css.includes("#rcompsleep-pill")) throw new Error("Computer-sleep patch: stylesheet already carries the overlay styles.");
  const shimmed = new Set(Object.keys(COMPUTER_SLEEP_TOKEN_SHIMS));
  const allOfficialCss = officialCss + "\n" + pillCss;
  for (const token of [...COMPUTER_SLEEP_CSS_TOKENS, ...officialCssTokens(allOfficialCss)]) {
    if (shimmed.has(token) || css.includes(token)) continue;
    throw new Error(`Computer-sleep patch: missing design token: ${token}`);
  }

  const runtime = computerSleepOverlayRuntime(stageHtml, shapeSvgs, pillHtml);
  const patched = patchComputerSleepRenderer(source, runtime);
  await writeFile(entryPath, patched);
  const allStyles = computerSleepStyles(officialCss + "\n" + pillCss);
  const patchedCss = css + allStyles;
  await writeFile(cssPath, patchedCss);
  const shapeNames = Object.keys(shapeSvgs);
  console.log(`Computer-sleep overlay: appended stage+shapes(${shapeNames.length})+pill to ${entryScripts[0]}; pool: .sand-box-vnc-pool`);

  const provenance = {
    mode: "computer-preview-display-only",
    behavior: "Sleep hides the local preview while Docker and Bot execution continue.",
    styleScope: "Exported rules and token shims are restricted to the preview stage and hover pill.",
    evidence: "Grok Bot 0.70.2 asleep stage + 13 shape SVGs + openPill, all exported from official app DOM",
    entry: entryScripts[0],
    containerClass: "sand-box-vnc-pool",
    shapes: shapeNames,
    files: [
      { file: entryScripts[0], originalSha256: hash(source), patchedSha256: hash(patched) },
      { file: cssFiles[0], originalSha256: hash(css), patchedSha256: hash(patchedCss) },
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-computer-sleep-extension.json");
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
