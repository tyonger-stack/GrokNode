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
  COMPUTER_CONTROL_FOOTER_CLASSES,
  COMPUTER_CONTROL_INTERACTIVE_CHANNEL,
  COMPUTER_CONTROL_LABELS,
  COMPUTER_CONTROL_STAGE_ASPECT_RATIO,
  COMPUTER_CONTROL_STAGE_WIDTH,
  COMPUTER_CONTROL_VIEWER_VISIBLE_CHANNEL,
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

function runRuntime(document, overrides = {}) {
  const window = document.defaultView;
  const sandbox = { window, document, MutationObserver: window.MutationObserver, console, setTimeout, clearTimeout, ...overrides };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(computerControlBarRuntime(GLYPHS), sandbox);
  return sandbox;
}

function buildBox(document, withWebview) {
  const box = document.createElement('div');
  box.className = 'sand-computer-fullscreen';
  const stage = document.createElement('div');
  stage.className = 'sand-computer-stage';
  const frame = document.createElement('div');
  frame.className = 'sand-computer-stage__frame';
  let webview = null;
  let wrapper = null;
  if (withWebview) {
    wrapper = document.createElement('div');
    wrapper.className = 'sand-10l6tqk sand-10a8y8t';
    webview = document.createElement('webview');
    webview.sent = [];
    webview.send = function (channel, value) { webview.sent.push([channel, value]); };
    webview.setAttribute('src', 'https://box/vnc.html?sandInteractive=1');
    wrapper.appendChild(webview);
    frame.appendChild(wrapper);
  }
  stage.appendChild(frame);
  box.appendChild(stage);
  document.body.appendChild(box);
  return { box, stage, frame, wrapper, webview };
}

function channelCalls(webview, channel) {
  return webview.sent.filter((entry) => entry[0] === channel).map((entry) => entry[1]);
}

function afterMutation(window, target, action) {
  return new Promise((resolve) => {
    const observer = new window.MutationObserver(() => {
      observer.disconnect();
      resolve();
    });
    observer.observe(target, { childList: true, subtree: true });
    action();
  });
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
  const wrap = env.stage.querySelector(':scope > .rcompctl-footer');
  assert.ok(wrap, 'wrap mounted');
  assert.equal(wrap.parentElement, env.stage, 'official 0.71.2: footer is the second flex child of sand-computer-stage');
  // happy-dom 的 CSS 解析器不支持 min() 与容器查询单位,会丢弃该声明;
  // 官方取值的断言放在运行时字符串上,这里只验证还原路径。
  assert.equal(computerControlBarRuntime(GLYPHS).includes('frame.style.width=STAGE_W'), true);
  assert.equal(env.frame.style.aspectRatio, COMPUTER_CONTROL_STAGE_ASPECT_RATIO);
  assert.ok(env.stage.classList.contains('sand-dt5ytf'), 'stage is a flex column');
  assert.equal(env.wrapper.classList.contains('sand-47corl'), true, 'view-only blocks pointer events on the webview wrapper');
  assert.equal(env.webview.getAttribute('aria-hidden'), 'true');
  assert.equal(env.webview.getAttribute('tabindex'), '-1');
  assert.deepEqual(channelCalls(env.webview, COMPUTER_CONTROL_INTERACTIVE_CHANNEL).at(-1), true, 'sandInteractive=1 in src');
  assert.deepEqual(channelCalls(env.webview, COMPUTER_CONTROL_VIEWER_VISIBLE_CHANNEL).at(-1), true);
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
  assert.deepEqual(channelCalls(env.webview, COMPUTER_CONTROL_CHANNEL), [false, true]);
  assert.equal(env.wrapper.classList.contains('sand-47corl'), false, 'taking control restores pointer events');
  assert.equal(env.webview.hasAttribute('aria-hidden'), false);
  assert.equal(env.webview.hasAttribute('tabindex'), false);
  assert.equal(icon.getAttribute('data-icon-name'), 'window-pointer-arrow');
  assert.equal(btn.getAttribute('data-variant'), 'secondary');
  assert.equal(btn.textContent, COMPUTER_CONTROL_LABELS.stop);
  assert.equal(status.textContent.includes(COMPUTER_CONTROL_LABELS.inControl), true);
  assert.equal(hint.style.display, 'none');
  btn.click();
  assert.equal(channelCalls(env.webview, COMPUTER_CONTROL_CHANNEL).at(-1), false);
  assert.equal(env.wrapper.classList.contains('sand-47corl'), true, 'stop re-blocks pointer events immediately');
  assert.equal(btn.textContent, COMPUTER_CONTROL_LABELS.take);
  assert.equal(hint.style.display, 'none', 'official 0.71.2: stop does not raise the watch hint');
  env.frame.dispatchEvent(new window.Event('pointerdown'));
  assert.equal(hint.style.display, '', 'only a view-only click on the stage raises the 2500ms hint');
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
  replacement.setAttribute('src', 'https://box/vnc.html?sandInteractive=1');
  env.frame.appendChild(replacement);
  env.webview.remove();
  await tick(); await tick(); await tick();
  assert.deepEqual(env.webview.sent.at(-1), [COMPUTER_CONTROL_VIEWER_VISIBLE_CHANNEL, false], 'old webview fails closed on all three channels');
  assert.equal(channelCalls(env.webview, COMPUTER_CONTROL_CHANNEL).at(-1), false);
  assert.equal(channelCalls(env.webview, COMPUTER_CONTROL_INTERACTIVE_CHANNEL).at(-1), false);
  assert.deepEqual(channelCalls(replacement, COMPUTER_CONTROL_CHANNEL), [false], 'new webview boots view-only');
  assert.equal(env.box.querySelector('button').textContent, COMPUTER_CONTROL_LABELS.take);
  await window.happyDOM.close();
});

