import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { parse } from "acorn";
import postcss from "postcss";
import { patchAccountFooter0753 } from "../scripts/lib/account-footer-0753-patch.mjs";
import { jGe, nWe, deriveEngagement, surface } from "../frontend/src/extensions/account-footer-0753/official.js";
import { connectedLayout, countConnectedApps, Wae } from "../frontend/src/extensions/account-footer-0753/connected-apps.js";

const base = new URL("../frontend/src/extensions/account-footer-0753/", import.meta.url);
const upstream = readFileSync(new URL("upstream/footer-original-0753.js", base), "utf8");
const port = readFileSync(new URL("official.js", base), "utf8");
const evidence = new URL("../.omo/evidence/account-footer-0753/", import.meta.url);
mkdirSync(evidence, {recursive: true});
const sha = value => createHash("sha256").update(value).digest("hex");

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "footer did not converge to the expected state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function mountDock(mcp) {
  const window = new Window({settings:{enableJavaScriptEvaluation:true}});
  const doc = window.document;
  doc.body.innerHTML = `<div class="sand-shell"><aside class="sand-agents-sidebar"><div class="sand-agents-sidebar__rail-new"></div><div class="sand-footer-0753"><div class="sand-agents-sidebar__footer"><div class="sand-agents-sidebar__account"><button aria-expanded="false"><span class="sand-kit-base-avatar">L</span><span>Local</span></button></div></div><div class="sand-agents-sidebar__plugins-entry"><button class="sand-agents-sidebar__plugins"><span><i data-icon-name="plug"></i></span><span>Plugins</span></button></div></div></aside></div>`;
  window.desktop = {mcp};
  const polls = [];
  window.setInterval = callback => {polls.push(callback); return polls.length;};
  window.clearInterval = () => {};
  const bundle = await build({entryPoints:[new URL("../plugins-dock-entry.ts",base).pathname],bundle:true,write:false,format:"iife"});
  window.eval(bundle.outputFiles[0].text);
  if (doc.readyState === "loading") doc.dispatchEvent(new window.Event("DOMContentLoaded"));
  return {window,doc,polls,apps:()=>doc.querySelector(".sand-agents-sidebar__plugins")};
}

test("transplanted pseudo-elements stay outside functional selector arguments", () => {
  const text = readFileSync(new URL("official-css.ts",base),"utf8");
  const copied = JSON.parse(text.slice(text.indexOf("=")+1).trim().replace(/;$/,""));
  const invalid = [];
  postcss.parse(copied).walkRules(rule => {
    if (rule.selector.startsWith(".sand-footer-0753 :is(") && rule.selector.endsWith(")") && /:{1,2}(?:before|after)\b/.test(rule.selector)) invalid.push(rule.selector);
  });
  assert.deepEqual(invalid, [], "pseudo-elements cannot match inside :is()");
});

test("an individually replaced target cannot inherit pointer engagement", async () => {
  const fixture = await mountDock({list:async()=>({servers:[]}),catalog:async()=>[],effectivePlugins:async()=>[]});
  try {
    const account = fixture.doc.querySelector(".sand-agents-sidebar__account > button");
    account.dispatchEvent(new fixture.window.Event("pointerenter"));
    assert.equal(account.getAttribute("data-expanded"),"true");
    const replacement = account.cloneNode(true);
    account.replaceWith(replacement);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(replacement.hasAttribute("data-expanded"),false);
    assert.equal(fixture.apps().hasAttribute("data-yielding"),false);
  } finally {fixture.window.dispatchEvent(new fixture.window.Event("beforeunload")); await fixture.window.happyDOM.close();}
});

