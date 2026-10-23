const {app,BrowserWindow}=require("electron");
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const out=process.argv[2];
app.setPath("userData",path.join(out,"electron-profile"));
app.commandLine.appendSwitch("disable-gpu");
const results=[];
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:400,height:240,show:true,webPreferences:{contextIsolation:true}});
  const wc=win.webContents;
  const evaluate=code=>wc.executeJavaScript(code,true);
  const settle=()=>new Promise(resolve=>setTimeout(resolve,350));
  async function capture(name){
    await settle();
    const data=await evaluate(`Object.fromEntries(['account','apps'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e);return [id,{x:r.x,y:r.y,width:r.width,height:r.height,expanded:e.hasAttribute('data-expanded'),yielding:e.hasAttribute('data-yielding'),folded:e.getAttribute('data-folded'),focusVisible:e.matches(':focus-visible'),className:e.className,display:s.display}]}))`);
    const image=await wc.capturePage();
    fs.writeFileSync(path.join(out,name+".png"),image.toPNG());
    results.push({name,...data});
    fs.writeFileSync(path.join(out,"browser-results.json"),JSON.stringify(results,null,2));
    return data;
  }
  async function move(id){
    const point=await evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    wc.sendInputEvent({type:"mouseMove",...point});await settle();return point;
  }
  try{
    await win.loadFile(path.join(out,"browser.html"));
    await evaluate(`(()=>{const glyph=document.querySelector('.sand-plugins-dock-icon i');glyph.textContent='';glyph.classList.add('ui-1yj7g93');glyph.style.fontFamily='cursor-icons';return document.fonts.load('16px cursor-icons','\uF461')})()`);
    const selectors=JSON.parse(fs.readFileSync(path.join(out,"selectors.json"),"utf8"));
    const unsupported=await evaluate(`(${JSON.stringify(selectors)}).filter(selector=>!CSS.supports("selector("+selector+")"))`);
    assert.deepEqual(unsupported,[]);
    const pseudo=await evaluate(`({content:getComputedStyle(account,"::after").content,shadow:getComputedStyle(account,"::after").boxShadow})`);
    assert.equal(pseudo.content,'""');
    assert.notEqual(pseudo.shadow,"none");
    fs.writeFileSync(path.join(out,"pseudo-elements.json"),JSON.stringify({unsupported,pseudo},null,2));
    let state=await capture("rest");
    assert.ok(state.account.width>=36&&state.account.width<=40,JSON.stringify(state));
    assert.ok(state.apps.width>150,JSON.stringify(state));
    await move("account");state=await capture("account-hover");
    assert.ok(state.account.expanded);assert.equal(state.apps.folded,"logos");
    assert.ok(state.account.width>100);assert.ok(state.apps.x>=state.account.x+state.account.width);
    await move("apps");state=await capture("apps-hover");assert.equal(state.apps.yielding,false);
    const point=await move("account");
    wc.sendInputEvent({type:"mouseDown",button:"left",clickCount:1,...point});wc.sendInputEvent({type:"mouseUp",button:"left",clickCount:1,...point});
    await move("apps");state=await capture("menu-priority");assert.ok(state.account.expanded&&state.apps.yielding);
    await evaluate(`account.setAttribute('aria-expanded','false');apps.focus();document.activeElement.blur()`);
    win.focus();wc.focus();
    wc.sendInputEvent({type:"mouseMove",x:380,y:20});await settle();
    wc.sendInputEvent({type:"keyDown",keyCode:"Tab"});wc.sendInputEvent({type:"keyUp",keyCode:"Tab"});
    state=await capture("keyboard-account");assert.ok(state.account.focusVisible&&state.account.expanded,JSON.stringify(state));
    await move("apps");state=await capture("pointer-over-focus");assert.equal(state.apps.yielding,false);
    wc.sendInputEvent({type:"mouseMove",x:380,y:20});await evaluate(`document.activeElement.blur()`);
    state=await capture("returned-default");assert.equal(state.account.expanded,false);
    await evaluate(`adapter.setLayout('iconsOnly')`);
    state=await capture("connected-threshold-rest");assert.ok(state.account.width>100);assert.equal(state.apps.folded,"logos");
    await move("apps");state=await capture("connected-threshold-hover");assert.ok(state.apps.expanded);assert.ok(state.apps.width>150);
    wc.sendInputEvent({type:"mouseMove",x:380,y:20});
    await evaluate(`adapter.setLayout('labeled')`);
    await evaluate(`document.querySelector('.sand-shell').setAttribute('data-sidebar-collapsed','');adapter.sync()`);
    state=await capture("collapsed");assert.equal(state.account.expanded,false);
    await evaluate(`document.querySelector('.sand-shell').removeAttribute('data-sidebar-collapsed');adapter.sync();document.querySelector('.sand-plugins-dock-logos').replaceChildren()`);
    await move("account");state=await capture("empty-catalog");assert.equal(state.apps.folded,"icon");
    await evaluate(`document.querySelector('aside').style.width='240px'`);
    state=await capture("narrow");assert.ok(state.apps.x+state.apps.width<=240);
    fs.writeFileSync(path.join(out,"browser-verdict.json"),JSON.stringify({passed:true,scenarios:results.map(r=>r.name)},null,2));
    console.log("PASS Chromium footer scenarios",results.length);
    app.exit(0);
  }catch(error){console.error(error);fs.writeFileSync(path.join(out,"browser-verdict.json"),JSON.stringify({passed:false,error:String(error)},null,2));app.exit(1);}
});
