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
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {TeamsIntegrationOnboarding} from './frontend/src/extensions/teams-integration-onboarding';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);
function setNativeValue(element, value) {
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}
async function render(props) { await ui.act(async () => root.render(ui.createElement(ui.TeamsIntegrationOnboarding, props))); }
const base = { onStartLink: () => {}, onClose: () => {} };

test('unlinked guide shows the account title and starts the link', async () => {
  let started = 'unset';
  await render({ ...base, status: 'unlinked', onStartLink: (t) => { started = t; } });
  assert.match(host.textContent, /Microsoft Teams account/);
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Continue').click());
  assert.equal(started, null);
});

test('guest flow collects the tenant id before linking', async () => {
  let started = 'unset';
  await render({ ...base, status: 'unlinked', tenantRequired: true, onStartLink: (t) => { started = t; } });
  assert.match(host.textContent, /Organization tenant ID/);
  const input = host.querySelector('input');
  await ui.act(async () => setNativeValue(input, 'tenant-123'));
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Continue').click());
  assert.equal(started, 'tenant-123');
});

test('pending, failed, and linked states render their actions', async () => {
  await render({ ...base, status: 'pending' });
  assert.match(host.textContent, /Loading/);
  let retried = 0;
  await render({ ...base, status: 'failed', onRetry: () => { retried++; } });
  assert.match(host.textContent, /Try again/);
  let unlinked = 0;
  let closed = 0;
  await render({ ...base, status: 'linked', onUnlink: () => { unlinked++; }, onClose: () => { closed++; } });
  assert.match(host.textContent, /Done/);
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Unlink Microsoft Teams').click());
  assert.equal(unlinked, 1);
  await ui.act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Done').click());
  assert.equal(closed, 1);
});

test.after(async () => {
  await ui.act(async () => root.unmount());
  host.remove();
  await closeLibraryDom(window);
});
