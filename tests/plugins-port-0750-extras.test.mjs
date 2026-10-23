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
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {PluginsPort0750Extras} from './frontend/src/recovered/features/plugins/overlay/port-0750-extras';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);
const plugins = [
  { pluginId: 'linear', name: 'linear', displayName: 'Linear', installMode: 'user', isEnabled: true },
  { pluginId: 'team-docs', name: 'team-docs', displayName: 'Team Docs', installMode: 'team-required', isEnabled: true },
];
const mcp = { list: async () => ({ servers: [] }), add: async () => {}, remove: async () => {} };

async function render(props) {
  await ui.act(async () => root.render(ui.createElement(ui.PluginsPort0750Extras, props)));
  await ui.act(async () => { await Promise.resolve(); });
}

test('user plugins uninstall and the custom MCP form is mounted', async () => {
  const removed = [];
  await render({ plugins, mcp, onRemovePlugin: (id) => { removed.push(id); } });
  assert.match(host.textContent, /Custom MCP server/);
  const userRow = host.querySelector('[data-plugin-id="linear"]');
  const uninstall = [...userRow.querySelectorAll('button')].find((button) => button.textContent === 'Uninstall');
  assert.ok(uninstall);
  await ui.act(async () => uninstall.click());
  assert.deepEqual(removed, ['linear']);
  const teamRow = host.querySelector('[data-plugin-id="team-docs"]');
  assert.equal([...teamRow.querySelectorAll('button')].some((button) => button.textContent === 'Uninstall' || button.textContent === 'Remove'), false);
});

test.after(async () => {
  await ui.act(async () => root.unmount());
  host.remove();
  await closeLibraryDom(window);
});
