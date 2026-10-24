import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { Window } from 'happy-dom';
import { COMPONENT_SOURCE, MEMORY_TEMPLATE } from '../scripts/lib/agent-memory-import-renderer-patch.mjs';

async function fixture(api, run) {
  const window = new Window(), saved = new Map(), copied = [];
  for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    saved.set(name, globalThis[name]); globalThis[name] = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
  }
  window.desktop = { agent: api };
  const Panel = vm.runInNewContext(COMPONENT_SOURCE + ';RMemoryPanel', {
    de: React, a: { jsx, jsxs }, window, navigator: { clipboard: { writeText: async text => { copied.push(text); } } }, setTimeout: () => 0,
    RLocT: (_en, zh) => zh, k: (...names) => names.join(' '),
    Te: ({ children }) => jsx('div', { children }),
    re: ({ title, children }) => jsxs('section', { children: [jsx('h2', { children: title }), children] }),
    ie: ({ label, description, children }) => jsxs('div', { children: [jsx('strong', { children: label }), jsx('p', { children: description }), children] }),
    oe: ({ children, disabled, onClick }) => jsx('button', { disabled, onClick, children }),
    se: ({ as = 'span', color, children, ...props }) => jsx(as, { ...props, 'data-color': color, children }),
  });
  const { createRoot } = await import('react-dom/client');
  const mount = window.document.createElement('div'); window.document.body.append(mount);
  const root = createRoot(mount);
  const setText = async text => React.act(async () => {
    const input = mount.querySelector('textarea'); input.focus();
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  const button = text => [...mount.querySelectorAll('button')].find(button => button.textContent === text);
  try { await React.act(async () => root.render(jsx(Panel, {}))); await run({ window, mount, setText, button, copied }); }
  finally { await React.act(async () => root.unmount()); window.close(); for (const [name, value] of saved) if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
}
test('template copies exactly; a fresh main Bot receives one trimmed snapshot despite a double click', async () => {
  let main = 'main-one', finish;
  const calls = [], pending = new Promise(resolve => { finish = resolve; });
  await fixture({ getMainAgent: async () => main, importAgentMemory: async (...args) => { calls.push(args); return pending; } }, async ({ mount, setText, button, copied }) => {
    assert.equal(button('添加记忆').disabled, true);
    await React.act(async () => button('复制').click());
    assert.deepEqual(copied, [MEMORY_TEMPLATE]);
    await setText('  ## 沟通偏好\n- 用户喜欢简短回复。  ');
    assert.equal(button('添加记忆').disabled, false);
    main = 'main-two';
    await React.act(async () => { const add = button('添加记忆'); add.click(); add.click(); });
    assert.deepEqual(calls, [['main-two', '## 沟通偏好\n- 用户喜欢简短回复。']]);
    assert.equal(button('发送中…').disabled, true);
    assert.equal(mount.querySelector('textarea').disabled, true);
    await React.act(async () => finish({ ok: true }));
    assert.equal(mount.querySelector('textarea').value, '');
    assert(mount.querySelector('[role=status]').textContent.includes('等待提炼'));
    assert.equal(mount.querySelector('[role=status]').getAttribute('data-color'), 'secondary');
  });
});
test('failed or missing acknowledgements preserve the pasted draft and offer a retry', async () => {
  for (const outcome of [{ ok: false, reason: 'Bot offline' }, undefined]) await fixture({ getMainAgent: async () => 'main', importAgentMemory: async () => outcome }, async ({ mount, setText, button }) => {
    await setText('持久事实快照');
    await React.act(async () => button('添加记忆').click());
    assert.equal(mount.querySelector('textarea').value, '持久事实快照');
    assert(mount.querySelector('[role=status]').textContent.includes('发送失败'));
    assert.equal(mount.querySelector('[role=status]').getAttribute('data-color'), 'red');
    assert.equal(button('添加记忆').disabled, false);
  });
});
test('no main Bot blocks submission while leaving template copy and the draft available', async () => {
  let sent = 0;
  await fixture({ getMainAgent: async () => null, importAgentMemory: async () => { sent++; } }, async ({ mount, setText, button }) => {
    await setText('持久事实快照');
    assert.equal(button('添加记忆').disabled, true);
    assert(mount.textContent.includes('尚未设置主 Bot'));
    assert.equal(button('复制').disabled, false);
    assert.equal(sent, 0);
  });
});
