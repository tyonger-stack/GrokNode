import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import vm from 'node:vm';
import { parseAppCardLink, openAppCardLink, patchAppLinkCards, patchAppComputerSettings } from '../scripts/lib/app-link-card-renderer-patch.mjs';

const rendererManifest = JSON.parse(await readFile(new URL('./fixtures/app-link-card-renderer/manifest.json', import.meta.url), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
async function rendererFixture(file) {
  const source = await readFile(new URL(`./fixtures/app-link-card-renderer/${file}`, import.meta.url), 'utf8');
  assert.equal(sha256(source), rendererManifest.sources[file].fixtureSha256);
  return source;
}
async function pinnedRenderer(file) {
  try {
    return await readFile(new URL(`../src/app/dist/renderer/assets/${file}`, import.meta.url), 'utf8');
  } catch (error) {
    if (!(error instanceof Error) || error.code !== 'ENOENT') throw error;
    return rendererFixture(file);
  }
}

test('recorded renderer nodes retain provenance and both patches execute without hydrated app files', async () => {
  for (const [file, record] of Object.entries(rendererManifest.sources)) {
    const fixture = await rendererFixture(file);
    const source = await pinnedRenderer(file);
    if (source !== fixture) {
      assert.equal(sha256(source), record.sourceSha256);
      const nodes = record.nodes.map(({ start, end, sha256: expected }) => {
        const node = source.slice(start, end);
        assert.equal(sha256(node), expected);
        return node;
      });
      assert.equal(fixture, nodes.join('\n') + '\n');
    }
    const patched = file === 'index-UbX-y3il.js' ? patchAppLinkCards(fixture) : patchAppComputerSettings(fixture);
    parse(patched, { ecmaVersion: 'latest', sourceType: 'module' });
  }
});

test('computer, settings and the other canonical card families parse', () => {
  for (const scheme of ['sand', 'grokbot', 'groknode']) {
    assert.equal(parseAppCardLink(`${scheme}://app/v1/sidebar?tab=computer`).tab, 'computer');
    assert.equal(parseAppCardLink(`${scheme}://app/v1/settings?id=computers`).id, 'computers');
  }
  for (const [path, query, route] of [['agent', 'id=bot_1', 'agent'], ['sidebar', 'automation=daily&agent=bot_1&tab=routines', 'sidebar'],
    ['plugin/add', 'id=123', 'plugin-add'], ['bot-template', 'id=abcdefghijklmnopqrstu', 'bot-template'],
    ['thread', 'id=0123456789', 'thread'], ['task', 'agent=bot_1&id=0123456789', 'task']]) {
    assert.equal(parseAppCardLink(`sand://app/v1/${path}?${query}`).route, route);
  }
});

test('invalid, ambiguous and external URLs never become application actions', () => {
  for (const url of ['https://example.com/v1/sidebar?tab=computer', 'sand://other/v1/settings?id=computers',
    'sand://user@app/v1/settings?id=computers', 'sand://app:12/v1/settings?id=computers',
    'sand://app/v1/settings?id=computers#x', 'sand://app/v1/settings?id=computers&id=theme',
    'sand://app/v1/settings?id=unknown', 'sand://app/v1/sidebar?tab=unknown',
    'sand://app/v1/sidebar?agent=', 'sand://app/v1/sidebar?tab=%63omputer',
    'sand://app/v1/sidebar?tab=computer&extra=1', 'sand://app/v1/../v1/sidebar?tab=computer',
    'sand://app/v1/task?id=not-a-task', 'sand://app/v1/agent', 'javascript:alert(1)']) {
    assert.equal(parseAppCardLink(url), null, url);
  }
});

test('destinations preserve owner and explicit Bot/routine identity', () => {
  const calls = [];
  const navigation = Object.fromEntries(['settings', 'pane', 'agent', 'plugin', 'template', 'thread'].map(kind => [kind, (...args) => calls.push([kind, ...args])]));
  for (const url of ['sand://app/v1/sidebar?tab=computer', 'sand://app/v1/settings?id=computers',
    'sand://app/v1/sidebar?automation=daily&agent=bot_2&tab=routines', 'sand://app/v1/agent?id=bot_2',
    'sand://app/v1/plugin/add?id=42', 'sand://app/v1/bot-template?id=abcdefghijklmnopqrstu']) {
    openAppCardLink(parseAppCardLink(url), 'bot_1', navigation);
  }
  assert.deepEqual(calls, [['pane', { agentId: 'bot_1', tab: 'computer', automationId: undefined, target: undefined }],
    ['settings', 'computer', 'computers'], ['pane', { agentId: 'bot_2', tab: 'routines', automationId: 'daily', target: undefined }],
    ['agent', 'bot_2'], ['plugin', '42'], ['template', 'abcdefghijklmnopqrstu']]);
});

test('the pinned renderer accepts the patch and a drifted anchor fails closed', async () => {
  const source = await pinnedRenderer('index-UbX-y3il.js');
  const patched = patchAppLinkCards(source);
  const ast = parse(patched, { ecmaVersion: 'latest', sourceType: 'module' });
  const transform = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'p1t');
  const context = vm.createContext({ parseAppCardLink, $5e: () => false, IAe: () => null, AAe: () => null,
    CAe: () => null, b2e: () => null, F5e: () => null });
  const urlTransform = vm.runInContext(patched.slice(transform.start, transform.end) + ';p1t', context);
  assert.equal(urlTransform('sand://app/v1/sidebar?tab=computer'), 'sand://app/v1/sidebar?tab=computer');
  assert.equal(urlTransform('javascript:alert(1)'), '');
  assert.throws(() => patchAppLinkCards(patched), /anchor/);
  assert.throws(() => patchAppLinkCards(source.replace('function IDn(n){', 'function changed(n){')), /anchor/);
});

test('Computer settings is a real native section with live permission and maintenance controls', async () => {
  const source = await pinnedRenderer('index-BlqerJhg.js');
  const patched = patchAppComputerSettings(source);
  const ast = parse(patched, { ecmaVersion: 'latest', sourceType: 'module' });
  const shell = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'Ta');
  const body = patched.slice(shell.start, shell.end);
  assert.ok(body.includes('x==="beta"||x==="computer"'));
  assert.ok(body.includes('children:a.jsx(da,{})'));
  assert.ok(body.includes('a.jsx(qs,{canResetBox:h,canUpdateBaseline:c,canUpdateBox:f'));
  assert.throws(() => patchAppComputerSettings(patched), /anchor/);
  const calls = [];
  openAppCardLink(parseAppCardLink('sand://app/v1/settings?id=update-status'), 'bot_1', { settings: section => calls.push(section) });
  assert.deepEqual(calls, ['beta']);
});

