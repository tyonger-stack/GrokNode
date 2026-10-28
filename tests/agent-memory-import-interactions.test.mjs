import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { Window } from 'happy-dom';
import { COMPONENT_SOURCE, EXPORT_PROMPT, INSTRUCTIONS, VISIBLE_TEXT_ZH } from '../scripts/lib/memory-import-0770-renderer-patch.mjs';

// The component source is the OFFICIAL 0.77.0 dialog ported verbatim (per-segment
// sha256 in OFFICIAL_MANIFEST); these mocks supply only the 0.18 registry-chunk
// bindings the wiring layer names: react (de), jsx runtime (a), react-compiler
// runtime (H.c), icon glyph renderer (je), base dialog primitive (O77BaseDlg =
// registry-chunk export `ci`), Text (se)
// and the General-panel section/card kit (re/ie) — the shapes the patched panel
// chunk provides at runtime.
async function fixture(api, run) {
  const window = new Window(), saved = new Map(), copied = [];
  for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    saved.set(name, globalThis[name]); globalThis[name] = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
  }
  window.desktop = { agent: api };
  const Section = vm.runInNewContext(COMPONENT_SOURCE + ';RImportSection', {
    de: React, a: { jsx, jsxs, Fragment: React.Fragment },
    H: { c: n => new Array(n).fill(Symbol.for('react.memo_cache_sentinel')) }, // real compiler runtime pre-fills slots with the sentinel
    je: ({ name }) => jsx('i', { 'data-icon': name }),
    O77BaseDlg: props => jsxs('div', { 'data-dialog': 'root', children: props.children }),
    se: ({ as = 'span', color, children, ...props }) => jsx(as, { ...props, 'data-color': color, children }),
    window, navigator: { clipboard: { writeText: async text => { copied.push(text); } } }, setTimeout: () => 0,
    RLocT: (_en, zh) => zh,
    re: ({ title, children }) => jsxs('section', { children: [jsx('h2', { children: title }), children] }),
    ie: ({ label, description, children }) => jsxs('div', { children: [jsx('strong', { children: label }), jsx('p', { children: description }), children] }),
  });
  const { createRoot } = await import('react-dom/client');
  const mount = window.document.createElement('div'); window.document.body.append(mount);
  const root = createRoot(mount);
  const button = text => [...mount.querySelectorAll('button')].find(button => button.textContent === text);
  const setText = async (index, text) => React.act(async () => {
    const input = mount.querySelectorAll('textarea')[index]; input.focus();
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  const openDialog = async () => React.act(async () => button('开始导入').click());
  try { await React.act(async () => root.render(jsx(Section, {}))); await run({ window, mount, root, button, copied, setText, openDialog }); }
  finally { await React.act(async () => root.unmount()); window.close(); for (const [name, value] of saved) if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
}

test('通用面板出现官方导入卡：标题/描述/开始导入（附图 1 结构）', async () => {
  await fixture({ getMainAgent: async () => null }, async ({ mount, button }) => {
    assert(mount.querySelector('h2').textContent.includes('导入'), 'section heading is 导入');
    assert(mount.textContent.includes('将记忆导入 Grok Bot'), 'card label');
    assert(mount.textContent.includes('从另一个 AI 助手迁移你的偏好和背景信息'), 'card description');
    assert.equal(button('开始导入').disabled, false, 'opening the dialog never requires a bot');
    assert.equal(mount.querySelector('[data-dialog=root]'), null, 'dialog closed until started');
  });
});

test('第一步展示官方导出提示词且逐字复制；第二步占位为官方文案', async () => {
  await fixture({ getMainAgent: async () => 'main' }, async ({ mount, button, copied, openDialog }) => {
    await openDialog();
    const [prompt, paste] = mount.querySelectorAll('textarea');
    assert.equal(prompt.readOnly, true, 'export prompt is a readonly preview');
    assert.equal(prompt.value, EXPORT_PROMPT, 'prompt preview is the verbatim official nhe (newline-joined)');
    assert.equal(paste.getAttribute('placeholder'), '在此粘贴你的记忆详情');
    assert(mount.textContent.includes('将记忆导入 Grok Bot'), 'dialog title (official titlebar)');
    await React.act(async () => button('复制').click());
    assert.deepEqual(copied, [EXPORT_PROMPT]);
    const glyph = button('已复制').querySelector('[data-icon]');
    assert.equal(glyph && glyph.getAttribute('data-icon'), 'check', 'copy button flips to the check glyph');
  });
});

test('提交：主 Bot 收到一条组合好的 turn（可见行 richText + 围栏导出 + 编号指令），成功关窗', async () => {
  const calls = [];
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  await fixture({ getMainAgent: async () => 'main', getAgentDataOverview: async () => ({ ok: true, data: { botProfile: { name: 'Grok Node' } } }), importAgentMemory: async (...args) => { calls.push(args); return pending; } }, async ({ mount, button, setText, openDialog }) => {
    await openDialog();
    assert.equal(button('添加到记忆').disabled, true, 'empty paste keeps submit disabled');
    await setText(1, '  ## Instructions\n- Keep replies short.  ');
    assert.equal(button('添加到记忆').disabled, false);
    await React.act(async () => { button('添加到记忆').click(); });
    assert.equal(calls.length, 1, 'one send for one click');
    const [agentId, prompt, richText] = calls[0];
    assert.equal(agentId, 'main');
    assert.ok(prompt.startsWith(`${VISIBLE_TEXT_ZH}\n\n<imported_memory>\n## Instructions`), 'visible line + trimmed fenced export');
    assert.ok(prompt.includes('</imported_memory>\n\n<memory_import_instructions>\n1. The block above'), 'numbered instructions follow the fence');
    assert.ok(prompt.endsWith('</memory_import_instructions>'));
    assert.deepEqual(JSON.parse(richText), { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: VISIBLE_TEXT_ZH }] }] });
    assert.ok(prompt.includes(INSTRUCTIONS[3]), 'secrets rule rides along');
    assert.equal(button('取消').disabled, true, 'cancel is latched while sending');
    await React.act(async () => finish({ ok: true }));
    assert.equal(mount.querySelector('[data-dialog=root]'), null, 'success closes the dialog');
  });
});

