import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { patchComputerPreviewStream } from '../scripts/lib/computer-preview-stream-renderer-patch.mjs';
import { resolve } from 'node:path';
import { parse } from 'acorn';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as compiler from 'react/compiler-runtime';
import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import { applyPair } from '../scripts/lib/i18n-patch-engine.mjs';
import { MAIN_I18N_PAIRS, MAIN_I18N_061_PAIRS } from '../scripts/lib/main-i18n-patch.mjs';
import { RConversationComputerCardActions, patchConversationComputerCard, applyOriginalRendererConversationComputerCard, RConversationOfficialCardFactory, CONVERSATION_COMPUTER_CARD_CSS } from '../scripts/lib/conversation-computer-card-renderer-patch.mjs';

const baseline = resolve(process.env.COMPUTER_CARD_BASELINE ?? 'src/app/dist/renderer/assets/index-UbX-y3il.js');
const hydrated = existsSync(baseline);
const skipBundle = hydrated ? false : 'pinned renderer not hydrated; bundle assertions skipped';
const original = hydrated ? readFileSync(baseline, 'utf8') : '';
const patched = hydrated ? patchConversationComputerCard(original) : '';
const ast = hydrated ? parse(patched, { ecmaVersion: 'latest', sourceType: 'module' }) : { body: [] };
const declaration = name => {
  if (!hydrated) return '';
  const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, name);
  return patched.slice(node.start, node.end);
};
const observations = [];
const record = (scenario, observable) => observations.push({ scenario, observable, pass: true });
function runtime() {
  const calls = [];
  const statuses = new Map();
  let selected = 'unrelated-selected-bot';
  return {
    calls, statuses,
    selection: {
      select(id) { calls.push(['select', id]); selected = id; },
      async waitForReady(id) { calls.push(['ready', id]); },
      readCurrentAgentId() { return selected; },
    },
    foreverBox: {
      getStatus(id) { return statuses.get(id); },
      handBack(id, reason) { calls.push(['handBack', id, reason]); return Promise.resolve(); },
      ensure(id) { calls.push(['ensure', id]); },
    },
    open(id) { calls.push(['open', id ?? null]); },
  };
}
const entry = (id, requestId) => ({ kind: 'send-message', id, boxRequestId: requestId, boxInstruction: `instruction ${id}`, message: { type: 'text', text: '' } });
function hookHarness(rt) {
  let owner;
  let monitors = [];
  const context = vm.createContext({
    S: { useMemo: f => f() }, Mee: () => owner, Qe: () => rt,
    NTn: id => ({ handoff: rt.statuses.get(id)?.handoff ?? null }),
    MTn: () => monitors, W1t: new Map(),
    Dzn: { openComputer: id => rt.open(id) }, ETn: e => { throw e; },
  });
  vm.runInContext([declaration('Obn'), declaration('RConversationComputerCardActions'), declaration('Dbn')].join('\n'), context);
  return (id, row, supplied, children = []) => { owner = id; monitors = children; return context.Dbn(row.id, supplied, row); };
}

test('multiple mounted conversations bind data and retained callbacks to their own agents', { skip: skipBundle }, async () => {
  const rt = runtime(), hook = hookHarness(rt);
  for (const id of ['A', 'B']) rt.statuses.set(id, { handoff: { requestId: `req-${id}`, instruction: `help ${id}`, snapshotDataUrl: `data:image/png;base64,${id}` } });
  const a = hook('A', entry('same-entry-id', 'req-A'));
  const b = hook('B', entry('same-entry-id', 'req-B'));
  assert.equal(a.card.snapshotDataUrl, 'data:image/png;base64,A');
  assert.equal(b.card.snapshotDataUrl, 'data:image/png;base64,B');
  await b.openBox(); await a.openBox();
  assert.deepEqual(rt.calls, [['select','B'],['ready','B'],['open',null],['ensure','B'],['select','A'],['ready','A'],['open',null],['ensure','A']]);
  record('two conversations, same entry id, B then retained A callback', rt.calls);
});

test('subagent takeover opens original overlay with focus and never resolves a request', { skip: skipBundle }, async () => {
  const rt = runtime(), hook = hookHarness(rt);
  rt.statuses.set('child', { handoff: { requestId: 'child-request', instruction: 'child task' } });
  const binding = hook('parent', entry('child-card', 'child-request'), undefined, [{ subagentId: 'child', handoff: rt.statuses.get('child').handoff }]);
  await binding.openBox();
  assert.deepEqual(rt.calls, [['select','parent'],['ready','parent'],['open','child'],['ensure','child']]);
  await binding.handBack(); await binding.dismiss();
  assert.deepEqual(rt.calls.slice(-2), [['handBack','child','button'],['handBack','child','dismissed']]);
  record('child monitor and original hand-back reasons', rt.calls);
});

