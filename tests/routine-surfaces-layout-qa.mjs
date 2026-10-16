import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parse } from 'acorn';
import { build } from 'esbuild';
import { patchOriginalRoutineSurfaces } from '../scripts/lib/routine-surfaces-renderer-patch.mjs';
import { patchOriginalLibraryHost } from '../scripts/lib/library-host-renderer-patch.mjs';

const root = path.resolve(import.meta.dirname, '..');
const electron = process.env.R12_ELECTRON ?? (await import('electron')).default;
const out = path.resolve(process.argv[2]);
await fs.mkdir(out, { recursive: true });
const baselinePatch = await import(path.join(out, 'R12-before-patch.mjs'));
const jsPath = path.join(root, 'src/app/dist/renderer/assets/index-UbX-y3il.js');
const cssPath = path.join(root, 'src/app/dist/renderer/assets/index-lCyB53CO.css');
const [raw, css] = await Promise.all([fs.readFile(jsPath, 'utf8'), fs.readFile(cssPath, 'utf8')]);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const functions = ['p3n','K2n','Cmt','c2','W2n','V2n','U2n','RRoutineRow','RRtLoc','RRtSummary','RRtTriggerLines','Qs','fr','vt','WTt','Hlt'];
const variables = ['Ut','Us','_s','Emt','Oie','Moe','FUe','Bi','b3e','HTt','VTt','GTt','qse','Mm','uin','din','min','sl','Iin','Ain','Aie','ryt','rm','Hf','yxe','iyt','ayt','oyt'];
const extracted = {};
for (const [version, patch] of [['before', baselinePatch.patchOriginalRoutineSurfaces], ['after', patchOriginalRoutineSurfaces]]) {
  const source = patchOriginalLibraryHost(patch(raw), '/* sand-library-host */');
  const parts = [];
  const found = new Set();
  for (const n of parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body) {
    if (n.type === 'FunctionDeclaration' && functions.includes(n.id.name)) { parts.push(source.slice(n.start, n.end)); found.add(n.id.name); }
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (variables.includes(d.id.name)) { parts.push('const ' + source.slice(d.start, d.end) + ';'); found.add(d.id.name); }
  }
  assert.equal(found.size, functions.length + variables.length, 'all real components and style definitions extracted');
  extracted[version] = parts.join('\n');
  await fs.writeFile(path.join(out, `R12-${version}-extracted.js`), extracted[version]);
}
const scaffold = String.raw`
import * as S from 'react';
import * as p from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
const he={c:n=>S.useMemo(()=>Array(n).fill(Symbol.for('react.memo_cache_sentinel')),[])};
const re=(...xs)=>xs.filter(Boolean).join(' '),Hr=re;
function Fe(...xs){const map={};for(const x of xs.flat(Infinity))if(x)Object.assign(map,x);delete map.$$css;return {className:Object.values(map).join(' ')}}
let state,locale='en';
const RLocT=(en,zh)=>locale==='zh'?zh:en;
const Dtt=()=>state, mmt=()=>false, Elt=()=>[],cct=()=>false,pin=(_,s)=>s,Cr=()=>{},g3n=()=>{},RUe=()=>0;
const Nmt=()=>null,D2n=()=>null,z2n=()=>null,h3n=()=>null,_0n=()=>null;
const iJt=()=>({setEnabled:async()=>{}});
const yo=({children})=>children;
const Dr=()=>p.jsx('span',{'aria-hidden':true,children:'+'});
const Ar=({children,className})=>p.jsx('div',{className,style:{display:'flex',flexDirection:'column'},children});
const RRoutineSurface=props=>p.jsx('div',{'data-editor-stub':props.automation?.id??'new',children:'Routine editor (isolated callback stub)'});
const __sandLibraryHostNS={RLibraryHost:()=>p.jsx('section',{'data-library':true,children:'Library'})};
`;
const probe = String.raw`
const root=createRoot(document.getElementById('root'));
let renderId=0;
const rect=el=>el?(({x,y,width,height,top,bottom,left,right})=>({x,y,width,height,top,bottom,left,right}))(el.getBoundingClientRect()):null;
window.renderScenario=(next,lang)=>{state=next;locale=lang;flushSync(()=>root.render(p.jsx(p3n,{agent:{id:'qa'},channelsView:{manifests:[],connections:[]},onViewChange:()=>{},onSectionRequestHandled:()=>{},key:++renderId})));};
window.measure=()=>{const lib=document.querySelector('[data-library]'),section=lib?.previousElementSibling,empty=section?.querySelector('.sand-routine__empty'),list=section?.querySelector('.sand-routine__list'),row=section?.querySelector('.sand-routine__item'),button=section?.querySelector('[data-routine-row="new"]'),heading=section?.querySelector('.sand-info-pane__section-heading');const er=empty?.parentElement;return {section:rect(section),library:rect(lib),empty:rect(empty),emptyRoot:rect(er),button:rect(button),row:rect(row),list:rect(list),heading:rect(heading),text:empty?.textContent,sectionStyle:section?{display:getComputedStyle(section).display,gap:getComputedStyle(section).gap,flexGrow:getComputedStyle(section).flexGrow,minHeight:getComputedStyle(section).minHeight}:null,emptyStyle:er?{gap:getComputedStyle(er).gap,padding:getComputedStyle(er).padding,flexGrow:getComputedStyle(er).flexGrow}:null,overflow:section?section.scrollWidth>section.clientWidth:false,rows:section?.querySelectorAll('.sand-routine__item').length??0,editor:document.querySelector('[data-editor-stub]')?.dataset.editorStub??null};};
window.clickCreate=()=>{document.querySelector('[data-routine-row="new"]').click();};
window.clickRow=()=>{document.querySelector('button[data-routine-row="qa-0"]').click();};
`;
for (const version of ['before', 'after']) {
  // Translation is a boundary stub using the production i18n table's exact copy.
  const translated = extracted[version].replace('children:"Routines are recurring tasks this agent runs on a schedule."','children:RLocT("Routines are recurring tasks this agent runs on a schedule.","例行任务是这个智能体按计划重复执行的任务。")').replaceAll('children:"Create Routine"','children:RLocT("Create Routine","创建例行任务")').replace('children:"Routines"','children:RLocT("Routines","例行任务")');
  await build({ stdin: { contents: scaffold + translated + probe, resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', outfile: path.join(out, `R12-${version}.js`), logLevel: 'silent' });
  await fs.writeFile(path.join(out, `R12-${version}.html`), `<!doctype html><html><head><meta charset="UTF-8"><style>${css}</style><style>html,body{margin:0}#root{--sand-text-primary:var(--cursor-text-primary);--sand-text-tertiary:var(--cursor-text-secondary);height:780px;display:flex;flex-direction:column;background:var(--cursor-bg-editor);color:var(--cursor-text-primary)}[data-library]{flex:none;height:60px;border-top:1px solid var(--cursor-stroke-secondary)}</style></head><body><div id="root"></div><script src="R12-${version}.js"></script></body></html>`);
}
await fs.writeFile(path.join(out,'R12-inputs.json'),JSON.stringify({jsPath,jsSha256:hash(raw),cssPath,cssSha256:hash(css),extractedComponents:functions,extractedStyleObjects:variables,stubs:['agent state/controller','unrelated overview sections','scroll viewport transparent flex container','editor callback destination','Library sibling at real host insertion anchor','icon glyph','i18n exact production copy','stylix class merge'],versions:Object.fromEntries(Object.entries(extracted).map(([k,v])=>[k,hash(v)]))},null,2));
const runner=String.raw`
const {app,BrowserWindow}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const out=process.argv[2], results=[], errors=[];
app.setPath('userData',path.join(out,'R12-electron-profile'));app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{let win;try{
win=new BrowserWindow({width:800,height:780,useContentSize:true,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
win.webContents.on('console-message',(_e,_l,message)=>{if(message.includes('Uncaught')||message.includes('ReferenceError'))errors.push(message)});
const row=i=>({id:'qa-'+i,name:'每日工作摘要',isEnabled:true,triggerDescription:'Every day at 9:00 AM',runs:[]});
const scenarios={zero:{status:'ready',value:[]},one:{status:'ready',value:[row(0)]},multiple:{status:'ready',value:[row(0),row(1),row(2)]},loading:{status:'loading'},failed:{status:'failed'},empty:{status:'empty'},loadingEmpty:{status:'loading',previous:[]},failedEmpty:{status:'failed',previous:[]},loadingOne:{status:'loading',previous:[row(0)]},failedOne:{status:'failed',previous:[row(0)]}};
for(const version of ['before','after'])for(const width of [600,480,320])for(const locale of ['zh','en']){
win.setContentSize(width,780);await win.loadFile(path.join(out,'R12-'+version+'.html'));
for(const [name,state]of Object.entries(scenarios)){
await win.webContents.executeJavaScript('window.renderScenario('+JSON.stringify(state)+','+JSON.stringify(locale)+')');
await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const geometry=await win.webContents.executeJavaScript('window.measure()');
const screenshot=path.join(out,'R12-'+version+'-'+width+'-'+locale+'-'+name+'.png');
if(['zero','one','multiple','loading'].includes(name))fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());
results.push({version,width,locale,name,geometry,screenshot:fs.existsSync(screenshot)?screenshot:null});
if(['zero','one'].includes(name)){await win.webContents.executeJavaScript('window.clickCreate()');await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(r))');assert.equal((await win.webContents.executeJavaScript('window.measure()')).editor,'new');}
if(name==='one'){await win.webContents.executeJavaScript('window.renderScenario('+JSON.stringify(state)+','+JSON.stringify(locale)+');');await win.webContents.executeJavaScript('window.clickRow()');await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(r))');assert.equal((await win.webContents.executeJavaScript('window.measure()')).editor,'qa-0');}
}
}
fs.writeFileSync(path.join(out,'R12-geometry.json'),JSON.stringify({results,errors},null,2));assert.deepEqual(errors,[]);
if(!process.env.R12_MEASURE_ONLY){
for(const r of results.filter(x=>x.version==='after')){const before=results.find(x=>x.version==='before'&&x.width===r.width&&x.locale===r.locale&&x.name===r.name);const one=results.find(x=>x.version==='after'&&x.width===r.width&&x.locale===r.locale&&x.name==='one');
if(['zero','empty','loadingEmpty','failedEmpty'].includes(r.name)){assert.ok(Math.abs(r.geometry.section.height-one.geometry.section.height)<=2,JSON.stringify(r));assert.ok(Math.abs(r.geometry.library.top-one.geometry.library.top)<=2);assert.equal(r.geometry.overflow,false);const g=r.geometry;assert.ok(g.empty.height>0&&g.button.height>0);assert.ok(g.empty.top>=g.section.top&&g.button.bottom<=g.section.bottom+1);assert.ok(g.empty.right<=g.section.right+1&&g.button.right<=g.section.right+1);assert.ok(g.empty.bottom<=g.button.top+1);}
else {assert.deepEqual(r.geometry,before.geometry,'unchanged '+r.name+' '+r.width+' '+r.locale);}
}}
console.log(JSON.stringify({pass:true,measureOnly:!!process.env.R12_MEASURE_ONLY,scenarios:results.length,errors}));
}catch(e){fs.writeFileSync(path.join(out,'R12-geometry.json'),JSON.stringify({results,errors,failure:String(e)},null,2));console.error(e);process.exitCode=1;}finally{if(win&&!win.isDestroyed())win.destroy();fs.writeFileSync(path.join(out,'R12-cleanup.json'),JSON.stringify({windowsRemaining:BrowserWindow.getAllWindows().length,isolatedUserData:app.getPath('userData'),currentAppTouched:false,dockerTouched:false}));app.exit(process.exitCode||0);}});
`;
const runnerPath=path.join(out,'R12-electron.cjs');
await fs.writeFile(runnerPath,runner);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,[runnerPath,out],{env,stdio:'inherit'});
const exit=await new Promise(resolve=>child.once('exit',resolve));
assert.equal(exit,0,'isolated Electron geometry scenarios');
