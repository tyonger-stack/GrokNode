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
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {OnePasswordPreviousVaultNote, renderPreviousVaultNotice, DEFAULT_ONEPASSWORD_NOTE_COPY} from './frontend/src/recovered/features/vault/onepassword-previous-vault-note';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);
async function render(props) { await ui.act(async () => root.render(ui.createElement(ui.OnePasswordPreviousVaultNote, props))); }

test('singular and plural notices name the vault and offer move or dismiss', async () => {
  let moved = 0;
  let dismissed = 0;
  await render({ count: 1, vaultName: 'Private', onMove: () => moved++, onDismiss: () => dismissed++ });
  assert.match(host.textContent, /1 login in your .*Private.* vault isn't available/);
  assert.match(host.textContent, /Move to Private/);
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Move to Private').click());
  assert.equal(moved, 1);
  await render({ count: 3, vaultName: 'Shared', onMove: () => {}, onDismiss: () => dismissed++ });
  assert.match(host.textContent, /3 logins in your .*Shared.* vault aren't available/);
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Dismiss').click());
  assert.equal(dismissed, 1);
});

test('notice renderer picks the upstream singular and plural templates', async () => {
  const one = ui.renderPreviousVaultNotice(ui.DEFAULT_ONEPASSWORD_NOTE_COPY, 1, 'Private');
  const many = ui.renderPreviousVaultNotice(ui.DEFAULT_ONEPASSWORD_NOTE_COPY, 2, 'Private');
  assert.match(one, /isn't available/);
  assert.match(many, /aren't available/);
});
