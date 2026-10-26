import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {parse} from 'acorn';
import {Window} from 'happy-dom';
import {EXTRA_I18N_FILES,patchExtraFile} from '../scripts/lib/extra-i18n-patch.mjs';
import {RUNTIME_LINES} from '../scripts/lib/i18n-patch-engine.mjs';
import {patchHandoffSource,patchConnectorHandoffStore,applyConnectorCardHandoff0758Patch} from '../scripts/lib/connector-card-handoff-0758-patch.mjs';

// The pinned 0.18 chunks. gitignored, so they only exist after `npm run bootstrap`.
const assetsRoot=path.resolve(import.meta.dirname,'../src/app/dist/renderer/assets');
const shell=await readFile(path.join(assetsRoot,'index-UbX-y3il.js'),'utf8').catch(()=>null);
const card=await readFile(path.join(assetsRoot,'connector-card-BOH-l7tH.js'),'utf8').catch(()=>null);
const bundleSkip=shell==null||card==null
  ?'src/app/dist is gitignored and only exists after npm run bootstrap; pinned-bundle assertions skipped.'
  :false;
const localized=card==null?null:patchExtraFile(card,EXTRA_I18N_FILES.find(x=>x.file==='connector-card-BOH-l7tH.js')).patched;
const patchedShell=shell==null?null:patchConnectorHandoffStore(shell);
const patchedCard=localized==null?null:patchHandoffSource(localized);
const ast=source=>parse(source,{ecmaVersion:'latest',sourceType:'module'});
const declaration=(source,name)=>{const node=ast(source).body.find(node=>node.id?.name===name);assert.ok(node,name+' is missing');return source.slice(node.start,node.end)};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function makeStore(openExternal) {
  const timers=[];
  const Store=vm.runInNewContext(declaration(patchedShell,'PBn')+';PBn',{
    ene:x=>x.toLowerCase().replace(/[^a-z0-9-]/g,''),i0t:x=>x.toLowerCase(),IBn:900,ABn:600000,
  });
  const store=new Store({openExternal,now:()=>100,scheduleTimeout:(ms,fn)=>{
    const timer={ms,fn,cancelled:false};timers.push(timer);return()=>{timer.cancelled=true};
  }});
  return {store,timers};
}
const input={connector:'github',displayName:'GitHub',authorizationUrl:'https://example.test/oauth?state=secret'};

test('browser-open rejection emits openFailed with the original authorization URL',{skip:bundleSkip},async()=>{
  const {store,timers}=makeStore(async()=>{throw new Error('OS refused the browser')});
  let updates=0;store.subscribe(()=>updates++);
  store.begin(input);assert.equal(store.get('github').status,'waiting');await tick();
  assert.equal(store.get('github').status,'openFailed');
  assert.equal(store.get('github').authorizationUrl,input.authorizationUrl);
  assert.equal(timers[0].cancelled,true);assert.equal(updates,2);
});

test('late rejection cannot overwrite a newer reopen or replacement attempt',{skip:bundleSkip},async()=>{
  for(const replace of [false,true]){
    const pending=[];const {store}=makeStore(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
    store.begin(input);
    if(replace)store.begin({...input,authorizationUrl:'https://example.test/new'});else store.reopen('github');
    pending[0].reject(new Error('late failure'));await tick();
    assert.equal(store.get('github').status,'waiting');
    if(!replace){pending[1].reject(new Error('current failure'));await tick();assert.equal(store.get('github').status,'openFailed')}
  }
});

test('resolved connectors and reset ignore old browser errors',{skip:bundleSkip},async()=>{
  const pending=[];const {store}=makeStore(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
  store.begin(input);store.clearResolved([{serverIdentifier:'github',name:'GitHub'}]);
  pending[0].reject(new Error('late'));await tick();assert.equal(store.get('github'),undefined);
  store.reset();store.begin(input);store.reset();pending[1].reject(new Error('after reset'));await tick();assert.equal(store.getSnapshot().size,0);
});

test('staggered browser-open errors are scoped to the correct connector',{skip:bundleSkip},async()=>{
  const pending=[];const {store,timers}=makeStore(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
  store.begin(input);store.begin({...input,connector:'gmail'});
  timers.find(timer=>timer.ms===900).fn();
  pending[0].reject(new Error('github only'));await tick();
  assert.equal(store.get('github').status,'openFailed');assert.equal(store.get('gmail').status,'waiting');
  pending[1].resolve();
});

test('success remains waiting until callback or timeout and reopens the original URL',{skip:bundleSkip},async()=>{
  const opened=[];const {store,timers}=makeStore(async url=>opened.push(url));
  store.begin(input);await tick();assert.equal(store.get('github').status,'waiting');
  store.reopen('github');await tick();assert.deepEqual(opened,[input.authorizationUrl,input.authorizationUrl]);
  timers.at(-1).fn();assert.equal(store.get('github').status,'timedOut');
});

test('real localized card and shell both parse; missing/duplicate anchors fail closed',{skip:bundleSkip},()=>{
  ast(patchedCard);ast(patchedShell);
  assert.throws(()=>patchHandoffSource(card),/requires extra-i18n/);
  assert.throws(()=>patchHandoffSource(patchedCard),/already patched/);
  assert.throws(()=>patchConnectorHandoffStore(patchedShell),/already patched/);
  assert.throws(()=>patchHandoffSource(localized.replace('b=z?.status===','b=changed?.status===')),/account status/);
  assert.match(patchedCard,/signInUrl:z\.authorizationUrl/);assert.match(patchedCard,/signInUrl:ee\.authorizationUrl/);
});

test('the staged patch writes both real chunks and provenance',{skip:bundleSkip},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'connector-0758-'));
  try{
    const directory=path.join(root,'dist/renderer/assets');await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'index-UbX-y3il.js'),shell);await writeFile(path.join(directory,'connector-card-BOH-l7tH.js'),localized);
    const result=await applyConnectorCardHandoff0758Patch({stageRoot:root});
    assert.equal(result.files.length,2);assert.ok(result.files.every(x=>x.before!==x.after));
    assert.equal(await readFile(path.join(directory,'index-UbX-y3il.js'),'utf8'),patchedShell);
    assert.equal(await readFile(path.join(directory,'connector-card-BOH-l7tH.js'),'utf8'),patchedCard);
    assert.equal(JSON.parse(await readFile(path.join(root,'dist/renderer-connector-handoff-0758.json'))).version,'0.75.8');
  }finally{await rm(root,{recursive:true,force:true})}
});

