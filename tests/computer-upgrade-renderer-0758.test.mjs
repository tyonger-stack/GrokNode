import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {build} from 'esbuild';
import {Window} from 'happy-dom';
import {COMPUTER_UPGRADE_COMPONENT} from '../scripts/lib/computer-upgrade-schedule-0758-patch.mjs';
const root=path.resolve(import.meta.dirname,'..');const temporary=await mkdtemp(path.join(root,'node_modules/.cache/schedule-ui-'));
test.after(()=>rm(temporary,{recursive:true,force:true}));
async function load(entry,name){const outfile=path.join(temporary,name+'.cjs');await build({entryPoints:[path.join(root,entry)],outfile,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'});return createRequire(import.meta.url)(outfile)}
const{ComputerUpgradeScheduler}=await load('source/electron-main/box/computer-upgrade-scheduler.ts','scheduler');
const{createMainEdgeHandlers}=await load('source/electron-main/main-edge.ts','edge');
const{createDesktopPreloadBridge}=await load('source/electron-preload/preload.ts','preload');
const dom=new Window();globalThis.window=dom;globalThis.document=dom.document;globalThis.HTMLElement=dom.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react'),jsx=await import('react/jsx-runtime');const{createRoot}=await import('react-dom/client');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('renderer scheduling reaches the real preload, main edge, and durable store',async()=>{
  let updates=0;const scheduler=new ComputerUpgradeScheduler({filename:path.join(temporary,'schedule.json'),perform:async()=>{throw new Error('No Docker commands in UI tests')},setTimer:()=>()=>{}});scheduler.start();
  const handlers=createMainEdgeHandlers({computerUpgrade:scheduler});const calls=[];
  const mainEdge=new Proxy({subscribe:()=>()=>{}},{get:(target,method)=>target[method]??(async raw=>{calls.push(method);return handlers[method](raw??{})})});
  const desktop=createDesktopPreloadBridge({ipc:{invoke:async()=>({}),on(){},off(){}},webFrame:{},mainEdge,env:{},devRestartEnabled:false,initialState:{}});
  const wrapper=({children})=>React.createElement('div',null,children);
  const button=({children,onClick,disabled})=>React.createElement('button',{onClick,disabled},children);
  const Component=vm.runInNewContext(COMPUTER_UPGRADE_COMPONENT+';RComputerUpgrade0758',{
    S:React,p:jsx,window:{desktop},RLocT:(en,zh)=>zh,Qs:button,Ut:{body2:{}},jne:{settingsConfirmAction:{},updateWeakBorder:{}},
    Gt:{Root:({children})=>React.createElement('div',{role:'dialog'},children),Title:wrapper,Header:wrapper,Description:wrapper,Body:wrapper,ActionBar:wrapper,Action:button},setInterval,clearInterval,Date,
  });
  const host=document.createElement('div');document.body.append(host);const renderer=createRoot(host);
  const click=async label=>React.act(async()=>{const found=[...host.querySelectorAll('button')].find(x=>x.textContent===label);assert.ok(found,label+' not found');found.click();await tick()});
  try{
    await React.act(async()=>{renderer.render(React.createElement(Component,{disabled:false,onUpdate:()=>{updates++}}));await tick()});
    assert.ok(calls.includes('getComputerUpgradeSchedule'));
    await click('更新');assert.match(host.textContent,/运行中的任务可能中断/);assert.match(host.textContent,/不会下载新镜像/);
    await click('安排更新');assert.ok(host.querySelector('input[type=datetime-local]'));
    const input=host.querySelector('input');
    const future=new Date(Date.now()+2*3600000);const value=new Date(future.getTime()-future.getTimezoneOffset()*60000).toISOString().slice(0,16);
    // Dispatch through React's event handler with the same input value a native change supplies.
    const propsKey=Object.keys(input).find(key=>key.startsWith('__reactProps$'));assert.ok(propsKey);
    await React.act(async()=>{input[propsKey].onChange({currentTarget:{value}});await tick()});
    await click('保存');assert.equal(scheduler.get().schedule.state,'scheduled');assert.ok(calls.includes('scheduleComputerUpgrade'));assert.match(host.textContent,/更新安排于/);
    await click('重新安排更新');await click('保存');assert.ok(calls.includes('rescheduleComputerUpgrade'));
    await click('取消更新');assert.equal(scheduler.get().schedule.state,'cancelled');assert.ok(calls.includes('cancelComputerUpgrade'));
    await click('关闭');assert.equal(scheduler.get().schedule,null);
    await click('更新');await click('立即更新');assert.equal(updates,1);assert.equal(host.querySelector('[role=dialog]'),null);
  }finally{await React.act(async()=>renderer.unmount());host.remove();scheduler.stop();await dom.happyDOM.close()}
});

test('an immediate update cancels the timer and cannot overlap a running scheduled update',async()=>{
  let now=1000,finish;const performed=[];
  const scheduler=new ComputerUpgradeScheduler({filename:path.join(temporary,'manual.json'),now:()=>now,setTimer:()=>()=>{},perform:()=>new Promise(resolve=>finish=resolve)});scheduler.start();
  const handlers=createMainEdgeHandlers({computerUpgrade:scheduler,boxRecovery:{recreateComputer:async args=>{performed.push(args);return{status:'started-untrackable'}},forceRecreateComputer:()=>assert.fail('Reset must not run during a scheduled update')}});
  try{
    scheduler.schedule({scheduledAtMs:2000});await handlers.updateComputer({id:'bot-a'});assert.equal(scheduler.get().schedule.state,'cancelled');assert.deepEqual(performed,[{preserveData:true,force:false}]);
    const state=scheduler.schedule({scheduledAtMs:3000}).schedule;now=3000;const running=scheduler.runDue(state.id);
    await assert.rejects(()=>handlers.updateComputer({id:'bot-a'}),/already started/);assert.throws(()=>handlers.forceRecreateComputer({}),/already started/);
    finish({status:'started-untrackable'});await running;assert.equal(performed.length,1);
  }finally{scheduler.stop()}
});
