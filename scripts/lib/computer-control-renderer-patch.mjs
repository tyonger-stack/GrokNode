// 电脑控制条 — build pass:把控制条运行时追加到 entry chunk,把样式追加到主样式表。
// 官方 0.71.2 chunk-box-desktop-modal--0USskmH.js (oa=52 控制条高度 / stage__frame 尺寸)
// + chunk-teach-recording-controls-CQ4-Ikje.js (双 gate) + preload-vnc.cjs (三通道)
// 的 DOM 覆盖实现。追加字节,不改上游原有字节;delta 见 provenance。

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import {
  COMPUTER_CONTROL_CSS_TOKENS,
  computerControlBarRuntime,
  computerControlBarStyles,
} from './computer-control-renderer-components.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');

// 官方控制条状态图标:0.70.2 用 eye (仅观看) 与 window-pointer-arrow (控制中)。
// 0.18.0 的 cursor-icons 字体与图标表两者都有 (eye=U+EA70),build 期从 entry 的
// 图标注册表对象里取 Literal 值,取不到就 fail-closed。
export function controlIconGlyphs(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const wanted = ['eye', 'window-pointer-arrow'];
  const pending = [ast];
  const found = {};
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'ObjectExpression') {
      for (const prop of node.properties) {
        if (prop.type !== 'Property' || prop.computed) continue;
        const key = prop.key.value ?? prop.key.name;
        if (wanted.includes(key) && prop.value.type === 'Literal' && typeof prop.value.value === 'string' && prop.value.value.length === 1) {
          found[key] = prop.value.value;
        }
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) pending.push(...child);
      else if (child && typeof child.type === 'string') pending.push(child);
    }
  }
  for (const name of wanted) {
    if (typeof found[name] !== 'string') throw new Error('Computer-control patch: icon glyph missing from registry: ' + name);
  }
  return found;
}
const JS_MARKER = '/* grok-node computer control bar';
const CSS_MARKER = '.rcompctl-bar';

const REQUIRED_ANCHORS = [
  'sand-computer-fullscreen',
  'sand-computer-stage__frame',
  'sand:vnc-viewer-visible',
  'sandInteractive',
];

export function patchComputerControlRenderer(source, runtime) {
  if (source.includes(JS_MARKER)) throw new Error('Computer-control renderer patch was already applied.');
  for (const anchor of REQUIRED_ANCHORS) {
    if (!source.includes(anchor)) throw new Error('Computer-control patch: missing anchor: ' + anchor);
  }
  const patched = source + runtime;
  parse(patched, { ecmaVersion: 'latest', sourceType: 'module' });
  return patched;
}

export async function applyComputerControlRendererPatch({ stageRoot }) {
  const rendererRoot = path.join(stageRoot, 'dist', 'renderer');
  const html = await readFile(path.join(rendererRoot, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/src="\.\/(assets\/[^\"]+\.js)"/g)].map((match) => match[1]);
  const entryScripts = scripts.filter((name) => /\/index-[^/]+\.js$/.test(name));
  if (entryScripts.length !== 1) throw new Error('Computer-control patch: expected exactly one entry index script, found ' + entryScripts.length + '.');
  const entryPath = path.join(rendererRoot, entryScripts[0]);
  const source = await readFile(entryPath, 'utf8');
  const glyphs = controlIconGlyphs(source);
  const runtime = computerControlBarRuntime(glyphs);
  const patched = patchComputerControlRenderer(source, runtime);
  await writeFile(entryPath, patched);

  const cssFiles = (await readdir(path.join(rendererRoot, 'assets'))).filter((file) => /^index-.*\.css$/.test(file));
  if (cssFiles.length !== 1) throw new Error('Computer-control patch: expected one main renderer stylesheet, found ' + cssFiles.length + '.');
  const cssPath = path.join(rendererRoot, 'assets', cssFiles[0]);
  const css = await readFile(cssPath, 'utf8');
  if (css.includes(CSS_MARKER)) throw new Error('Computer-control patch: stylesheet already carries the control bar styles.');
  for (const token of COMPUTER_CONTROL_CSS_TOKENS) {
    if (!css.includes(token)) throw new Error('Computer-control patch: missing design token: ' + token);
  }
  const styles = computerControlBarStyles();
  const patchedCss = css + styles;
  await writeFile(cssPath, patchedCss);
  console.log('Computer-control bar: appended control runtime to ' + entryScripts[0] + '; styles to ' + cssFiles[0]);

  const provenance = {
    mode: 'computer-control-bar-dom-overlay',
    behavior: 'Fullscreen computer view defaults to view-only (仅观看). Take-control (取得控制权) sends sand:vnc-accepts-input=true plus the interactive and viewer-visible channels; stop (停止) sends false. Two-layer gate: the renderer adds sand-47corl (pointer-events:none) to the webview wrapper and sets aria-hidden/tabindex=-1 while !acceptsInput, and the preload forwards keys, clipboard and Mac shortcuts only when interactive && acceptsInput. Closing the overlay, swapping the stage webview or pagehide revokes all three channels fail-closed.',
    evidence: 'Grok Bot 0.71.2 chunk-box-desktop-modal--0USskmH.js (oa=52; sand-computer-stage__frame width min(100cqw, calc((100cqh - 52px) * 1920 / 1200)); aspectRatio 1920/1200; footer sand-78zum5 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-h8yej3 sand-dd8jsf sand-1qj4qm9 rcompctl-footer), chunk-teach-recording-controls-CQ4-Ikje.js (E = isInteractive && acceptsInput; sand-47corl pointer-events gate), preload-vnc.cjs (Sn sand:vnc-interactive, _n sand:vnc-accepts-input, ke sand:vnc-viewer-visible; ur(e) keeps n && t). Upstream 0.18.0 anchors: sand-computer-fullscreen, sand-computer-stage__frame, sand:vnc-viewer-visible webview.send pattern, sandInteractive URL param.',
    delta: 'Control bar stays a DOM overlay rather than a React control prop. Official 0.71.2 hint semantics: the 2500ms computer-watch-hint appears only when a view-only user clicks the stage, not on stop; the aria-hidden hintCount measure span is omitted. The stop path fails closed across all three channels and re-blocks the wrapper. acceptsInput defaults to false in the preload even though the official boot value can be true. Two bar classes absent from 0.18.0 are shimmed: sand-11lfxj5 via sand-qrzla8 and sand-5fd6op border-color via .rcompctl-bar. The 52px carrier strip uses --cursor-chrome because 0.18.0 has no --sand-bg-chrome token.',
    icons: { eye: 'U+' + glyphs.eye.codePointAt(0).toString(16).toUpperCase(), pointer: 'U+' + glyphs['window-pointer-arrow'].codePointAt(0).toString(16).toUpperCase(), font: 'cursor-icons (0.18.0 shipped woff2)' },
    entry: entryScripts[0],
    stylesheet: cssFiles[0],
    files: [
      { file: entryScripts[0], originalSha256: hash(source), patchedSha256: hash(patched) },
      { file: cssFiles[0], originalSha256: hash(css), patchedSha256: hash(patchedCss) },
    ],
  };
  const provenancePath = path.join(stageRoot, 'dist', 'renderer-computer-control-extension.json');
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + '\n');
  return provenance;
}