test("real bridge lifecycle refreshes both threshold directions and ignores stale snapshots", async () => {
  const four = [0,1,2,3].map(i=>({id:String(i),name:String(i),rowServerIdentifier:String(i),status:"connected"}));
  let servers = four;
  let authListener;
  let nextList;
  let calls = 0;
  const fixture = await mountDock({list:()=>{calls++; const next=nextList;nextList=undefined;return next??Promise.resolve({servers});},catalog:async()=>[],effectivePlugins:async()=>[],onAuthCompleted:listener=>{authListener=listener;return()=>{authListener=undefined;};}});
  try {
    await until(() => fixture.apps()?.hasAttribute("data-icons-only"));
    assert.equal(typeof authListener,"function","authentication completion must have a real bridge subscriber");
    servers = [];
    authListener({});
    await until(() => !fixture.apps().hasAttribute("data-icons-only"));
    servers = four;
    authListener({});
    await until(() => fixture.apps().hasAttribute("data-icons-only"));
    assert.ok(fixture.polls.length > 0,"status changes without auth events need a refresh clock");
    servers = [];
    fixture.polls[0]();
    await until(() => !fixture.apps().hasAttribute("data-icons-only"));
    const states = [];
    fixture.doc.querySelector(".sand-agents-sidebar__account > button").dispatchEvent(new fixture.window.Event("pointerenter"));
    const activeClasses = fixture.apps().className;
    const observer = new fixture.window.MutationObserver(() => states.push(fixture.apps().hasAttribute("data-icons-only")));
    observer.observe(fixture.apps(),{attributes:true,attributeFilter:["data-icons-only"]});
    let release;
    nextList = new Promise(resolve => {release=resolve;});
    const before = calls;
    authListener({});
    await until(() => calls > before);
    assert.equal(fixture.apps().className,activeClasses,"waiting for the bridge must preserve the active surface");
    authListener({});
    release({servers:four});
    await until(() => calls > before+1);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(fixture.apps().hasAttribute("data-icons-only"),false);
    assert.equal(states.includes(true),false,"a superseded response must not flash the stale layout");
    observer.disconnect();
  } finally {fixture.window.dispatchEvent(new fixture.window.Event("beforeunload")); await fixture.window.happyDOM.close();}
});

test("collapsed rail is inserted once before the shared footer and removed on expansion", async () => {
  const fixture = await mountDock({list:async()=>({servers:[]}),catalog:async()=>[],effectivePlugins:async()=>[]});
  try {
    const shell = fixture.doc.querySelector(".sand-shell");
    const sidebar = fixture.doc.querySelector("aside");
    const row = fixture.doc.querySelector(".sand-footer-0753");
    const railButtons = () => sidebar.querySelectorAll(':scope > div > button[aria-label="连接应用"]');
    shell.setAttribute("data-sidebar-collapsed","");
    await until(() => railButtons().length === 1);
    assert.equal(railButtons()[0].parentElement.nextElementSibling,row);
    shell.setAttribute("data-sidebar-collapsed","");
    await new Promise(resolve => setTimeout(resolve,10));
    assert.equal(railButtons().length,1);
    shell.removeAttribute("data-sidebar-collapsed");
    await new Promise(resolve => setTimeout(resolve,25));
    assert.equal(railButtons().length,0);
  } finally {fixture.window.dispatchEvent(new fixture.window.Event("beforeunload")); await fixture.window.happyDOM.close();}
});
const assetsRoot = process.env.GROK_NODE_018_RENDERER_ASSETS ?? new URL("../src/app/dist/renderer/assets/", import.meta.url).pathname;
const pinnedChunk = await readFile(path.join(assetsRoot, "index-UbX-y3il.js"), "utf8").catch(() => null);
const bundleSkip = pinnedChunk == null
  ? "src/app/dist is gitignored; bootstrap or set GROK_NODE_018_RENDERER_ASSETS for the full pinned-chunk assertion"
  : false;

test("pinned official statements are literal and provenance hashes match", () => {
  const provenance = JSON.parse(readFileSync(new URL("upstream/provenance.json", base), "utf8"));
  for (const name of ["footer-original-0753.js", "footer-imports-0753.js", "source-identity.json"]) {
    assert.equal(sha(readFileSync(new URL(`upstream/${name}`, base))), provenance.fixtureSha256[name]);
  }
  for (const prefix of ["function jGe(", "function nWe(", "function eGe(", "var Nk="]) {
    assert.ok(port.includes(upstream.split("\n").find(line => line.startsWith(prefix))), prefix);
  }
  const mge = upstream.split("\n").find(line => line.startsWith("function MGe("));
  assert.ok(mge.includes("let R=I&&g?`account`:f??m,z=I&&F===`iconsOnly`&&R==null"));
  assert.ok(port.includes("let R=I&&g?`account`:f??m,z=I&&F===`iconsOnly`&&R==null"));
  writeFileSync(new URL("literal-equivalence.json", evidence), JSON.stringify({passed: true,upstreamSha256:sha(upstream),portSha256:sha(port),statements:["jGe","nWe","eGe","Nk","MGe priority"]}, null, 2));
});

