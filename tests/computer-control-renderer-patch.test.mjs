import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';
import { Window } from 'happy-dom';
import {
  COMPUTER_CONTROL_BAR_CLASSES,
  COMPUTER_CONTROL_CHANNEL,
  COMPUTER_CONTROL_CSS_TOKENS,
  COMPUTER_CONTROL_LABELS,
  computerControlBarRuntime,
  computerControlBarStyles,
} from '../scripts/lib/computer-control-renderer-components.mjs';
import { controlIconGlyphs, patchComputerControlRenderer, applyComputerControlRendererPatch } from '../scripts/lib/computer-control-renderer-patch.mjs';

const GLYPHS = { eye: '\uea70', 'window-pointer-arrow': '\uebd1' };
const glyphEscape = (ch) => String.fromCharCode(92) + ch.codePointAt(0).toString(16);

const FIXTURE_JS = [
  'var fullscreen = "sand-computer-fullscreen";',
  'var frame = "sand-computer-stage__frame";',
  'var viewerChannel = "sand:vnc-viewer-visible";',
  'var interactive = "sandInteractive";',
  'var icons = { "eye": "\uea70", "window-pointer-arrow": "\uebd1", "moon-z": "\uf46f" };',
  'console.log(fullscreen, frame, viewerChannel, interactive, icons);',
].join('\n');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function runRuntime(document) {
  const window = document.defaultView;
  const sandbox = { window, document, MutationObserver: window.MutationObserver, console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(computerControlBarRuntime(GLYPHS), sandbox);
  return sandbox;
}

function buildBox(document, withWebview) {
  const box = document.createElement('div');
  box.className = 'sand-computer-fullscreen';
  const frame = document.createElement('div');
  frame.className = 'sand-computer-stage__frame';
  let webview = null;
  if (withWebview) {
    webview = document.createElement('webview');
    webview.sent = [];
    webview.send = function (channel, value) { webview.sent.push([channel, value]); };
    frame.appendChild(webview);
  }
  box.appendChild(frame);
  document.body.appendChild(box);
  return { box, frame, webview };
}

test('runtime carries official labels, channel and both icon glyphs', () => {
  const runtime = computerControlBarRuntime(GLYPHS);
  for (const label of Object.values(COMPUTER_CONTROL_LABELS)) assert.ok(runtime.includes(label), label);
  assert.ok(runtime.includes(COMPUTER_CONTROL_CHANNEL));
  assert.ok(runtime.includes(glyphEscape(GLYPHS.eye)) && runtime.includes(glyphEscape(GLYPHS['window-pointer-arrow'])), 'icon glyphs embedded as CSS escape sequences');
  assert.ok(runtime.includes('sand-kit-button'), 'native kit button classes');
  assert.ok(runtime.includes('ui-1qt6sjn'), 'cursor-icons font family class');
  parse(runtime, { ecmaVersion: 'latest' });
});

test('controlIconGlyphs reads the shipped registry and fails closed', () => {
  assert.deepEqual(controlIconGlyphs(FIXTURE_JS), GLYPHS);
  assert.throws(() => controlIconGlyphs('var icons = { "eye": "\uea70" }; console.log(icons);'), /window-pointer-arrow/);
});

test('patch appends once and refuses double application or missing anchors', () => {
  const runtime = computerControlBarRuntime(GLYPHS);
  const patched = patchComputerControlRenderer(FIXTURE_JS, runtime);
  assert.ok(patched.includes('/* grok-node computer control bar'));
  assert.throws(() => patchComputerControlRenderer(patched, runtime), /already applied/);
  assert.throws(() => patchComputerControlRenderer('console.log(1);', runtime), /missing anchor/);
});

test('bar mounts view-only with official pill structure and flips on take/stop', async () => {
  const window = new Window();
  const document = window.document;
  const env = buildBox(document, true);
  runRuntime(document);
  await tick(); await tick();
  const wrap = env.box.querySelector(':scope > .rcompctl-footer');
  assert.ok(wrap, 'wrap mounted');
  const bar = wrap.querySelector('.rcompctl-bar');
  assert.ok(bar, 'bar mounted');
  for (const cls of COMPUTER_CONTROL_BAR_CLASSES.split(' ')) assert.ok(bar.classList.contains(cls), cls);
  const status = bar.querySelector('span[aria-live=polite]');
  const icon = status.querySelector('i.ui-icon');
  const btn = bar.querySelector('button');
  const hint = status.querySelectorAll('span')[1];
  assert.ok(btn.parentElement.className.includes('sand-1n2onr6'), 'official kn wrapper span around the button');
  assert.equal(hint.style.display, 'none', 'hint hidden on first view-only mount');
  assert.equal(icon.getAttribute('data-icon-name'), 'eye');
  assert.equal(status.textContent.includes(COMPUTER_CONTROL_LABELS.viewOnly), true);
  assert.equal(btn.getAttribute('data-variant'), 'primary');
  assert.equal(btn.textContent, COMPUTER_CONTROL_LABELS.take);
  btn.click();
  assert.deepEqual(env.webview.sent, [[COMPUTER_CONTROL_CHANNEL, true]]);
  assert.equal(icon.getAttribute('data-icon-name'), 'window-pointer-arrow');
  assert.equal(btn.getAttribute('data-variant'), 'secondary');
  assert.equal(btn.textContent, COMPUTER_CONTROL_LABELS.stop);
  assert.equal(status.textContent.includes(COMPUTER_CONTROL_LABELS.inControl), true);
  assert.equal(hint.style.display, 'none');
  btn.click();
  assert.deepEqual(env.webview.sent[1], [COMPUTER_CONTROL_CHANNEL, false]);
  assert.equal(btn.textContent, COMPUTER_CONTROL_LABELS.take);
  assert.equal(hint.style.display, '', 'hint shows after stopping control back to view-only');
  await new Promise((resolve) => setTimeout(resolve, 2600));
  assert.equal(hint.style.display, 'none', 'hint hides after the official 2500ms watch-hint window');
  await window.happyDOM.close();
});

test('switching stage revokes control on the old webview', async () => {
  const window = new Window();
  const document = window.document;
  const env = buildBox(document, true);
  runRuntime(document);
  await tick(); await tick();
  const btn = env.box.querySelector('.rcompctl-btn') ?? env.box.querySelector('button');
  btn.click();
  const replacement = document.createElement('webview');
  replacement.sent = [];
  replacement.send = function (channel, value) { replacement.sent.push([channel, value]); };
  env.frame.appendChild(replacement);
  env.webview.remove();
  await tick(); await tick(); await tick();
  assert.deepEqual(env.webview.sent[1], [COMPUTER_CONTROL_CHANNEL, false]);
  assert.equal(env.box.querySelector('button').textContent, COMPUTER_CONTROL_LABELS.take);
  await window.happyDOM.close();
});

test('no stage webview means no bar, and styles carry the shim tokens', async () => {
  const window = new Window();
  const document = window.document;
  const env = buildBox(document, false);
  runRuntime(document);
  await tick(); await tick();
  assert.equal(env.box.querySelector('.rcompctl-footer'), null);
  const css = computerControlBarStyles();
  for (const token of COMPUTER_CONTROL_CSS_TOKENS) assert.ok(css.includes(token), token);
  assert.ok(css.includes('.rcompctl-footer'));
  await window.happyDOM.close();
});

test('apply end to end writes provenance with icon codepoints', async () => {
  const stageRoot = mkdtempSync(path.join(tmpdir(), 'ctl-patch-'));
  mkdirSync(path.join(stageRoot, 'dist', 'renderer', 'assets'), { recursive: true });
  writeFileSync(path.join(stageRoot, 'dist', 'renderer', 'index.html'), '<script src="./assets/index-AbC123.js"></script>');
  writeFileSync(path.join(stageRoot, 'dist', 'renderer', 'assets', 'index-AbC123.js'), FIXTURE_JS);
  const cssTokens = COMPUTER_CONTROL_CSS_TOKENS.map((t) => t + ':x;').join('');
  writeFileSync(path.join(stageRoot, 'dist', 'renderer', 'assets', 'index-AbC123.css'), ':root{' + cssTokens + '}');
  const provenance = await applyComputerControlRendererPatch({ stageRoot });
  assert.equal(provenance.icons.eye, 'U+EA70');
  assert.equal(provenance.icons.pointer, 'U+EBD1');
  const js = readFileSync(path.join(stageRoot, 'dist', 'renderer', 'assets', 'index-AbC123.js'), 'utf8');
  assert.ok(js.includes(COMPUTER_CONTROL_LABELS.take));
});