test('context-provided cards have working actions; stale requests cannot finish a newer request', { skip: skipBundle }, async () => {
  const rt = runtime(), hook = hookHarness(rt);
  const card = { requestId: 'old', subagentId: null, status: 'waiting', instruction: 'provided' };
  const binding = hook('A', entry('card', 'old'), card);
  rt.statuses.set('A', { handoff: { requestId: 'new' } });
  await binding.handBack(); await binding.dismiss();
  assert.deepEqual(rt.calls, []);
  rt.statuses.set('A', { handoff: { requestId: 'old' } });
  await binding.handBack(); await binding.dismiss();
  assert.deepEqual(rt.calls, [['handBack','A','button'],['handBack','A','dismissed']]);
  record('supplied context and stale request guard', rt.calls);
});

test('no owner, ordinary messages, resolved cards, failed/superseded navigation are safe', { skip: skipBundle }, async () => {
  const rt = runtime(), hook = hookHarness(rt);
  assert.equal(hook(null, entry('missing','req')), null);
  assert.equal(hook('A', { id: 'ordinary', kind: 'send-message' }), null);
  const binding = hook('A', { ...entry('resolved','req'), boxResolution: 'dismissed' });
  assert.equal(binding.card.status, 'dismissed');
  await binding.handBack(); await binding.dismiss(); assert.deepEqual(rt.calls, []);
  await binding.openBox(); assert.equal(rt.calls.at(-1)[1], 'A');
  rt.calls.length = 0;
  rt.selection.waitForReady = async () => { rt.selection.select('B'); };
  await binding.openBox(); assert.equal(rt.calls.some(c => c[0] === 'open'), false);
  rt.calls.length = 0;
  rt.selection.waitForReady = async () => { throw new Error('not ready'); };
  await assert.rejects(binding.openBox(), /not ready/);
  assert.equal(rt.calls.some(c => c[0] === 'open'), false);
  const invalid = RConversationComputerCardActions(rt, null, binding.card, rt.open);
  await invalid.openBox();
  record('missing owner / superseded and failed selection', 'zero overlay opens after supersession or failure');
});

test('legacy localization anchors stay intact for the existing i18n passes', { skip: skipBundle }, () => {
  const calls = [];
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({
    he: { c: n => Array(n).fill(Symbol.for('react.memo_cache_sentinel')) },
    S: { useId: () => 'id' }, p: { jsx, jsxs: jsx, Fragment: 'fragment' },
    re: (...values) => values.filter(v => typeof v === 'string').join(' '), Fe: () => ({ className: '' }),
    _s: {}, Rie: {}, $bn: { handed_back: { label: 'Done' }, replied: { label: 'Answered' }, dismissed: { label: 'Skipped', isMuted: true } }, Ubn: { label: 'Status unavailable' },
    vt: 'text', bt: 'icon', As: 'action',
  });
  vm.runInContext(declaration('RConversationLegacyCard') + ';var Hbn=RConversationLegacyCard;', context);
  const props = { instruction: '  real instruction  ', status: 'waiting', snapshotDataUrl: 'data:image/png;base64,test', onOpen: () => calls.push('open'), onHandBack: () => calls.push('button'), onDismiss: () => calls.push('dismissed') };
  function flatten(node) { return !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)]; }
  const nodes = flatten(context.Hbn(props));
  assert.ok(nodes.some(n => n.props?.children === 'Computer'));
  assert.ok(nodes.some(n => n.props?.children === 'real instruction'));
  assert.equal(nodes.find(n => n.type === 'img').props.src, props.snapshotDataUrl);
  nodes.find(n => n.type === 'button').props.onClick();
  for (const label of ['Take over', 'I’m done', 'Skip']) nodes.find(n => n.props?.children === label).props.onClick();
  assert.deepEqual(calls, ['open','open','button','dismissed']);
  for (const status of ['handed_back','replied','dismissed','unknown']) {
    const done = flatten(context.Hbn({ ...props, status }));
    assert.equal(done.some(n => n.props?.children === 'Take over'), false);
    assert.equal(done.some(n => n.type === 'img'), false);
  }
  const noImage = flatten(context.Hbn({ ...props, snapshotDataUrl: null }));
  assert.equal(noImage.some(n => n.type === 'img'), false);
  record('preserved legacy i18n anchors', { calls, image: props.snapshotDataUrl, resolvedStatuses: 4 });
});