test("official transition handles every target, stale leave, and count boundary", () => {
  const oracle = vm.runInNewContext(`(${upstream.split("\n").find(l => l.startsWith("function jGe("))})`);
  const cases = [];
  for (const prior of [null, "account", "connect", "update"]) for (const target of ["account", "connect", "update"]) for (const engaged of [true, false]) {
    const actual = jGe(prior,target,engaged);
    assert.equal(actual, oracle(prior,target,engaged));
    cases.push({prior,target,engaged,actual});
  }
  assert.equal(nWe(undefined,4),"labeled");
  assert.equal(nWe(3,4),"labeled");
  assert.equal(nWe(4,4),"iconsOnly");
  writeFileSync(new URL("transition-matrix.json", evidence), JSON.stringify(cases,null,2));
});

test("connected counter is literal upstream code and counts connected items, not logos or configured rows", () => {
  const source=readFileSync(new URL("upstream/chunk-plugins-effective-De7yeIfR.js",base),"utf8");
  const implementation=readFileSync(new URL("connected-apps.js",base),"utf8");
  for(const node of parse(source,{ecmaVersion:"latest",sourceType:"module"}).body){
    if(node.type==="FunctionDeclaration"&&["l","u","f","p","m","h","g","_","v","y","b"].includes(node.id.name))assert.ok(implementation.includes(source.slice(node.start,node.end)),node.id.name);
  }
  const server=(id,extra={})=>({id,name:id,rowServerIdentifier:id,status:"connected",...extra});
  const snapshot={servers:[server("a"),server("b"),server("c"),server("d")],catalog:[],effectivePlugins:[]};
  assert.equal(countConnectedApps(snapshot),4);
  assert.equal(connectedLayout(snapshot),"iconsOnly");
  assert.equal(connectedLayout({...snapshot,servers:snapshot.servers.map((s,i)=>i===0?{...s,status:"needsAuth"}:s)}),"labeled");
  for(const input of [undefined,{}, {...snapshot,effectivePlugins:undefined}, {...snapshot,servers:[{}]}])assert.equal(connectedLayout(input),"labeled");
  for(const config of [undefined,{}, {min_connected_apps:0},{min_connected_apps:-1},{min_connected_apps:2.5},{min_connected_apps:"3"}])assert.equal(Wae(config),4);
  assert.equal(Wae({min_connected_apps:2}),2);
  assert.equal(connectedLayout(snapshot,{min_connected_apps:5}),"labeled");
  const catalog=[{id:"p",name:"Alpha",displayName:"Alpha"}];
  const duplicate={servers:[server("user",{name:"Alpha",pluginId:"p"}),server("twin",{name:"Alpha",pluginId:"p",servedBy:"grok"}),server("second-account",{name:"Alpha",pluginId:"p"})],catalog,effectivePlugins:[]};
  assert.equal(countConnectedApps(duplicate),1);
  assert.equal(countConnectedApps({...duplicate,servers:[...duplicate.servers,server("second-connector",{name:"Other connector",pluginId:"p"})]}),2);
  const sharepoint={servers:[server("sharepoint",{servedBy:"grok"})],catalog:[],effectivePlugins:[]};
  assert.equal(countConnectedApps(sharepoint),0);
  assert.equal(countConnectedApps({...sharepoint,effectivePlugins:[{pluginId:"sp",name:"sharepoint",isEnabled:true}]}),1);
  writeFileSync(new URL("connected-counter.json",evidence),JSON.stringify({passed:true,readyFour:countConnectedApps(snapshot),duplicateAccountsAndTwin:countConnectedApps(duplicate),unavailable:"labeled",threshold:Wae(),sharepointRequiresEffectiveInstall:true},null,2));
});

