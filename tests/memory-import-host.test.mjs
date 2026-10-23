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
const built = await build({ stdin: { contents: `export {act} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {MemoryImportHost} from './frontend/src/recovered/features/settings/overlay/memory-import-host';`, resolveDir: repo, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }, logLevel: 'silent' });
const ui = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const host = document.createElement('div'); document.body.append(host);
const root = ui.createRoot(host);

function setNativeValue(element, value) {
  const proto = window.HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}
function buttonNamed(label) {
  return [...host.querySelectorAll('button')].find((button) => button.textContent === label);
}
async function flush() {
  await ui.act(async () => {});
  await ui.act(async () => {});
}
async function render(props) {
  await ui.act(async () => root.render(ui.createElement(ui.MemoryImportHost, props)));
  await flush();
}

test('gated import sends the paste to the host and clears the box', async () => {
  const calls = [];
  const coordinator = {
    call: async (method, args) => {
      calls.push({ method, args });
      if (method === 'getAgentMemories') return [{ content: 'Known.' }];
      if (method === 'importAgentMemories') return { added: [{ content: 'Fresh fact.' }], duplicates: ['Known.'], skipped: [] };
      throw new Error(method);
    },
  };
  const bridge = {
    agent: { getMainAgent: async () => 'agent-main-1' },
    experiments: {
      initialSnapshot: { featureGates: { grok_bot_memory_import: true } },
      getSnapshot: async () => ({ featureGates: { grok_bot_memory_import: true } }),
    },
  };
  await render({ bridge, coordinator });
  const area = host.querySelector('textarea');
  assert.ok(area, 'the import section is mounted');
  await ui.act(async () => setNativeValue(area, 'Fresh fact.\nKnown.\n'));
  await ui.act(async () => buttonNamed('Add to Memory').click());
  assert.equal(calls.filter((call) => call.method === 'importAgentMemories').length, 0);
  await ui.act(async () => buttonNamed('Add to Memory').click());
  await flush();
  const imported = calls.filter((call) => call.method === 'importAgentMemories');
  assert.equal(imported.length, 1);
  assert.deepEqual(imported[0].args, { id: 'agent-main-1', kind: 'paste', text: 'Fresh fact.\nKnown.\n' });
  assert.equal(host.querySelector('textarea').value, '');
});

test('a rejected import keeps the paste and shows the error', async () => {
  const coordinator = {
    call: async (method) => {
      if (method === 'getAgentMemories') return [];
      throw new Error('disk full');
    },
  };
  const bridge = {
    agent: { getMainAgent: async () => 'agent-main-1' },
    experiments: {
      initialSnapshot: { featureGates: { grok_bot_memory_import: true } },
      getSnapshot: async () => ({ featureGates: { grok_bot_memory_import: true } }),
    },
  };
  await render({ bridge, coordinator });
  const area = host.querySelector('textarea');
  await ui.act(async () => setNativeValue(area, 'Fresh fact.\n'));
  await ui.act(async () => buttonNamed('Add to Memory').click());
  await ui.act(async () => buttonNamed('Add to Memory').click());
  await flush();
  assert.equal(host.querySelector('textarea').value, 'Fresh fact.\n');
  assert.equal(host.querySelector('[role="alert"]').textContent, 'disk full');
});

test('the section stays hidden when the memory import gate is off', async () => {
  const bridge = {
    agent: { getMainAgent: async () => 'agent-main-1' },
    experiments: {
      initialSnapshot: { featureGates: {} },
      getSnapshot: async () => ({ featureGates: {} }),
    },
  };
  await render({ bridge, coordinator: { call: async () => { throw new Error('must not call'); } } });
  assert.equal(host.querySelector('.sand-memory-import'), null);
});

test.after(async () => {
  await ui.act(async () => root.unmount());
  host.remove();
  await closeLibraryDom(window);
});