test('rendered chips and preview footer use the same native destination; keyboard activation works', async () => {
  const source = await pinnedRenderer('index-UbX-y3il.js');
  const patched = patchAppLinkCards(source), ast = parse(patched, { ecmaVersion: 'latest', sourceType: 'module' });
  const component = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'RAppLinkCard');
  const catalog = JSON.parse(await readFile(new URL('../scripts/lib/app-link-cards-official.json', import.meta.url), 'utf8'));
  const calls = [], jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ parseAppCardLink, openAppCardLink, RAppLinkCatalog: catalog,
    RLocT: (_en, zh) => zh, Qe: () => ({ selection: { select: id => calls.push(['agent', id]) } }),
    Mee: () => 'bot_1', Ra: () => [{ id: 'bot_1', name: 'Bot' }], r1: () => ({ resolveEntry: () => null }),
    vDn: () => [{ id: 'general' }, { id: 'computer' }, { id: 'beta' }],
    p: { jsx, jsxs: jsx }, bt: 'icon', _de: 'hover-card', GD: { open: link => calls.push(link) },
    Uf: { settings: params => ({ kind: 'settings', ...params }) },
    document: {}, revealAppSetting: () => () => {}, RAppSettingReveal: null,
    window: { dispatchEvent: event => calls.push([event.type, event.detail]) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  const render = vm.runInContext(patched.slice(component.start, component.end) + ';RAppLinkCard', context);
  const event = { preventDefault() {}, stopPropagation() {} };
  const settings = render({ href: 'sand://app/v1/settings?id=computers', label: '你的电脑' });
  settings.props.children.props.onClick(event);
  assert.equal(calls[0].section, 'computer');
  const card = settings.props.content(() => calls.push('closed'));
  card.props.children[1].props.children.props.onClick(event);
  assert.equal(calls[1], 'closed'); assert.equal(calls[2].section, 'computer');
  let activated = false, prevented = false;
  settings.props.children.props.onKeyDown({ key: ' ', preventDefault() { prevented = true; }, currentTarget: { click() { activated = true; } } });
  assert.ok(prevented && activated);
  const computer = render({ href: 'sand://app/v1/sidebar?tab=computer', label: '电脑' });
  computer.props.children.props.onClick(event);
  assert.equal(calls[3][0], 'grok-node-open-app-pane');
  assert.equal(calls[3][1].agentId, 'bot_1'); assert.equal(calls[3][1].tab, 'computer');
  assert.equal(render({ href: 'sand://app/v1/agent?id=missing', label: '缺失 Bot' }), '缺失 Bot');
  assert.equal(render({ href: 'sand://app/v1/task?id=0123456789', label: '缺失任务' }), '缺失任务');
  assert.equal(render({ href: 'sand://app/v1/settings?id=billing', label: '云账单' }), '云账单');
});
