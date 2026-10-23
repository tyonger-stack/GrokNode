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
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {TeamsOnboardingHost} from './frontend/src/extensions/teams-integration-onboarding';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);
const UNAVAILABLE = 'Microsoft Teams account linking needs a cloud token exchange, which this local build does not perform.';

function buttonNamed(label) {
  return [...host.querySelectorAll('button')].find((button) => button.textContent === label);
}

test('continue fails closed and cancel returns to the unlinked guide', async () => {
  await ui.act(async () => root.render(ui.createElement(ui.TeamsOnboardingHost)));
  assert.match(host.textContent, /Link your Microsoft Teams account/);
  assert.equal(host.textContent.includes('Done'), false);
  await ui.act(async () => buttonNamed('Continue').click());
  assert.equal(host.querySelector('[role="alert"]').textContent, UNAVAILABLE);
  assert.equal(host.textContent.includes('Done'), false);
  await ui.act(async () => buttonNamed('Cancel').click());
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.match(host.textContent, /Link your Microsoft Teams account/);
});

test.after(async () => {
  await ui.act(async () => root.unmount());
  host.remove();
  await closeLibraryDom(window);
});