test("every transplanted CSS declaration is from the pinned official stylesheet", () => {
  const original=readFileSync(new URL("upstream/footer-rules-original.css",base),"utf8");
  const provenance=JSON.parse(readFileSync(new URL("upstream/provenance.json",base),"utf8"));
  assert.equal(sha(original),provenance.originalRulesSha256);
  const text=readFileSync(new URL("official-css.ts",base),"utf8");
  const copied=JSON.parse(text.slice(text.indexOf("=")+1).trim().replace(/;$/,""));
  const originals=new Map();
  const declarations=rule=>rule.nodes.map(n=>n.toString()).join(";");
  postcss.parse(original).walkRules(rule=>{
    const values=originals.get(rule.selector)??new Set();values.add(declarations(rule));originals.set(rule.selector,values);
  });
  let rules=0;
  postcss.parse(copied).walkRules(rule=>{
    const prefix=".sand-footer-0753 ";
    const selector=rule.selector.startsWith(prefix+":is(")
      ? rule.selector.slice((prefix+":is(").length,-1)
      : rule.selectors.map(part=>{assert.ok(part.startsWith(prefix));return part.slice(prefix.length);}).join(",");
    assert.ok(originals.get(selector)?.has(declarations(rule)),selector);
    rules++;
  });
  assert.ok(rules>100);
  writeFileSync(new URL("css-equivalence.json",evidence),JSON.stringify({passed:true,rules,originalSha256:sha(original),transplantSha256:sha(copied)},null,2));
});

test("menu beats pointer, pointer beats keyboard, removed update cannot hold engagement", () => {
  const inputs = {pointer:"connect",focus:"account",menuOpen:true,accountAvailable:true,updateAvailable:false,layout:"labeled"};
  assert.equal(deriveEngagement(inputs).engaged,"account");
  assert.equal(deriveEngagement({...inputs,menuOpen:false}).engaged,"connect");
  assert.equal(deriveEngagement({...inputs,menuOpen:false,pointer:null}).engaged,"account");
  assert.equal(deriveEngagement({...inputs,menuOpen:false,pointer:"update",focus:null}).engaged,null);
  const cases=[];
  for (const logoCount of [0,1,2,3]) for (const layout of ["labeled","iconsOnly"]) for (const isYielding of [true,false]) for (const isEngaged of [true,false]) for (const isCrowded of [true,false]) {
    const view=surface({logoCount,layout,isYielding,isEngaged,isCrowded});
    assert.equal(!!view["data-yielding"],isYielding);
    assert.equal(!!view["data-expanded"],!isYielding&&layout==="iconsOnly"&&isEngaged);
    if(isYielding) assert.equal(view["data-folded"],logoCount===3&&!isCrowded?"logos":"icon");
    cases.push({logoCount,layout,isYielding,isEngaged,isCrowded,classes:view.className,folded:view["data-folded"]??null});
  }
  writeFileSync(new URL("surface-matrix.json",evidence),JSON.stringify(cases,null,2));
});

