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
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {CustomMcpForm, validateCustomMcpDraft, customMcpConfigJson, EMPTY_CUSTOM_MCP_DRAFT} from './frontend/src/extensions/custom-mcp-form';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);
async function render(props) { await ui.act(async () => root.render(ui.createElement(ui.CustomMcpForm, { onSubmit: () => {}, onCancel: () => {}, ...props }))); }
function setNativeValue(element, value) {
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

test('draft validation mirrors the upstream add-server rules', () => {
  assert.equal(ui.validateCustomMcpDraft({ name: '', url: 'https://x.test/mcp', headers: [] }), 'required-name');
  assert.equal(ui.validateCustomMcpDraft({ name: 'a', url: 'not a url', headers: [] }), 'invalid-url');
  assert.equal(ui.validateCustomMcpDraft({ name: 'a', url: 'ftp://x.test/mcp', headers: [] }), 'non-http-url');
  assert.equal(ui.validateCustomMcpDraft({ name: 'a', url: 'https://user@x.test/mcp', headers: [] }), 'credentials-in-url');
  assert.equal(ui.validateCustomMcpDraft({ name: 'a', url: 'https://x.test/mcp', headers: [] }), null);
  const config = JSON.parse(ui.customMcpConfigJson({ name: 'a', url: 'https://x.test/mcp', headers: [{ key: 'Authorization', value: 'Bearer t' }, { key: ' ', value: 'dropped' }] }));
  assert.equal(config.type, 'http');
  assert.equal(config.url, 'https://x.test/mcp');
  assert.deepEqual(config.headers, { Authorization: 'Bearer t' });
});

test('form blocks save until name and url validate, then submits the draft', async () => {
  let submitted = null;
  await render({ onSubmit: (d) => { submitted = d; } });
  const save = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save');
  assert.ok(save().disabled, 'save disabled for empty draft');
  const name = host.querySelector('input[name="customMcpName"]');
  const url = host.querySelector('input[name="customMcpUrl"]');
  await ui.act(async () => setNativeValue(name, 'superpowers'));
  await ui.act(async () => setNativeValue(url, 'https://example.com/mcp'));
  assert.ok(!save().disabled, 'save enabled for a valid draft');
  await ui.act(async () => save().click());
  assert.deepEqual(submitted, { name: 'superpowers', url: 'https://example.com/mcp', headers: [] });
});

test('headers can be added and the test hook reports progress', async () => {
  await render({ onSubmit: () => {}, onTest: () => {}, testState: 'testing' });
  assert.match(host.textContent, /Testing/);
  const add = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add header');
  await ui.act(async () => add.click());
  assert.equal(host.querySelectorAll('.sand-custom-mcp-header-row').length, 1);
  await render({ onSubmit: () => {}, testState: 'failed', testMessage: 'boom' });
  assert.match(host.textContent, /boom/);
});