test('失败：红色官方报错带 Bot 名，草稿保留、可重试', async () => {
  await fixture({ getMainAgent: async () => 'main', getAgentDataOverview: async () => ({ ok: true, data: { botProfile: { name: 'Grok Node' } } }), importAgentMemory: async () => ({ ok: false, reason: 'gateway 503' }) }, async ({ mount, button, setText, openDialog }) => {
    await openDialog();
    await setText(1, '持久事实');
    await React.act(async () => button('添加到记忆').click());
    const alert = mount.querySelector('[role=alert]');
    assert.equal(alert.getAttribute('data-color'), 'red');
    assert.equal(alert.textContent, '无法发送给 Grok Node。请重试。', 'official k1G10P copy with the bot name');
    assert.equal(mount.querySelectorAll('textarea')[1].value, '持久事实', 'draft survives');
    assert.equal(button('添加到记忆').disabled, false, 'retry enabled');
    await React.act(async () => button('添加到记忆').click());
    assert.equal(alert.textContent, '无法发送给 Grok Node。请重试。');
  });
});

test('无主 Bot：官方提示 + 禁止提交；超长：官方提示 + 禁止提交', async () => {
  await fixture({ getMainAgent: async () => null, importAgentMemory: async () => { throw new Error('must not be called'); } }, async ({ mount, button, setText, openDialog }) => {
    await openDialog();
    await setText(1, '持久事实');
    const hint = mount.querySelector('p[data-color=tertiary]');
    assert(hint, 'official no-bot hint renders as tertiary text');
    assert.equal(hint.textContent, '创建一个 Bot 来导入记忆', 'official 9A+Hw8 hint');
    assert.equal(button('添加到记忆').disabled, true);
    await setText(1, 'x'.repeat(100_001));
    assert.equal(mount.querySelector('[role=alert]').textContent, '内容太长。请粘贴更短的导出内容。', 'official syvjPm copy');
    assert.equal(button('添加到记忆').disabled, true);
  });
});

test('失败态重新输入即复位；取消按钮随时关窗', async () => {
  await fixture({ getMainAgent: async () => 'main', getAgentDataOverview: async () => ({ ok: false, reason: 'x' }), importAgentMemory: async () => ({ ok: false }) }, async ({ mount, button, setText, openDialog }) => {
    await openDialog();
    await setText(1, '持久事实');
    await React.act(async () => button('添加到记忆').click());
    assert.notEqual(mount.querySelector('[role=alert]'), null);
    await setText(1, '持久事实二');
    assert.equal(mount.querySelector('[role=alert]'), null, 'typing resets the failure');
    await React.act(async () => button('取消').click());
    assert.equal(mount.querySelector('[data-dialog=root]'), null, 'cancel closes');
    assert.notEqual(button('开始导入'), undefined, 'back to the section card');
  });
});