const dom=new Window();globalThis.window=dom;globalThis.document=dom.document;
globalThis.HTMLElement=dom.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react');const jsx=await import('react/jsx-runtime');const {createRoot}=await import('react-dom/client');

test('rendered official handoff uses the existing clipboard hook, not retry, in English and Chinese',{skip:bundleSkip},async()=>{
  const copied=[];let rejectCopy=false;
  const navigator={clipboard:{writeText:async value=>{if(rejectCopy)throw new Error('denied');copied.push(value)}}};
  let locale='en';const context={
    l:jsx,d:(...values)=>values.join(' '),fe:{action:{}},S:React,he:{c:n=>Array(n)},LTn:2000,
    mm:()=>({wrap:()=>()=>{}}),navigator,window:{desktop:{language:{initial:{get preference(){return locale}}}}},
    se:({as:Tag='span',children})=>React.createElement(Tag,null,children),V:()=>React.createElement('i'),
    nn:({children,onClick})=>React.createElement('button',{onClick},children),
  };
  const source=RUNTIME_LINES.join('\n')+'\n'+declaration(shell,'BTn')+'\n'+declaration(shell,'qTn')+'\nconst RConnectorClipboard0758=qTn;\n'+declaration(patchedCard,'RConnectorHandoff0758')+';RConnectorHandoff0758';
  const Component=vm.runInNewContext(source,context);const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  let retry=0,reopen=0;
  const render=async props=>React.act(async()=>{root.render(React.createElement(Component,{displayName:'GitHub',handoff:{onRetry:()=>retry++,onReopen:()=>reopen++,...props}}));await tick()});
  const click=async label=>React.act(async()=>{const button=[...host.querySelectorAll('button')].find(x=>x.textContent===label);assert.ok(button,label);button.click();await tick()});
  try{
    await render({status:'waiting'});assert.match(host.textContent,/Waiting for GitHub/);await click('Reopen');assert.equal(reopen,1);
    await render({status:'openFailed',signInUrl:input.authorizationUrl});assert.match(host.textContent,/Couldn't open your browser/);
    await click('Copy link');assert.deepEqual(copied,[input.authorizationUrl]);assert.equal(retry,0);assert.match(host.textContent,/Copied/);
    await click('Retry');assert.equal(retry,1);
    rejectCopy=true;await click('Copied');assert.match(host.textContent,/Copy failed/);assert.equal(retry,1);
    locale='zh-CN';await render({status:'openFailed',signInUrl:input.authorizationUrl});assert.match(host.textContent,/无法为 GitHub 打开浏览器/);assert.match(host.textContent,/请将登录链接复制到浏览器中/);
    await render({status:'timedOut'});assert.match(host.textContent,/GitHub 授权未完成/);assert.equal(host.querySelectorAll('button').length,1);
    await render({status:'failed',failureDetail:'Server says access denied'});assert.match(host.textContent,/GitHub 授权失败/);assert.match(host.textContent,/Server says access denied/);
  }finally{await React.act(async()=>root.unmount());host.remove();await dom.happyDOM.close()}
});
