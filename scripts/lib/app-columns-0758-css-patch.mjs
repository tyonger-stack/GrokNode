// Official Grok Bot 0.75.8 column chrome: middle-column background, left-rail
// background, and the chat toolbar's top scrim.
//
// The ported CSS lives in app-columns-0758-official.css next to this file, with the
// per-element evidence (official class, official rule, computed value, and the 0.18
// rule it must outrank) documented inline. This step appends those bytes to the staged
// renderer stylesheet and records the hashes as evidence, mirroring the routine-surface
// 0.75.8 CSS port.
//
// Read-only apart from the staged stylesheet.

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const PORT_CSS = new URL('./app-columns-0758-official.css', import.meta.url);

export async function applyOriginalRendererAppColumns0758Css({ stageRoot }) {
  const relative = 'dist/renderer/assets/index-UbX-y3il.js';
  const file = path.join(stageRoot, relative);
  const cssFiles = (await readdir(path.dirname(file))).filter(name => /^index-.*\.css$/.test(name));
  if (cssFiles.length !== 1) throw new Error('App-columns port requires exactly one main stylesheet');
  const cssPath = path.join(path.dirname(file), cssFiles[0]);
  const originalCss = await readFile(cssPath, 'utf8');
  const portCss = await readFile(PORT_CSS, 'utf8');
  if (originalCss.includes(portCss.trim())) throw new Error('App-columns official CSS is already applied');
  // The port must outrank two 0.18 rules by specificity, not by order; fail closed if
  // the staged stylesheet the port is appended to is not one that carries them.
  for (const anchor of [
    '.sand-1ua6jya:not(#\\#):not(#\\#):not(#\\#){background-color:var(--cursor-bg-editor)}',
    '.sand-1ys0zz1:not(#\\#):not(#\\#):not(#\\#){background-color:var(--cursor-bg-chrome)}',
  ]) {
    if (!originalCss.includes(anchor)) {
      throw new Error(`App-columns port found no 0.18 rule to outrank: ${anchor}`);
    }
  }
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
    surfaces: ['shell-background', 'agents-sidebar-background', 'chat-toolbar-scrim'],
  };
  await writeFile(cssPath, patchedCss);
  await writeFile(path.join(stageRoot, 'dist/renderer-app-columns-0758-extension.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`App-columns official CSS applied to ${evidence.file} (${evidence.portCssBytes} bytes)`);
  return evidence;
}