test('fail closed on missing, duplicate, drifted or reapplied anchors; unrelated bytes preserved', { skip: skipBundle }, () => {
  assert.throws(() => patchConversationComputerCard(patched), /anchor/);
  assert.throws(() => patchConversationComputerCard(original.replace('const u=Dbn(o,c);', 'const u=Other(o,c);')), /anchor/);
  assert.throws(() => patchConversationComputerCard(original + 'function Dbn(n,e){}'), /ambiguous/);
  assert.throws(() => patchConversationComputerCard(original.replace('Yte.handBack(r.subagentId)', 'Yte.handBack(null)')), /anchor/);
  const start = original.indexOf('function Dbn(n,e){'), end = original.indexOf('function Rbn(){}function Fbn(){}function zbn(){}');
  assert.equal(patched.slice(0,start), original.slice(0,start));
  const originalCard = original.indexOf('function Hbn(n){');
  const suffix = patched.slice(patched.indexOf('function RConversationLegacyCard(n){'))
    .replace('function RConversationLegacyCard(n){','function Hbn(n){')
    .replace('const u=Dbn(o,c,t);','const u=Dbn(o,c);')
    .replace('e[5]!==v||e[6]!==v.status','e[5]!==v.instruction||e[6]!==v.status')
    .replace('e[5]=v,e[6]=v.status','e[5]=v.instruction,e[6]=v.status')
    .replace('className:"sand-box-handoff-card-wrap",isGroupStart:s.isGroupStart,timestampMs:t.timestampMs,variant:"question"','className:"sand-box-handoff-card-wrap",isGroupStart:s.isGroupStart,timestampMs:t.timestampMs,variant:"tab"')
    .replace('p.jsx(Hbn,{agentId:v.agentId,subagentId:v.subagentId,requestId:v.requestId,reason:v.reason,instruction:v.instruction,','p.jsx(Hbn,{instruction:v.instruction,');
  assert.equal(suffix, original.slice(originalCard));
  record('anchor integrity and unchanged sleep/preview code', 'full patched module parses; all unrelated suffix bytes equal');
});

test('recorded resolution wins a lingering live handoff like official vqe', { skip: skipBundle }, async () => {
  const rt = runtime(), hook = hookHarness(rt);
  rt.statuses.set('A', { handoff: { requestId: 'req', instruction: 'old pending' } });
  const row = { ...entry('card', 'req'), boxResolution: 'handed_back' };
  const binding = hook('A', row, { requestId: 'req', status: 'waiting', subagentId: null });
  assert.equal(binding.card.status, 'handed_back');
  await binding.handBack(); await binding.dismiss();
  assert.deepEqual(rt.calls, []);
  record('official recorded-resolution precedence', 'handed_back, zero completion calls');
});

test('preview pause patch composes in either order without changing per-Bot viewer semantics', { skip: skipBundle }, () => {
  const first = patchComputerPreviewStream(patched);
  const second = patchConversationComputerCard(patchComputerPreviewStream(original));
  assert.equal(first, second);
  parse(first, { ecmaVersion: 'latest', sourceType: 'module' });
  record('preview composition in both orders', 'byte-identical output, valid full module');
});

