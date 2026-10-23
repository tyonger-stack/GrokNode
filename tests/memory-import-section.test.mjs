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
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {MemoryImportSection, previewMemoryImport, DEFAULT_MEMORY_IMPORT_COPY} from './frontend/src/recovered/features/settings/overlay/memory-import-section';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);
function setNativeValue(element, value) {
  const proto = window.HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}
async function render(props) { await ui.act(async () => root.render(ui.createElement(ui.MemoryImportSection, props))); }

test('preview splits pasted text and flags duplicates before import', () => {
  const preview = ui.previewMemoryImport('User likes tea.\n\nUser likes tea.\nNew fact.\n', ['Other fact.']);
  assert.deepEqual(preview.plan.items.map((item) => item.content), ['User likes tea.', 'New fact.']);
  assert.deepEqual(preview.plan.duplicates, ['User likes tea.']);
});

test('two-step flow previews then imports only new facts', async () => {
  let imported = null;
  await render({ existingContents: ['Known fact.'], onImport: (items) => { imported = items; } });
  const area = host.querySelector('textarea');
  assert.ok(area);
  await ui.act(async () => setNativeValue(area, 'Fresh fact.\nKnown fact.\n'));
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add to Memory').click());
  assert.match(host.textContent, /Fresh fact/);
  assert.equal(imported, null, 'first click only stages the preview');
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add to Memory').click());
  assert.deepEqual(imported.map((item) => item.content), ['Fresh fact.']);
});

test('a chosen file is imported as a file source', async () => {
  let preview = null;
  await render({ existingContents: [], onImport: (_items, next) => { preview = next; } });
  const input = host.querySelector('input[type="file"]');
  assert.equal(input.getAttribute('aria-label'), 'Choose file');
  const file = new window.File(['Lives in Shanghai.\n'], 'memories.md', { type: 'text/markdown' });
  await ui.act(async () => {
    input.files = [file];
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await ui.act(async () => { await Promise.resolve(); });
  assert.equal(host.querySelector('textarea').value, 'Lives in Shanghai.\n');
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add to Memory').click());
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add to Memory').click());
  assert.equal(preview.kind, 'file');
  assert.equal(preview.fileName, 'memories.md');
  assert.deepEqual(preview.plan.items.map((item) => item.content), ['Lives in Shanghai.']);
});

test('empty paste keeps import disabled', async () => {
  await render({ existingContents: [], onImport: () => { throw new Error('must not import'); } });
  assert.ok([...host.querySelectorAll('button')].find((b) => b.textContent === 'Add to Memory').disabled);
});

test.after(async () => {
  await ui.act(async () => root.unmount());
  host.remove();
  await closeLibraryDom(window);
});
