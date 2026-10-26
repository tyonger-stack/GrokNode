// Official Grok Bot 0.75.8 styling for the info-pane routine surface.
//
// The renderer patch (routine-surfaces-renderer-patch.mjs) renders the routine list with
// official 0.75.8's class names. A stylix class name is the hash of its declarations, so
// most of official's classes are already carried by the pinned 0.18 stylesheet and resolve
// to the same declarations. The classes 0.18 lacks are supplied here, copied verbatim from
// official 0.75.8's stylesheet, together with official's dark-theme token values scoped to
// the right-hand info pane.
//
// Read-only apart from the staged stylesheet: this step appends bytes to the staged
// renderer CSS and records its hashes as evidence.

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const PORT_CSS = new URL('./routine-surface-0758-official.css', import.meta.url);

export async function applyOriginalRendererRoutineSurface0758Css({ stageRoot }) {
  const relative = 'dist/renderer/assets/index-UbX-y3il.js';
  const file = path.join(stageRoot, relative);
  const cssFiles = (await readdir(path.dirname(file))).filter(name => /^index-.*\.css$/.test(name));
  if (cssFiles.length !== 1) throw new Error('Routine surface port requires exactly one main stylesheet');
  const cssPath = path.join(path.dirname(file), cssFiles[0]);
  const originalCss = await readFile(cssPath, 'utf8');
  const portCss = await readFile(PORT_CSS, 'utf8');
  if (originalCss.includes(portCss.trim())) throw new Error('Routine surface official CSS is already applied');
  const patchedCss = originalCss + '\n' + portCss;
  const hash = value => createHash('sha256').update(value).digest('hex');
  const evidence = {
    referenceVersion: '0.75.8',
    referenceApp: '/Applications/Grok Bot.app (com.anysphere.sand) 0.75.8',
    referenceAnalysis: '/Users/Apple/Documents/grokbot/rea-grokbot-0758',
    file: 'dist/renderer/assets/' + cssFiles[0],
    originalSha256: hash(originalCss),
    patchedSha256: hash(patchedCss),
    portCssSha256: hash(portCss),
    portCssBytes: Buffer.byteLength(portCss),
  };
  await writeFile(cssPath, patchedCss);
  await writeFile(path.join(stageRoot, 'dist/renderer-routine-surface-0758-extension.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Routine surface official CSS applied to ${evidence.file} (${evidence.portCssBytes} bytes)`);
  return evidence;
}