test("adapter preserves original actions through menu priority, collapse, catalog change and remount", async () => {
  const bundle=await build({entryPoints:[new URL("adapter.ts",base).pathname],bundle:true,write:false,format:"iife",globalName:"Footer0753"});
  const window=new Window({settings:{enableJavaScriptEvaluation:true}});
  const doc=window.document;
  const fixture=`<div class="sand-shell"><aside class="sand-agents-sidebar"><div class="sand-footer-0753"><div class="sand-agents-sidebar__footer"><div class="sand-agents-sidebar__account"><button aria-expanded="false"><span class="sand-kit-base-avatar">L</span><span><span>Local</span></span></button></div></div><div class="sand-agents-sidebar__plugins-entry"><button class="sand-agents-sidebar__plugins sand-plugins-dock"><span class="sand-plugins-dock-icon"><i data-icon-name="plug"></i></span><span class="sand-plugins-dock-label">Connect Apps</span><span class="sand-plugins-dock-logos"><span><img><img><img></span></span></button></div></div></aside></div>`;
  doc.body.innerHTML=fixture;
  const api=window.eval(bundle.outputFiles[0].text+";Footer0753");
  const adapter=api.installFooterAdapter(doc);
  const account=doc.querySelector(".sand-agents-sidebar__account > button");
  const apps=doc.querySelector(".sand-agents-sidebar__plugins");
  apps.classList.add("sand-late-owner-hook");
  adapter.sync();
  assert.equal(apps.classList.contains("sand-late-owner-hook"),true,"later semantic hooks belong to the existing action owner");
  let accountClicks=0,appClicks=0;
  account.addEventListener("click",()=>{accountClicks++;account.setAttribute("aria-expanded","true");});
  apps.addEventListener("click",()=>appClicks++);
  const enter=el=>el.dispatchEvent(new window.Event("pointerenter"));
  const leave=el=>el.dispatchEvent(new window.Event("pointerleave"));
  enter(account);
  assert.equal(account.getAttribute("data-expanded"),"true");
  assert.equal(apps.getAttribute("data-folded"),"logos");
  enter(apps);leave(account);
  assert.equal(apps.hasAttribute("data-yielding"),false);
  account.click();adapter.sync();
  assert.equal(apps.getAttribute("data-yielding"),"true");
  account.setAttribute("aria-expanded","false");leave(apps);adapter.sync();
  assert.equal(account.hasAttribute("data-expanded"),false);
  apps.click();assert.equal(appClicks,1);assert.equal(accountClicks,1);
  enter(account);apps.querySelector(".sand-plugins-dock-logos").replaceChildren();adapter.sync();
  assert.equal(apps.getAttribute("data-folded"),"icon");
  assert.equal(apps.querySelector("i").getAttribute("data-icon-name"),"grid-plus");
  doc.querySelector(".sand-shell").setAttribute("data-sidebar-collapsed","");
  account.className="react-collapsed-class";
  adapter.sync();
  assert.equal(account.className,"react-collapsed-class");
  assert.equal(account.hasAttribute("data-sidebar-account-pill"),false);
  doc.querySelector(".sand-shell").removeAttribute("data-sidebar-collapsed");adapter.sync();
  assert.equal(account.hasAttribute("data-expanded"),false);
  assert.equal(doc.querySelector(".sand-agents-sidebar__account > button"),account);
  adapter.setLayout(connectedLayout({servers:[0,1,2,3].map(i=>({id:String(i),name:String(i),rowServerIdentifier:String(i),status:"connected"})),catalog:[],effectivePlugins:[]}));
  assert.equal(account.getAttribute("data-name-at-rest"),"true");
  assert.equal(apps.getAttribute("data-icons-only"),"true");
  enter(apps);assert.equal(apps.getAttribute("data-expanded"),"true");
  leave(apps);assert.equal(apps.hasAttribute("data-expanded"),false);
  adapter.setLayout(connectedLayout(undefined));
  assert.equal(account.hasAttribute("data-name-at-rest"),false);
  const update=doc.createElement("span");
  update.innerHTML="<button>Install update</button>";
  account.parentElement.append(update);adapter.sync();enter(update);
  assert.equal(doc.querySelector(".sand-footer-0753").getAttribute("data-action-engaged"),"true");
  assert.equal(apps.getAttribute("data-folded"),"icon");
  account.setAttribute("aria-expanded","true");adapter.sync();
  assert.equal(account.getAttribute("data-expanded"),"true");
  assert.equal(doc.querySelector(".sand-footer-0753").hasAttribute("data-action-engaged"),false);
  account.setAttribute("aria-expanded","false");update.remove();adapter.sync();
  assert.equal(doc.querySelector(".sand-footer-0753").hasAttribute("data-action-engaged"),false);
  assert.equal(apps.hasAttribute("data-yielding"),false);
  const before=doc.body.innerHTML;
  doc.body.innerHTML=fixture;adapter.sync();enter(doc.querySelector(".sand-agents-sidebar__account > button"));
  assert.equal(doc.querySelector(".sand-agents-sidebar__plugins").getAttribute("data-folded"),"logos");
  writeFileSync(new URL("adapter-dom.html",evidence),before+"\n<!-- remount -->\n"+doc.body.innerHTML);
  adapter.dispose();await window.happyDOM.close();
});

test("pinned main boundary is unique, fail closed, and parses after the patch", {skip:bundleSkip}, () => {
  const baseline=pinnedChunk;
  assert.equal(sha(baseline),"ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa");
  const patched=patchAccountFooter0753(baseline);
  parse(patched,{ecmaVersion:"latest",sourceType:"module"});
  assert.throws(()=>patchAccountFooter0753(patched),/exactly one/);
  assert.throws(()=>patchAccountFooter0753(baseline+baseline),/exactly one/);
  assert.throws(()=>patchAccountFooter0753(baseline.replace('ys=Hn?null:p.jsx(s0n,{onOpenPlugins:ae})','missing')),/exactly one/);
  writeFileSync(new URL("patched-main.js",evidence),patched);
  writeFileSync(new URL("boundary.json",evidence),JSON.stringify({before:sha(baseline),after:sha(patched),parse:true,missingRejected:true,duplicateRejected:true,doublePatchRejected:true},null,2));
});