test('official PV DOM: elevated hierarchy, pending/failure/retry, disclosure, request isolation and bubble states', { skip: skipBundle }, async () => {
  const window = new Window();
  const saved = new Map(['window','document','IS_REACT_ACT_ENVIRONMENT'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const [key,value] of [['window',window],['document',window.document],['IS_REACT_ACT_ENVIRONMENT',true]]) Object.defineProperty(globalThis,key,{value,configurable:true});
  const styleContext=vm.createContext({});
  vm.runInContext('var lie={},x_e;'+declaration('C2t')+';var I2t=C2t();'+declaration('Fe'),styleContext);
  const Icon = props => jsx.jsx('i',{'data-icon-name':props.name,'aria-hidden':true});
  const Official = RConversationOfficialCardFactory(React,compiler,jsx,styleContext.Fe,(...items)=>items.filter(Boolean).join(' '),Icon,(en,zh)=>zh);
  const context=vm.createContext({S:React,p:jsx,RConversationOfficialCard:Official});
  vm.runInContext(declaration('RConversationCardInteraction')+declaration('Hbn'),context);
  const style=window.document.createElement('style');style.textContent=CONVERSATION_COMPUTER_CARD_CSS;window.document.head.append(style);
  window.document.documentElement.dataset.theme='cursor-light';
  const container=window.document.createElement('div');window.document.body.append(container);
  const {createRoot}=await import('react-dom/client');const root=createRoot(container);
  const captures=[];
  const capture=scenario=>{
    const section=container.querySelector('section');
    const frame=container.querySelector('.sand-box-handoff-card__frame');
    captures.push({scenario,html:container.innerHTML,computed:{radius:section&&window.getComputedStyle(section).borderRadius,background:section&&window.getComputedStyle(section).backgroundColor,aspectRatio:frame&&window.getComputedStyle(frame).aspectRatio}});
  };
  const buttons=()=>[...container.querySelectorAll('button')];
  const button=label=>buttons().find(node=>node.textContent===label);
  const click=async node=>{assert.ok(node);await React.act(async()=>node.click());};
  let finish,fail;
  const rt=runtime();
  rt.statuses.set('A',{handoff:{requestId:'req-A'}});
  rt.statuses.set('B',{handoff:{requestId:'req-B'}});
  rt.foreverBox.handBack=(id,reason)=>{rt.calls.push(['handBack',id,reason]);return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});};
  const propsFor=(owner,requestId='req-'+owner)=>{
    const card={requestId,status:'waiting',subagentId:null};
    const actions=RConversationComputerCardActions(rt,owner,card,id=>rt.open(id));
    return {agentId:owner,requestId,instruction:'登录 '+owner,status:'waiting',snapshotDataUrl:'data:image/png;base64,'+owner,onOpen:actions.openBox,onHandBack:actions.handBack,onDismiss:actions.dismiss};
  };
  const render=async props=>React.act(async()=>root.render(jsx.jsx(context.Hbn,props)));
  try {
    await render(propsFor('A'));
    assert.equal(container.querySelector('section').getAttribute('data-status'),'waiting');
    assert.ok(container.textContent.includes('电脑'));
    assert.ok(container.textContent.includes('需要操作'));
    assert.ok(container.textContent.includes('登录 A'));
    assert.deepEqual(buttons().map(node=>node.textContent),['','跳过','我完成了','接管']);
    assert.equal(button('接管').dataset.variant,'primary');
    assert.equal(button('我完成了').dataset.variant,'secondary');
    assert.equal(button('跳过').dataset.variant,'secondary');
    assert.equal(container.querySelector('img').getAttribute('src'),'data:image/png;base64,A');
    assert.equal(container.querySelector('[data-computer-card-agent-id]').dataset.computerCardAgentId,'A');
    capture('elevated-waiting-light');
    assert.equal(captures.at(-1).computed.radius,'24px');
    assert.equal(captures.at(-1).computed.background,'#ffffff');
    assert.equal(captures.at(-1).computed.aspectRatio,'16 / 9');
    await click(button('我完成了'));
    assert.equal(button('我完成了').disabled,true);
    assert.equal(button('我完成了').getAttribute('aria-busy'),'true');
    assert.equal(button('跳过').disabled,true);
    assert.equal(button('接管').disabled,false);
    await click(button('跳过'));
    assert.equal(rt.calls.filter(c=>c[0]==='handBack').length,1);
    capture('elevated-pending');
    await React.act(async()=>fail(new Error('transport failed')));
    assert.equal(container.querySelector('[role=alert]').textContent,'出错了，请重试。');
    assert.equal(button('我完成了').disabled,false);
    capture('elevated-failed');
    await click(button('我完成了'));
    await React.act(async()=>finish());
    const disclosure=container.querySelector('button[aria-expanded]');
    assert.equal(disclosure.getAttribute('aria-expanded'),'false');
    assert.ok(disclosure.textContent.includes('完成'));
    assert.equal(button('接管'),undefined);
    assert.equal(container.querySelector('img'),null);
    capture('elevated-completed-collapsed');
    await click(disclosure);
    assert.equal(container.querySelector('button[aria-expanded]').getAttribute('aria-expanded'),'true');
    assert.ok(button('打开电脑'));
    assert.ok(window.document.getElementById(disclosure.getAttribute('aria-controls')));
    capture('elevated-completed-expanded');
    await click(button('打开电脑'));
    assert.deepEqual(rt.calls.slice(-4),[['select','A'],['ready','A'],['open',null],['ensure','A']]);

    await render(propsFor('A','req-A2'));
    rt.statuses.set('A',{handoff:{requestId:'req-A2'}});
    await click(button('我完成了'));
    const finishOld=finish;
    await render(propsFor('B'));
    await React.act(async()=>finishOld());
    assert.ok(button('接管'));
    assert.equal(button('我完成了').disabled,false);
    assert.equal(container.querySelector('img').getAttribute('src'),'data:image/png;base64,B');
    assert.equal(container.querySelector('[data-computer-card-agent-id]').dataset.computerCardAgentId,'B');
    capture('owner-change-late-A-result');
    window.document.documentElement.dataset.theme='cursor-dark';
    // happy-dom caches ancestor-selector results. Validate dark initial styling
    // on a fresh mounted tree; this does not claim native live theme-switch QA.
    await React.act(async()=>root.render(null));
    await render(propsFor('B'));
    assert.equal(window.getComputedStyle(container.querySelector('section')).backgroundColor,'#1f1f1f');
    await click(button('跳过'));
    assert.deepEqual(rt.calls.at(-1),['handBack','B','dismissed']);
    await React.act(async()=>finish());
    assert.ok(container.querySelector('button[aria-expanded]').textContent.includes('已跳过'));
    capture('elevated-skipped-dark');

    await render({...propsFor('B','req-new'),surface:'bubble',snapshotDataUrl:null});
    rt.statuses.set('B',{handoff:{requestId:'req-new'}});
    assert.equal(container.querySelector('img'),null);
    assert.equal(container.querySelector('article').dataset.status,'waiting');
    assert.deepEqual(buttons().map(node=>node.textContent),['','接管','我完成了','跳过']);
    assert.equal(button('我完成了').dataset.variant,'outline');
    assert.equal(button('跳过').dataset.variant,'ghost');
    await click(button('我完成了'));
    assert.equal(button('跳过').disabled,true);
    assert.equal(button('接管').disabled,false);
    await React.act(async()=>fail(new Error('retry')));
    assert.equal(container.querySelector('[role=alert]').textContent,'出错了，请重试。');
    capture('bubble-failed-fallback');
    for (const status of ['handed_back','replied','dismissed','unknown']) {
      await render({...propsFor('B'),surface:'bubble',status});
      assert.ok(button('打开电脑'));
      assert.equal(button('接管'),undefined);
      assert.equal(container.querySelector('img'),null);
      assert.equal(container.querySelector('[role=status]')===null,status==='replied');
      capture('bubble-'+status);
    }
    const evidence=resolve(process.env.COMPUTER_CARD_EVIDENCE??mkdtempSync(resolve(tmpdir(),'conversation-card-dom-')));
    mkdirSync(evidence,{recursive:true});
    writeFileSync(resolve(evidence,'dom-states.json'),JSON.stringify(captures,null,2)+'\n');
    record('official PV DOM and request lifecycle', {states:captures.map(x=>x.scenario),calls:rt.calls,artifact:resolve(evidence,'dom-states.json')});
  } finally {
    await React.act(async()=>root.unmount());
    window.happyDOM.abort();
    for(const [key,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});

test('official CSS is scoped and includes card geometry, focus, pending and both theme declarations', () => {
  const css=postcss.parse(CONVERSATION_COMPUTER_CARD_CSS);
  css.walkRules(rule=>{
    if(rule.parent.type==='atrule'&&rule.parent.name.endsWith('keyframes'))return;
    assert.ok(rule.selector.includes('.r-conversation-computer-card'),rule.selector);
  });
  assert.ok(CONVERSATION_COMPUTER_CARD_CSS.includes('html[data-theme="cursor-dark"]'));
  assert.ok(CONVERSATION_COMPUTER_CARD_CSS.includes('html[data-theme="cursor-light"]'));
  for(const required of ['.sand-1m1syzd','.sand-124efjc','.sand-fxdvfh','.sand-9v5kkp','@keyframes sand-1wc8ddo-B','.sand-tyxrsu']) assert.ok(CONVERSATION_COMPUTER_CARD_CSS.includes(required),required);
  for(const [theme,color] of [['dark','#f5f5f5'],['light','#1c1c1c']]) {
    const rule=css.nodes.find(node=>node.selector===`html[data-theme="cursor-${theme}"] .r-conversation-computer-card`);
    assert.equal(rule.nodes.find(node=>node.prop==='--sand-bg-primary').value,color);
  }
  record('official scoped CSS', 'light/dark tokens, frame/card/button/focus/spinner declarations present; zero global style rules');
});

test('card labels remain compatible with real i18n pair transforms', { skip: skipBundle }, () => {
  const owned=new Set(['Computer','Take over','Take over the computer','I’m done','Skip','Open computer']);
  let localized=patched;
  for(const [en,zh,,mode] of [...MAIN_I18N_PAIRS,...MAIN_I18N_061_PAIRS]) {
    if(!owned.has(en))continue;
    const result=applyPair(localized,en,zh,mode);
    assert.ok(result.hits>0,en);
    localized=result.patched;
  }
  parse(localized,{ecmaVersion:'latest',sourceType:'module'});
  record('real card-label i18n transforms', 'all owned anchors reachable; transformed full module parses');
});

test('official embedded English catalog and Chinese labels both render in PV', { skip: skipBundle }, () => {
  const context=vm.createContext({});
  vm.runInContext('var lie={},x_e;'+declaration('C2t')+';var I2t=C2t();'+declaration('Fe'),context);
  const captures=[];
  for(const locale of ['en','zh']) {
    const View=RConversationOfficialCardFactory(React,compiler,jsx,context.Fe,(...items)=>items.filter(Boolean).join(' '),()=>null,(en,zh)=>locale==='en'?en:zh);
    const render=props=>renderToStaticMarkup(jsx.jsx(View,{instruction:'Example task',status:'waiting',surface:'elevated',...props}));
    const waiting=render({handBackAttempt:{kind:'failed'}});
    const expected=locale==='en'?['Computer','Action needed','Take over','I&#x27;m done','Skip','Something went wrong. Try again.']:['电脑','需要操作','接管','我完成了','跳过','出错了，请重试。'];
    for(const label of expected)assert.ok(waiting.includes(label),locale+': '+label);
    assert.doesNotMatch(waiting,/Azione richiesta|Prendi il controllo|Ho finito|Salta/);
    const resolved=render({surface:'bubble',status:'handed_back'});
    assert.ok(resolved.includes(locale==='en'?'Open computer':'打开电脑'));
    const unavailable=render({status:'unknown'});
    assert.ok(unavailable.includes(locale==='en'?'Status unavailable':'状态不可用'));
    captures.push({locale,waiting,resolved,unavailable});
  }
  const dir=resolve(process.env.COMPUTER_CARD_EVIDENCE??mkdtempSync(resolve(tmpdir(),'card-locales-')));
  mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'locale-dom-states.json'),JSON.stringify(captures,null,2)+'\n');
  record('English embedded catalog and unchanged Chinese labels',{locales:['en','zh'],states:6,artifact:resolve(dir,'locale-dom-states.json')});
});

