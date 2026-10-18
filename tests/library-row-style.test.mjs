import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { closeLibraryDom } from './library-dom-teardown.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const evidence = process.env.LIBRARY_STYLE_EVIDENCE_DIR;
const pinnedStylesheet = path.join(repo, 'src/app/dist/renderer/assets/index-lCyB53CO.css');
const pinnedStylesheetAvailable = existsSync(pinnedStylesheet);
const window = new Window({ settings: { disableCSSFileLoading: true } });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[name] = name === 'window' ? window : window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const built = await build({ stdin: { contents: `export {createElement,act} from 'react'; export {createRoot} from 'react-dom/client'; export {LibraryMediaRow,LibraryPageRow,LibraryExternalRow} from './frontend/src/recovered/features/library/library-row';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const style = document.createElement('style');
style.textContent = (pinnedStylesheetAvailable ? readFileSync(pinnedStylesheet, 'utf8') : '') + '\n' + readFileSync(path.join(repo, 'frontend/src/recovered/features/library/library-list.css'), 'utf8');
document.head.append(style);
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);
const nowMs = Date.parse('2026-10-11T00:00:00Z');
const base = { nowMs, resolveThumb: async () => { throw new Error('unavailable'); }, onOpen: () => {} };
function row(kind, name = 'Original name') { return { id: 'r', kind, name, source: '/r', timestampMs: nowMs - 3600000 }; }
async function render(component, props) { await ui.act(async () => root.render(ui.createElement(component, props))); }
function record(name, details) {
  if (!evidence) return;
  mkdirSync(evidence, { recursive: true });
  writeFileSync(path.join(evidence, name + '.html'), host.outerHTML);
  writeFileSync(path.join(evidence, name + '.json'), JSON.stringify({ scenario: name, pass: true, ...details }, null, 2));
}
after(async () => { await ui.act(async () => root.unmount()); await closeLibraryDom(window); });

test('official file-kind glyphs preserve original names and click action', async () => {
  const cases = { 'a.pdf':'file-pdf', 'a.docx':'file-text', 'a.csv':'table', 'a.xlsx':'table', 'a.md':'markdown', 'a.mdx':'markdown', 'a.json':'json', 'a.jsonc':'json', 'a.ndjson':'json', 'a.py':'file-text', 'a.sh':'file-text', 'a.zip':'folder', 'a.txz':'folder', 'a.mp3':'music', 'a.avif':'image', 'a.mov':'video-camera', 'a.unknown':'file', '.pdf':'file', 'https://x.test/a%2Epdf?q=1':'file-pdf' };
  let opened = 0;
  for (const [name, glyph] of Object.entries(cases)) {
    await render(ui.LibraryMediaRow, { ...base, row: row('file', name), onOpen: () => opened++ });
    assert.equal(host.querySelector('[data-icon-name]').dataset.iconName, glyph, name);
    assert.equal(host.querySelector('bdi').textContent, name);
    assert.equal(host.querySelector('[data-icon-name]').dataset.size, 'lg');
    await ui.act(async () => host.querySelector('button').click());
  }
  assert.equal(opened, Object.keys(cases).length);
  record('file-glyphs', { cases, opened });
});

test('image resolution and decode failures retain a 24px placeholder; stale sources cannot bleed', async () => {
  let settle;
  await render(ui.LibraryMediaRow, { ...base, row: row('image'), resolveThumb: () => new Promise(resolve => { settle = resolve; }) });
  assert.ok(host.querySelector('.sand-library-thumb-slot'));
  assert.equal(host.querySelector('img'), null);
  await ui.act(async () => settle({ kind: 'image', url: 'data:image/png;base64,aA==' }));
  assert.ok(host.querySelector('img'));
  await ui.act(async () => host.querySelector('img').dispatchEvent(new window.Event('error')));
  assert.equal(host.querySelector('img'), null);
  assert.equal(window.getComputedStyle(host.querySelector('.sand-library-thumb-slot')).width, '24px');
  record('image-decode-failure', { placeholderWidth: '24px', brokenImageRemoved: true });
  let stale;
  await render(ui.LibraryMediaRow, { ...base, row: { ...row('image'), source: '/old' }, resolveThumb: () => new Promise(resolve => { stale = resolve; }) });
  await render(ui.LibraryMediaRow, { ...base, row: { ...row('image'), source: '/new' } });
  await ui.act(async () => stale({ kind: 'image', url: 'stale-url' }));
  assert.equal(host.querySelector('img'), null);
  assert.ok(host.querySelector('.sand-library-thumb-slot'));
  record('thumbnail-source-change', { staleSourceDiscarded: true, resolverFailurePlaceholder: true });
});

test('video thumbnail uses the official play path and retains it after load failure', async () => {
  await render(ui.LibraryMediaRow, { ...base, row: row('video'), resolveThumb: async () => ({ kind: 'video', url: 'video-url' }) });
  const video = host.querySelector('video'); assert.ok(video);
  assert.equal(video.preload, 'metadata'); assert.ok(video.hasAttribute('playsinline'));
  assert.equal(host.querySelector('svg').getAttribute('viewBox'), '14.5 0 300 300');
  await ui.act(async () => video.dispatchEvent(new window.Event('error')));
  assert.equal(host.querySelector('video'), null); assert.ok(host.querySelector('.sand-library-play-badge path'));
  record('video-failure', { badgeRetained: true });
});

test('source card, row typography, footer and focus/hover declarations survive the 0.18 stylesheet', { skip: pinnedStylesheetAvailable ? false : 'pinned stylesheet not hydrated' }, async () => {
  await ui.act(async () => root.render(ui.createElement('section', { className: 'sand-agent-library' },
    ui.createElement('div', { className: 'sand-library-group' }, ui.createElement('h3', {}, '今天'),
      ui.createElement('ul', { className: 'sand-library-card' },
        ui.createElement('li', {}, ui.createElement(ui.LibraryMediaRow, { ...base, row: row('file', 'Name.pdf') })),
        ui.createElement('li', {}, ui.createElement('button', { type: 'button', className: 'sand-library-expand' }, '展开')))))));
  const get = selector => window.getComputedStyle(host.querySelector(selector));
  const actual = {
    cardRadius: get('ul').borderRadius,
    cardBorder: get('ul').borderTopWidth,
    cardPadding: get('ul').paddingTop,
    cardBackground: get('ul').backgroundColor,
    cardBorderColor: get('ul').borderTopColor,
    listStyle: get('ul').listStyle,
    rowPadding: get('.sand-library-row').padding,
    rowGap: get('.sand-library-row').gap,
    fontSize: get('.sand-library-row').fontSize,
    lineHeight: get('.sand-library-row').lineHeight,
    footerHeight: get('.sand-library-expand').height,
    ageMaxWidth: get('.sand-library-age').maxWidth,
  };
  // Official 0.71.2 cl.card: sand-10e981r (bg-elevated) + sand-5fd6op (border-tertiary-translucent).
  // happy-dom resolves missing tokens to transparent / default; assert declared values via rules too.
  assert.equal(actual.cardRadius, '12px');
  assert.equal(actual.cardBorder, '0.5px');
  assert.equal(actual.cardPadding, '4px');
  assert.equal(actual.listStyle, 'none');
  assert.equal(actual.rowPadding, '6px 8px');
  assert.equal(actual.rowGap, '8px');
  assert.equal(actual.fontSize, '13px');
  assert.equal(actual.lineHeight, '18px');
  assert.equal(actual.footerHeight, '32px');
  assert.equal(actual.ageMaxWidth, '0');
  const rules = [...style.sheet.cssRules].filter(rule => rule.selectorText);
  const cardRule = rules.find(rule => rule.selectorText === '.sand-library-card');
  assert.ok(cardRule, 'card rule present');
  assert.equal(cardRule.style.backgroundColor, 'var(--sand-bg-elevated)');
  // happy-dom may drop nested var() from borderColor CSSOM; assert source text.
  const listCss = readFileSync(path.join(repo, 'frontend/src/recovered/features/library/library-list.css'), 'utf8');
  assert.match(listCss, /background-color:\s*var\(--sand-bg-elevated\)/);
  assert.match(listCss, /border:\s*\.5px solid var\(--sand-border-tertiary-translucent,\s*var\(--sand-border-weak\)\)/);
  assert.match(listCss, /background-color:\s*var\(--sand-bg-secondary,\s*var\(--sand-fill-ghost-hover\)\)/);
  assert.ok(rules.some(rule => rule.selectorText.includes('.sand-library-row:focus-visible') && rule.style.boxShadow === '0 0 0 2px var(--sand-border-focus)'));
  assert.ok(rules.some(rule => rule.selectorText.includes('.sand-library-row:hover:not(:disabled) .sand-library-age') && rule.style.maxWidth === 'none' && rule.style.opacity === '1'));
  record('source-style-contract', { actual, hoverAndFocusRulesPresent: true, scope: 'DOM/CSS contract, not live browser layout or visual QA' });
});

test('page and connected-document metadata remains stacked and visible', { skip: pinnedStylesheetAvailable ? false : 'pinned stylesheet not hydrated' }, async () => {
  const page = { kind:'canvas', storeId:'s', canvasId:'c', title:'Original title', visibility:'private', createdAtMs:nowMs-7200000, updatedAtMs:nowMs-3600000 };
  await render(ui.LibraryPageRow, { page, nowMs, origin:null, provider:{}, links:{}, onOpen:()=>{}, onVisibilityChange:()=>{} });
  assert.equal(host.querySelector('[data-icon-name]').dataset.iconName, 'browser');
  assert.equal(host.querySelector('.sand-library-title').textContent, page.title);
  assert.match(host.querySelector('.sand-library-meta').textContent, /画布 · 私密 · 编辑于/);
  assert.equal(window.getComputedStyle(host.querySelector('.sand-library-copy')).flexDirection, 'column');
  assert.equal(window.getComputedStyle(host.querySelector('.sand-library-meta')).fontSize, '12px');
  record('page-metadata', { originalTitlePreserved:true, glyph:'browser', metadataStacked:true });
  await render(ui.LibraryExternalRow, { nowMs, onOpen:()=>{}, doc:{ provider:'google-drive', url:'https://example.test/doc', title:'External title', lastTouchedAtMs:nowMs-3600000, lastAction:'edited' } });
  assert.equal(host.querySelector('.sand-library-title').textContent, 'External title');
  assert.match(host.querySelector('.sand-library-meta').textContent, /编辑于/);
  record('external-metadata', { originalTitlePreserved:true, glyph:'file-text' });
});
