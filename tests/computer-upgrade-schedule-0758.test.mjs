import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import {parse} from 'acorn';
import {patchComputerUpgradeSchedule0758} from '../scripts/lib/computer-upgrade-schedule-0758-patch.mjs';
import {patchExtraFile} from '../scripts/lib/extra-i18n-patch.mjs';
import {applyOriginalRendererComputerUpdate} from '../scripts/lib/computer-update-renderer-patch.mjs';

const root=path.resolve(import.meta.dirname,'..');const temporary=await mkdtemp(path.join(root,'node_modules/.cache/computer-schedule-'));
test.after(()=>rm(temporary,{recursive:true,force:true}));
// The pinned 0.18 main chunk. gitignored, so it only exists after `npm run bootstrap`.
const bundle=await readFile(path.join(root,'src/app/dist/renderer/assets/index-UbX-y3il.js'),'utf8').catch(()=>null);
const bundleSkip=bundle==null?'src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped.':false;
const outfile=path.join(temporary,'scheduler.cjs');await build({entryPoints:[path.join(root,'source/electron-main/box/computer-upgrade-scheduler.ts')],outfile,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'});
const {ComputerUpgradeScheduler,COMPUTER_UPGRADE_GRACE_MS}=createRequire(import.meta.url)(outfile);
let serial=0;
function setup(perform=async()=>({status:'started-untrackable'}),filename=path.join(temporary,'schedule-'+(++serial)+'.json')){
  let now=100000;const timers=[];
  const options={filename,perform,now:()=>now,setTimer:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return()=>timer.cancelled=true}};
  const scheduler=new ComputerUpgradeScheduler(options);scheduler.start();
  return{scheduler,timers,options,setNow:value=>{now=value}};
}

test('schedule persists, rejects past/invalid time and executes at most once',async()=>{
  let calls=0;const f=setup(async()=>{calls++;return{status:'started-untrackable'}});
  assert.throws(()=>f.scheduler.schedule({scheduledAtMs:99999}),/future/);
  assert.throws(()=>f.scheduler.schedule({scheduledAtMs:NaN}));
  assert.throws(()=>f.scheduler.schedule({scheduledAtMs:150000,force:true}));
  const {schedule}=f.scheduler.schedule({scheduledAtMs:150000});assert.equal(f.timers.at(-1).ms,50000);
  assert.equal(JSON.parse(await readFile(f.options.filename)).state,'scheduled');
  assert.throws(()=>f.scheduler.schedule({scheduledAtMs:160000}),/already scheduled/);
  f.setNow(150000);await Promise.all([f.scheduler.runDue(schedule.id),f.scheduler.runDue(schedule.id)]);
  assert.equal(calls,1);assert.equal(f.scheduler.get().schedule.state,'completed');f.scheduler.stop();
});

test('reschedule and cancel invalidate old timer callbacks and survive app restart',async()=>{
  let calls=0;const f=setup(async()=>{calls++;return{status:'started-untrackable'}});
  const old=f.scheduler.schedule({scheduledAtMs:150000}).schedule;
  const next=f.scheduler.schedule({scheduledAtMs:200000},true).schedule;
  f.setNow(150000);await f.scheduler.runDue(old.id);assert.equal(calls,0);assert.equal(f.scheduler.get().schedule.id,next.id);
  f.scheduler.stop();const resumed=new ComputerUpgradeScheduler(f.options);resumed.start();assert.equal(resumed.get().schedule.id,next.id);
  resumed.cancel(false);f.setNow(200000);await resumed.runDue(next.id);assert.equal(calls,0);assert.equal(resumed.get().schedule.state,'cancelled');
  assert.equal(resumed.cancel(true).schedule,null);resumed.stop();
});

test('a missed window never restarts the computer on wake',async()=>{
  let calls=0;const f=setup(async()=>{calls++;return{status:'started-untrackable'}});const state=f.scheduler.schedule({scheduledAtMs:150000}).schedule;
  f.scheduler.stop();f.setNow(150000+COMPUTER_UPGRADE_GRACE_MS+1);const resumed=new ComputerUpgradeScheduler(f.options);resumed.start();await resumed.runDue(state.id);
  assert.equal(calls,0);assert.equal(resumed.get().schedule.state,'missed');resumed.stop();
});

test('running is durable before execution; cancellation and rescheduling cannot race it',async()=>{
  let finish;const f=setup(()=>new Promise(resolve=>finish=resolve));const state=f.scheduler.schedule({scheduledAtMs:150000}).schedule;
  f.setNow(150000);const run=f.scheduler.runDue(state.id);
  assert.equal(JSON.parse(await readFile(f.options.filename)).state,'running');
  assert.throws(()=>f.scheduler.cancel(),/already started/);assert.throws(()=>f.scheduler.schedule({scheduledAtMs:200000},true),/already started/);
  finish({status:'started-untrackable'});await run;f.scheduler.stop();
  await writeFile(f.options.filename,JSON.stringify({...state,state:'running'}));const resumed=new ComputerUpgradeScheduler(f.options);resumed.start();
  assert.equal(resumed.get().schedule.state,'failed');assert.match(resumed.get().schedule.detail,/stopped during/);resumed.stop();
});

test('update rejection and exceptions become terminal failures without automatic retries',async()=>{
  for(const perform of [async()=>({status:'rejected',reason:'Busy'}),async()=>{throw new Error('Docker unavailable')},async()=>({status:'dev-fallback'})]){
    const f=setup(perform);const state=f.scheduler.schedule({scheduledAtMs:150000}).schedule;f.setNow(150000);await f.scheduler.runDue(state.id);
    assert.equal(f.scheduler.get().schedule.state,'failed');assert.ok(f.scheduler.get().schedule.detail);f.scheduler.stop();
  }
});

test('corrupt state fails closed rather than executing or silently clearing it',async()=>{
  const f=setup();f.scheduler.stop();await writeFile(f.options.filename,'not-json');
  assert.throws(()=>new ComputerUpgradeScheduler(f.options).start());assert.equal(await readFile(f.options.filename,'utf8'),'not-json');
});

test('the real pinned computer renderer accepts a localized schedule action and parses',{skip:bundleSkip},async()=>{
  const source=bundle;
  // Use the actual existing computer pass, not a synthetic substitute for its anchors.
  const stage=path.join(temporary,'stage');const{mkdir}=await import('node:fs/promises');await mkdir(path.join(stage,'dist/renderer/assets'),{recursive:true});
  const file=path.join(stage,'dist/renderer/assets/index-UbX-y3il.js');await writeFile(file,source);
  await applyOriginalRendererComputerUpdate({stageRoot:stage});
  const prepared=patchExtraFile(await readFile(file,'utf8'),{pairs:[]}).patched;
  const patched=patchComputerUpgradeSchedule0758(prepared);parse(patched,{ecmaVersion:'latest',sourceType:'module'});
  assert.match(patched,/RComputerUpgrade0758,\{disabled:l\|\|t\|\|s,onUpdate:\(\)=>m\(!1\)/);
  assert.match(patched,/api\.scheduleUpgrade\(timestamp\)/);assert.match(patched,/api\.cancelUpgrade\(false\)/);
  assert.throws(()=>patchComputerUpgradeSchedule0758(patched),/already patched/);
});