test('switching stage transfers load listeners to the replacement webview', async (t) => {
  const window = new Window();
  t.after(() => window.happyDOM.close());
  const env = buildBox(window.document, true);
  runRuntime(window.document);
  const replacement = window.document.createElement('webview');
  replacement.sent = [];
  replacement.send = (...args) => replacement.sent.push(args);
  replacement.setAttribute('src', 'https://box/vnc.html?sandInteractive=1');

  await afterMutation(window, env.wrapper, () => env.wrapper.replaceChild(replacement, env.webview));
  replacement.sent.length = 0;
  replacement.dispatchEvent(new window.Event('dom-ready'));
  replacement.dispatchEvent(new window.Event('did-finish-load'));

  assert.equal(replacement.sent.length, 6, 'replacement load events resync all three channels');
  env.webview.dispatchEvent(new window.Event('dom-ready'));
  env.webview.dispatchEvent(new window.Event('did-finish-load'));
  assert.equal(replacement.sent.length, 6, 'detached guest no longer owns load listeners');
});

test('stopping control cancels the effect of an already scheduled focus probe', async (t) => {
  const window = new Window();
  t.after(() => window.happyDOM.close());
  const env = buildBox(window.document, true);
  const timers = [];
  let focusCalls = 0;
  env.webview.focus = () => { focusCalls++; };
  runRuntime(window.document, {
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
  });
  const button = env.box.querySelector('button');
  button.click();
  button.click();
  const callsAfterStop = focusCalls;

  for (const callback of timers) callback();

  assert.equal(button.textContent, COMPUTER_CONTROL_LABELS.take);
  assert.equal(focusCalls, callsAfterStop, 'a stale probe must not focus a view-only guest');
});

test('closing fullscreen disconnects its observer and invalidates pending focus', async (t) => {
  const window = new Window();
  t.after(() => window.happyDOM.close());
  const env = buildBox(window.document, true);
  const observers = [];
  const timers = [];
  let focusCalls = 0;
  class TrackedObserver extends window.MutationObserver {
    disconnected = false;
    observe(target, options) { this.target = target; super.observe(target, options); }
    disconnect() { this.disconnected = true; super.disconnect(); }
    constructor(callback) { super(callback); observers.push(this); }
  }
  env.webview.focus = () => { focusCalls++; };
  runRuntime(window.document, {
    MutationObserver: TrackedObserver,
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
  });
  env.box.querySelector('button').click();
  const boxObserver = observers.find((observer) => observer.target === env.box);

  await afterMutation(window, window.document.body, () => env.box.remove());
  const callsAfterClose = focusCalls;
  for (const callback of timers) callback();

  assert.equal(boxObserver.disconnected, true, 'the detached fullscreen subtree is no longer observed');
  assert.equal(focusCalls, callsAfterClose, 'a closed fullscreen guest must not regain focus');
  const sentAfterClose = env.webview.sent.length;
  env.webview.dispatchEvent(new window.Event('dom-ready'));
  assert.equal(env.webview.sent.length, sentAfterClose, 'closed guests no longer resync channels');
});

test('view-only webview src without sandInteractive reports interactive false', async () => {
  const window = new Window();
  const document = window.document;
  const env = buildBox(document, true);
  env.webview.setAttribute('src', 'https://box/vnc.html');
  runRuntime(document);
  await tick(); await tick();
  assert.equal(channelCalls(env.webview, COMPUTER_CONTROL_INTERACTIVE_CHANNEL).at(-1), false);
  await window.happyDOM.close();
});

test('channels resync on webview load events and visibility changes', async () => {
  const window = new Window();
  const document = window.document;
  const env = buildBox(document, true);
  runRuntime(document);
  await tick(); await tick();
  const before = env.webview.sent.length;
  env.webview.dispatchEvent(new window.Event('dom-ready'));
  env.webview.dispatchEvent(new window.Event('did-finish-load'));
  document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(env.webview.sent.length, before + 9, 'three channels x three lifecycle events');
  await window.happyDOM.close();
});

test('removing the fullscreen box tears the stage layout back down', async () => {
  const window = new Window();
  const document = window.document;
  const env = buildBox(document, true);
  env.frame.style.width = 'calc(100cqh - 10px)';
  runRuntime(document);
  await tick(); await tick();
  assert.equal(env.stage.classList.contains('sand-dt5ytf'), true);
  env.box.remove();
  await tick(); await tick();
  assert.equal(env.stage.classList.contains('sand-dt5ytf'), false);
  assert.equal(env.stage.querySelector('.rcompctl-footer'), null);
  assert.equal(env.frame.style.width, 'calc(100cqh - 10px)');
  assert.equal(env.wrapper.classList.contains('sand-47corl'), false);
  assert.deepEqual(env.webview.sent.at(-1), [COMPUTER_CONTROL_VIEWER_VISIBLE_CHANNEL, false]);
  await window.happyDOM.close();
});

test('no stage container means no bar at all', async () => {
  const window = new Window();
  const document = window.document;
  const env = buildBox(document, true);
  env.stage.classList.remove('sand-computer-stage');
  runRuntime(document);
  await tick(); await tick();
  assert.equal(env.box.querySelector('.rcompctl-footer'), null, 'no position:absolute fallback in 0.71.2');
  assert.equal(env.webview.sent.length, 0);
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
  for (const cls of COMPUTER_CONTROL_FOOTER_CLASSES.split(' ')) assert.ok(computerControlBarRuntime(GLYPHS).includes(cls), cls);
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
