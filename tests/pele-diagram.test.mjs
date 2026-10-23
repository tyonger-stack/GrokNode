import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { closeLibraryDom } from './library-dom-teardown.mjs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const window = new Window({ settings: { disableCSSFileLoading: true } });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[name] = name === 'window' ? window : window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {PeleDiagram, DiagramBlock, selectDiagramSyntax, PELE_GATE_NAME, PELE_THEME_VARIABLES} from './frontend/src/recovered/features/conversation/workspace/pele';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);
function el(component, props) { return ui.createElement(component, props); }
async function render(element) { await ui.act(async () => root.render(element)); }

test.after(() => {
  try { root.unmount(); } catch { /* already unmounted */ }
  closeLibraryDom(window);
});

test('syntax selection matches the upstream gate plus dev override', () => {
  assert.equal(ui.selectDiagramSyntax({ isPeleGateOn: true }), 'pele');
  assert.equal(ui.selectDiagramSyntax({ isPeleGateOn: false }), 'mermaid');
  assert.equal(ui.selectDiagramSyntax({ isPeleGateOn: true, devOverride: 'mermaid' }), 'mermaid');
  assert.equal(ui.PELE_GATE_NAME, 'sand_enable_pele_diagrams');
  assert.ok(ui.PELE_THEME_VARIABLES.includes('--pele-bg'));
  assert.ok(ui.PELE_THEME_VARIABLES.includes('--pele-series-8'));
});

test('pele renders shipped SVG and falls back without a runtime', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g class="pele-quadrant"><rect width="10" height="10"/></g></svg>';
  await render(el(ui.DiagramBlock, { language: 'pele', code: 'quadrant', peleEnabled: true, loadPeleRuntime: async () => ({ render: async () => ({ svg }) }), fallback: ui.createElement('pre', null, 'fallback') }));
  assert.ok(host.querySelector('.sand-pele svg'), 'pele svg rendered');
  assert.ok(host.querySelector('.pele-quadrant'), 'upstream pele class present');
  await render(el(ui.DiagramBlock, { language: 'pele', code: 'quadrant', peleEnabled: true, fallback: ui.createElement('pre', null, 'fallback') }));
  assert.equal(host.querySelector('.sand-pele'), null);
  assert.match(host.textContent, /fallback/);
});

test('gate off routes pele to fallback and unknown languages pass through', async () => {
  await render(el(ui.DiagramBlock, { language: 'pele', code: 'quadrant', peleEnabled: false, fallback: ui.createElement('pre', null, 'fallback') }));
  assert.equal(host.querySelector('.sand-pele'), null);
  assert.match(host.textContent, /fallback/);
  await render(el(ui.DiagramBlock, { language: 'python', code: 'print(1)', fallback: ui.createElement('pre', null, 'fallback') }));
  assert.match(host.textContent, /fallback/);
  const fallback = ui.createElement('pre', null, 'fallback');
  await render(el(ui.PeleDiagram, { code: 'x', fallback, loadRuntime: async () => { throw new Error('no runtime'); } }));
  assert.match(host.textContent, /fallback/);
});
