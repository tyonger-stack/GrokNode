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
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {CustomMcpFormHost, isCustomMcpServer} from './frontend/src/extensions/custom-mcp-form-host';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);
function setNativeValue(element, value) {
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}
function server(partial) {
  return { id: 's1', name: 'srv', serverIdentifier: 'srv', accountKey: 'default', rowServerIdentifier: 'srv', transport: 'http', toolCount: 1, customInstructions: '', isTeamServer: false, status: 'connected', ...partial };
}
function bridgeWith(servers, hooks = {}) {
  let rows = [...servers];
  return {
    rows,
    async list() { return { servers: rows }; },
    async add({ name, configJson }) {
      hooks.onAdd?.({ name, configJson });
      if (hooks.failAdd) throw new Error(hooks.failAdd);
      rows = [...rows, server({ id: `id-${name}`, name, serverIdentifier: name })];
      return {};
    },
    async remove(serverId) { rows = rows.filter((row) => row.id !== serverId); },
  };
}
async function settle() { await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); }); }
async function render(props) { await ui.act(async () => root.render(ui.createElement(ui.CustomMcpFormHost, props))); await settle(); }

test('host lists only custom servers and filters plugin and team rows', () => {
  assert.ok(ui.isCustomMcpServer(server({})));
  assert.ok(!ui.isCustomMcpServer(server({ pluginId: 'p1' })));
  assert.ok(!ui.isCustomMcpServer(server({ isTeamServer: true })));
});

test('submit adds through the bridge and reloads the list', async () => {
  const calls = [];
  const bridge = bridgeWith([server({ id: 'old', name: 'Old', serverIdentifier: 'old' })], { onAdd: (call) => calls.push(call) });
  await render({ bridge });
  assert.match(host.textContent, /Old/);
  const name = host.querySelector('input[name="customMcpName"]');
  const url = host.querySelector('input[name="customMcpUrl"]');
  await ui.act(async () => setNativeValue(name, 'extra'));
  await ui.act(async () => setNativeValue(url, 'https://example.com/mcp'));
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save').click());
  await ui.act(async () => {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'extra');
  assert.match(calls[0].configJson, /example\.com\/mcp/);
  assert.match(host.textContent, /extra/);
});

test('remove asks twice and surfaces bridge failures', async () => {
  const bridge = bridgeWith([server({ id: 'gone', name: 'Gone', serverIdentifier: 'gone' })]);
  await render({ bridge });
  const row = () => host.querySelector('[data-server-id="gone"]');
  assert.ok(row());
  await ui.act(async () => [...row().querySelectorAll('button')].find((b) => b.textContent === 'Remove').click());
  await ui.act(async () => [...row().querySelectorAll('button')].find((b) => b.textContent === 'Remove').click());
  await ui.act(async () => {});
  assert.equal(host.querySelector('[data-server-id="gone"]'), null);
  const failing = bridgeWith([], { failAdd: 'denied' });
  let changed = 0;
  await render({ bridge: failing, onChanged: () => { changed++; } });
  const name = host.querySelector('input[name="customMcpName"]');
  const url = host.querySelector('input[name="customMcpUrl"]');
  await ui.act(async () => setNativeValue(name, 'nope'));
  await ui.act(async () => setNativeValue(url, 'https://example.com/mcp'));
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save').click());
  await ui.act(async () => {});
  assert.match(host.textContent, /denied/);
  assert.equal(changed, 0);
});

test.after(async () => {
  await ui.act(async () => root.unmount());
  host.remove();
  await closeLibraryDom(window);
});
