import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { closeLibraryDom } from './library-dom-teardown.mjs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const window = new Window({ settings: { disableCSSFileLoading: true } });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[name] = name === 'window' ? window : window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {LibraryExternalRow, LibraryMediaRow, LibraryPageRow, LibraryVisualRow, libraryHoverSummaryForExternal, libraryHoverSummaryForMedia, libraryHoverSummaryForPage, libraryHoverSummaryForVisual} from './frontend/src/recovered/features/library/library-row';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);
const nowMs = Date.parse('2026-10-22T00:00:00Z');
after(async () => { await ui.act(async () => root.unmount()); await closeLibraryDom(window); });
async function render(component, props) { await ui.act(async () => root.render(ui.createElement(component, props))); }
async function settle(ms = 450) { await ui.act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
function hoverWrap() { return host.querySelector('.sand-library-hover-wrap'); }
function card() { return host.querySelector('.sand-library-hover-card'); }
const mediaBase = { nowMs, resolveThumb: async () => { throw new Error('unavailable'); }, onOpen: () => {} };
const imageRow = { id: 'img', kind: 'image', name: 'chart export.png', source: '/exports/chart.png', timestampMs: nowMs - 3600000 };
const page = { kind: 'document', title: 'Roadmap', storeId: 's1', documentId: 'd1', createdAtMs: nowMs - 7200000, updatedAtMs: nowMs - 3600000, visibility: 'team' };
const pageProps = { page, nowMs, origin: null, provider: {}, links: {}, onOpen: () => {}, onVisibilityChange: () => {}, hoverCards: true };
const externalDoc = { url: 'https://example.com/spec', title: '', lastTouchedAtMs: nowMs - 7200000, lastAction: 'viewed', provider: 'example.com' };
const visual = { key: 'viz', title: 'Weekly funnel', timestampMs: nowMs - 3600000 };

test('hover card stays hidden without the gate and without hover', async () => {
  await render(ui.LibraryMediaRow, { ...mediaBase, row: imageRow });
  assert.ok(hoverWrap() === null, 'no wrap without hoverCards');
  assert.equal(card(), null);
});

test('media hover shows title, kind label, and age after the upstream delay', async () => {
  await render(ui.LibraryMediaRow, { ...mediaBase, row: imageRow, hoverCards: true });
  const wrap = hoverWrap();
  assert.ok(wrap, 'wrap rendered');
  assert.equal(card(), null, 'no card before hover');
  wrap.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await settle();
  const shown = card();
  assert.ok(shown, 'card appears after hover delay');
  assert.match(shown.textContent, /chart export\.png/);
  assert.match(shown.textContent, /图片/);
  wrap.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
  await ui.act(async () => {});
  assert.equal(card(), null, 'card hides on leave');
});

test('keyboard focus shows the card and blur hides it', async () => {
  await render(ui.LibraryMediaRow, { ...mediaBase, row: imageRow, hoverCards: true });
  host.querySelector('button').focus();
  await ui.act(async () => {});
  assert.ok(card(), 'card appears on focus');
  host.querySelector('button').blur();
  await ui.act(async () => {});
  assert.equal(card(), null, 'card hides on blur');
});

test('page, external, and visual rows render hover cards with upstream density', async () => {
  await render(ui.LibraryPageRow, pageProps);
  assert.match(hoverWrap().textContent, /Roadmap/);
  hoverWrap().dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await settle();
  assert.match(card().textContent, /文档/);
  assert.match(card().textContent, /团队/);
  await render(ui.LibraryExternalRow, { doc: externalDoc, nowMs, onOpen: () => {}, hoverCards: true });
  hoverWrap().dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await settle();
  assert.match(card().textContent, /example\.com/);
  await render(ui.LibraryVisualRow, { visual, nowMs, onOpen: () => {}, hoverCards: true });
  hoverWrap().dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await settle();
  assert.match(card().textContent, /Weekly funnel/);
});

test('hover summary builders mirror the upstream card content model', () => {
  assert.deepEqual(ui.libraryHoverSummaryForMedia({ ...imageRow, kind: 'video' }, nowMs).typeLabel, '视频');
  assert.deepEqual(ui.libraryHoverSummaryForMedia({ ...imageRow, kind: 'link', url: 'https://x.test/a' }, nowMs).typeLabel, null);
  assert.deepEqual(ui.libraryHoverSummaryForPage({ ...page, kind: 'canvas' }, nowMs).typeLabel, '画布');
  assert.deepEqual(ui.libraryHoverSummaryForExternal(externalDoc).lines, ['https://example.com/spec']);
  assert.deepEqual(ui.libraryHoverSummaryForVisual(visual, nowMs).title, 'Weekly funnel');
});
