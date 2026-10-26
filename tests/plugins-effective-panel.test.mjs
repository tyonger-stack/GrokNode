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
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {EffectivePluginsPanel} from './frontend/src/recovered/features/plugins/overlay/effective-plugins-panel';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);
async function render(props) { await ui.act(async () => root.render(ui.createElement(ui.EffectivePluginsPanel, props))); }
const plugins = [
  { pluginId: 'linear', name: 'linear', displayName: 'Linear', installMode: 'user', isEnabled: true },
  { pluginId: 'team-docs', name: 'team-docs', displayName: 'Team Docs', installMode: 'team-required', isEnabled: true },
  { pluginId: 'old', name: 'old', displayName: '', installMode: 'user', isEnabled: false },
];

test('panel lists effective plugins with team policy labels', async () => {
  await render({ plugins, onOpenPlugin: () => {}, onRemove: () => {} });
  assert.match(host.textContent, /Linear/);
  assert.match(host.textContent, /Managed by your team/);
  const rows = [...host.querySelectorAll('[data-plugin-id]')];
  assert.equal(rows.length, 3);
});

test('team-required plugins offer no remove action while user plugins do', async () => {
  const removed = [];
  await render({ plugins, onOpenPlugin: () => {}, onRemove: (id) => removed.push(id) });
  const teamRow = host.querySelector('[data-plugin-id="team-docs"]');
  assert.equal(teamRow.textContent.includes('Remove'), false);
  assert.equal(teamRow.textContent.includes('Uninstall'), false);
  const userRow = host.querySelector('[data-plugin-id="linear"]');
  const remove = [...userRow.querySelectorAll('button')].find((b) => b.textContent === 'Uninstall');
  assert.ok(remove, 'user plugin offers uninstall');
  await ui.act(async () => remove.click());
  assert.deepEqual(removed, ['linear']);
});

test('disabled plugins are badged and an empty list explains itself', async () => {
  await render({ plugins, onOpenPlugin: () => {} });
  const off = host.querySelector('[data-plugin-id="old"]');
  assert.match(off.textContent, /Disabled/);
  await render({ plugins: [], onOpenPlugin: () => {} });
  assert.match(host.textContent, /Nothing installed yet/);
});

test.after(async () => {
  await ui.act(async () => root.unmount());
  host.remove();
  await closeLibraryDom(window);
});