test('staged build adapter emits verified hashes and a parseable patched artifact', { skip: skipBundle }, async () => {
  const dir = process.env.COMPUTER_CARD_EVIDENCE ? resolve(process.env.COMPUTER_CARD_EVIDENCE) : mkdtempSync(resolve(tmpdir(), 'conversation-card-'));
  const appRoot = resolve(dir, 'staged');
  mkdirSync(resolve(appRoot,'dist/renderer/assets'), { recursive: true });
  writeFileSync(resolve(appRoot,'dist/renderer/assets/index-UbX-y3il.js'),original);
  const baselineAssets = resolve(baseline, '..');
  const cssName = readdirSync(baselineAssets).find(name => /^index-.*\.css$/.test(name));
  assert.ok(cssName);
  const originalCss = readFileSync(resolve(baselineAssets,cssName),'utf8');
  writeFileSync(resolve(appRoot,'dist/renderer/assets',cssName),originalCss);
  const evidence = await applyOriginalRendererConversationComputerCard({ appRoot });
  assert.equal(readFileSync(resolve(appRoot,evidence.file),'utf8'), patched);
  assert.equal(evidence.patchedSha256, createHash('sha256').update(patched).digest('hex'));
  assert.equal(evidence.originalSha256, createHash('sha256').update(original).digest('hex'));
  assert.equal(readFileSync(resolve(appRoot,evidence.css.file),'utf8'),originalCss+'\n'+CONVERSATION_COMPUTER_CARD_CSS);
  assert.equal(evidence.css.patchedSha256,createHash('sha256').update(originalCss+'\n'+CONVERSATION_COMPUTER_CARD_CSS).digest('hex'));
  record('build adapter', evidence);
  writeFileSync(resolve(dir,'scenarios.json'),JSON.stringify({baseline, scenarios:observations},null,2)+'\n');
});
