import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { closeLibraryDom } from './library-dom-teardown.mjs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const window = new Window({ settings: { disableCSSFileLoading: true } });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'File', 'Event']) globalThis[name] = name === 'window' ? window : window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {VaultCardDialogHost} from './frontend/src/extensions/vault-card-dialog-host';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);

function setNativeValue(element, value) {
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}
function buttonNamed(label) {
  return [...host.querySelectorAll('button')].find((button) => button.textContent === label);
}
async function render(props) {
  await ui.act(async () => root.render(ui.createElement(ui.VaultCardDialogHost, props)));
}

test('saving a new card calls the vault preload with card values', async () => {
  const created = [];
  const desktop = {
    createGrokBotVaultCard: async (input) => { created.push(input); },
    readGrokBotCardPhoto: async () => ({ outcome: 'unavailable' }),
    cancelGrokBotCardPhotoRead: async () => {},
  };
  await render({ desktop, enabled: true });
  await ui.act(async () => buttonNamed('New card').click());
  await ui.act(async () => {
    setNativeValue(host.querySelector('[aria-label="Card number"]'), '4242424242424242');
    setNativeValue(host.querySelector('[aria-label="Expiry (MM/YY)"]'), '1228');
    setNativeValue(host.querySelector('[aria-label="Security code"]'), '123');
    setNativeValue(host.querySelector('[aria-label="Name on card"]'), 'Ada Lovelace');
  });
  await ui.act(async () => buttonNamed('Save card').click());
  await ui.act(async () => { await Promise.resolve(); });
  assert.equal(created.length, 1);
  assert.equal(created[0].values.cc_number, '4242424242424242');
  assert.equal(created[0].values.cc_exp, '12/28');
  assert.equal(created[0].values.cc_csc, '123');
  assert.equal(created[0].values.cc_name, 'Ada Lovelace');
});

test('a photo read fills the card fields', async () => {
  const desktop = {
    createGrokBotVaultCard: async () => {},
    readGrokBotCardPhoto: async () => ({ outcome: 'read', number: '4242424242424242', expMonth: 12, expYear: 2028, cardholderName: 'Ada Lovelace', securityCode: '123' }),
    cancelGrokBotCardPhotoRead: async () => {},
  };
  await render({ desktop, enabled: true });
  await ui.act(async () => buttonNamed('New card').click());
  const input = host.querySelector('input[type="file"]');
  const image = new window.File(['card'], 'card.png', { type: 'image/png' });
  await ui.act(async () => {
    input.files = [image];
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(host.querySelector('[aria-label="Card number"]').value, '4242 4242 4242 4242');
  assert.equal(host.querySelector('[aria-label="Expiry (MM/YY)"]').value, '12/28');
  assert.equal(host.querySelector('[aria-label="Name on card"]').value, 'Ada Lovelace');
});

test('the entry stays hidden when vault cards are disabled', async () => {
  await render({ desktop: null, enabled: false });
  assert.equal(buttonNamed('New card'), undefined);
});

test.after(async () => {
  await ui.act(async () => root.unmount());
  host.remove();
  await closeLibraryDom(window);
});
