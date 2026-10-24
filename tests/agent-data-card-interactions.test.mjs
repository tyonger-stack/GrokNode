import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { Window } from 'happy-dom';
import { COMPONENT_SOURCE, NONE_SENTINEL } from '../scripts/lib/agent-data-cards-renderer-patch.mjs';

const data = id => ({ soul: `人格 ${id}\n第二行职责`, userProfile: null, soulTruncated: false, userProfileTruncated: false, botProfile: { name: `Bot ${id}`, description: `职责 ${id}`, avatarColor: 'violet', avatarShape: 'blob' }, memoryLogMonths: ['2026-10'], audit: { entries: [{ ts: null, type: 'shell_command', summary: 'echo first' }, { ts: null, type: 'browser_navigation', summary: 'https://example.test' }], truncated: false }, workflows: ['weekly-report'], ownWorkflows: ['own-skill'] });
async function fixture(api, run) {
  const window = new Window(), saved = new Map();
  for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    saved.set(name, globalThis[name]);
    globalThis[name] = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
  }
  window.desktop = { agent: api };
  const Card = vm.runInNewContext(COMPONENT_SOURCE + ';RAgentDataCards', {
    S: React, p: { jsx, jsxs }, window, RLocT: (_en, zh) => zh,
    re: (...values) => values.filter(Boolean).join(' '),
    vt: ({ children }) => jsx('span', { children }),
    so: ({ options, value, onValueChange, disabled, ...props }) => jsx('select', { 'aria-label': props['aria-label'], value, disabled, onChange: e => onValueChange(e.target.value), children: options.map(row => jsx('option', { value: row.value, children: row.label }, row.value)) }),
  });
  const { createRoot } = await import('react-dom/client');
  const mount = window.document.createElement('div'); window.document.body.append(mount);
  const root = createRoot(mount);
  const render = async id => React.act(async () => root.render(jsx(Card, { agent: { id, isGroup: false } })));
  try { await render('one'); await run({ window, mount, render }); }
  finally { await React.act(async () => root.unmount()); window.close(); for (const [name, value] of saved) if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
}
test('five cards open the right content, choose journals and skills, and preserve audit line breaks', async () => {
  const calls = [];
  await fixture({
    getAgentDataOverview: async id => ({ ok: true, data: data(id) }),
    getAgentMemoryLog: async (id, month) => { calls.push([id, month]); return { ok: true, data: { content: '当月记忆正文' } }; },
    getAgentWorkflowContent: async slug => { calls.push([slug]); return { ok: true, data: { content: '# 周报技能' } }; },
  }, async ({ mount, window }) => {
    assert.deepEqual([...mount.querySelectorAll('.sand-agent-settings__card')].map(card => card.querySelector('.sand-agent-settings__text').textContent), ['人格 (Soul)memory/profile.md', '记忆memory/log/YYYY-MM.md', 'Bot 画像agents profile.json + 记忆/技能/审计', '行为审计audit.jsonl（最近）', '技能skills 自身 · workflows 共享']);
    for (const [key, content] of [['soul', '人格 one']]) {
      await React.act(async () => mount.querySelector(`[data-r-agent-${key}] button`).click());
      assert(mount.querySelector(`[data-r-agent-${key}]`).textContent.includes(content));
    }
    await React.act(async () => mount.querySelector('[data-r-agent-bot] button').click());
    const botText = mount.querySelector('[data-r-agent-bot] [data-r-agent-data-pre]').textContent;
    assert(botText.includes('名称：Bot one') && botText.includes('职责：职责 one') && botText.includes('violet / blob'));
    assert(botText.includes('1 个月记忆（最近 2026-10）') && botText.includes('1 个技能') && botText.includes('2 条审计'));
    assert(botText.includes('自我定位：人格 one 第二行职责'));
    assert(!botText.includes('user-memory'));
    await React.act(async () => mount.querySelector('[data-r-agent-audit] button').click());
    const audit = mount.querySelector('[data-r-agent-audit] [data-r-agent-data-pre]').textContent;
    assert(audit.includes('\n'));
    assert(!audit.includes('\\n'));
    const month = mount.querySelector('select[aria-label="记忆月份"]');
    assert.equal(month.value, NONE_SENTINEL);
    await React.act(async () => { month.value = '2026-10'; month.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert(mount.querySelector('[data-r-agent-memory]').textContent.includes('当月记忆正文'));
    const skill = mount.querySelector('select[aria-label="技能"]');
    await React.act(async () => { skill.value = 'weekly-report'; skill.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert(mount.querySelector('[data-r-agent-workflow]').textContent.includes('# 周报技能'));
    assert.deepEqual(calls, [['one', '2026-10'], ['weekly-report']]);
    await React.act(async () => { month.value = NONE_SENTINEL; month.dispatchEvent(new window.Event('change', { bubbles: true })); skill.value = NONE_SENTINEL; skill.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert(!mount.querySelector('[data-r-agent-memory]').textContent.includes('当月记忆正文'));
    assert(!mount.querySelector('[data-r-agent-workflow]').textContent.includes('# 周报技能'));
    assert.deepEqual(calls, [['one', '2026-10'], ['weekly-report']]);
  });
});
test('a late memory response from the previous Bot cannot appear under the next Bot', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  await fixture({ getAgentDataOverview: async id => ({ ok: true, data: data(id) }), getAgentMemoryLog: () => pending }, async ({ mount, window, render }) => {
    const month = mount.querySelector('select[aria-label="记忆月份"]');
    await React.act(async () => { month.value = '2026-10'; month.dispatchEvent(new window.Event('change', { bubbles: true })); });
    await render('two');
    await React.act(async () => finish({ ok: true, data: { content: 'previous Bot private memory' } }));
    assert(!mount.textContent.includes('previous Bot private memory'));
  });
});
