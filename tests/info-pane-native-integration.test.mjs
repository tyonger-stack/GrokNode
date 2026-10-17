import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as compiler from "react/compiler-runtime";
import { parse } from "acorn";
import { Window } from "happy-dom";
import { build } from "esbuild";
import { patchNativeInfoPaneTabs, buildInfoPaneTabsRendererExtension } from "../scripts/lib/info-pane-tabs-renderer-extension.mjs";
const repo = path.resolve(import.meta.dirname, "..");
const baseline = path.join(repo, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const skip = existsSync(baseline) ? false : "pinned renderer not hydrated";
function extract(source, names) {
  return parse(source, {ecmaVersion:"latest",sourceType:"module"}).body.filter(n=>n.type==="FunctionDeclaration"&&names.includes(n.id?.name)).map(n=>source.slice(n.start,n.end)).join("\n");
}
test("native p3n mounts original settings with shared overview and preserves nodes across tabs/gear", {skip}, async () => {
  const window = new Window();
  const saved = new Map();
  for (const name of ["window","document","HTMLElement","Element","Node","CustomEvent","IS_REACT_ACT_ENVIRONMENT"]) {
    saved.set(name, globalThis[name]);
    globalThis[name] = name === "window" ? window : name === "IS_REACT_ACT_ENVIRONMENT" ? true : window[name];
  }
  let root;
  try {
    const {createRoot} = await import("react-dom/client");
    const original = await readFile(baseline,"utf8");
    const patched = patchNativeInfoPaneTabs(original);
    const changes = [];
    const re = (...v) => v.filter(x=>typeof x==="string").join(" ");
    const services = {
      p:jsx,S:React,he:compiler,window,CustomEvent:window.CustomEvent,
      mmt:()=>false,Elt:()=>[],cct:()=>false,Dtt:()=>({status:"ready"}),c2:()=>[],pin:(_sections,view)=>view,
      RUe:()=>0,g3n:()=>{},Cr:fn=>React.useEffect(fn),Cmt:()=>false,W2n:()=>false,re,
      Ar:({children,className})=>jsx.jsx("div",{className,children}),
      Nmt:({onOpenSettings})=>jsx.jsx("header",{className:"sand-info-pane__top sand-78zum5",children:jsx.jsx("button",{onClick:onOpenSettings,"aria-label":"Agent settings",children:"Settings"})}),
      K2n:()=>jsx.jsx("ul",{className:"sand-routine__list",children:jsx.jsx("li",{children:"Routine"})}),
      Qe:()=>({roster:{setAgentNotifyOnUpdates:(...args)=>changes.push(["notify",...args])}}),
      lr:run=>({run,isPending:false}),YCe:()=>true,
      f3n:()=>jsx.jsx("button",{"aria-label":"Edit avatar",children:"Avatar"}),
      Uwe:props=>jsx.jsx("div",{children:jsx.jsx(props.isMultiline?"textarea":"input",{"aria-label":props.ariaLabel,defaultValue:props.initialValue,placeholder:props.placeholder,onChange:e=>props.onCommit(e.target.value)})}),
      Fe:()=>({className:"sand-78zum5"}),vt:({children})=>jsx.jsx("span",{children}),
      Hlt:({isChecked,onToggle})=>jsx.jsx("button",{"aria-label":"Notifications",onClick:()=>onToggle(!isChecked),children:"Notify"}),
    };
    const native = vm.runInNewContext(extract(patched,["p3n","h3n"])+"\n({Pane:p3n,Settings:h3n})",services);
    services.h3n = props=>jsx.jsxs(React.Fragment,{children:[jsx.jsx(native.Settings,props),jsx.jsx("div",{className:"sand-agent-settings__card sand-78zum5","data-r-agent-model":"true",children:"Model"})]});
    const pane = document.createElement("div");pane.className="sand-info-pane__inner";document.body.append(pane);
    const style = document.createElement("style");style.textContent='.sand-78zum5:not(#\\#):not(#\\#):not(#\\#){display:flex}';document.head.append(style);
    root=createRoot(pane);
    await React.act(async()=>root.render(jsx.jsx(native.Pane,{
      // title:"" keeps YCe true (official o6) so the hero "Add a label" control mounts
      agent:{id:"A",name:"Bot A",title:"",description:"Description",notifyOnUpdatesEnabled:false},
      channelsView:{manifests:[],connections:[]},sectionRequest:null,onSectionRequestHandled:()=>{},onViewChange:()=>{},
      onDescriptionChange:v=>changes.push(["description",v]),onNameChange:()=>{},onTitleChange:v=>changes.push(["title",v]),
      computerPreview:jsx.jsx("div",{className:"sand-computer-preview__frame",children:jsx.jsx("div",{className:"sand-box-vnc-pool"})}),
    })));
    const settings = pane.querySelector(".sand-agent-settings"),pool=pane.querySelector(".sand-box-vnc-pool");
    assert.ok(settings);assert.ok(pool);
    assert.ok(pane.querySelector("[data-r-info-pane-hero]"));
    const heroTitle = pane.querySelector('[data-r-info-pane-hero] [aria-label="Agent title"]');
    assert.ok(heroTitle, "empty title must still render the Add a label control");
    assert.equal(heroTitle.getAttribute("placeholder") ?? heroTitle.placeholder, "Add a label");
    const library = document.createElement("section");library.className="sand-agent-library sand-78zum5";library.textContent="Library";
    const routines = pane.querySelector("ul.sand-routine__list").parentElement;
    routines.insertAdjacentElement("afterend",library);
    window.eval(await buildInfoPaneTabsRendererExtension());window.__sandInfoPaneTabsSync();
    const visible = node => ![node,...ancestors(node)].some(el=>window.getComputedStyle(el).display==="none");
    for(const tab of ["details","library","computer","other"]){
      pane.querySelector('[data-r-tab="'+tab+'"]').click();
      assert.ok(visible(pane.querySelector(".sand-info-pane__nav-root")));
      assert.ok(visible(pane.querySelector("header")));
      assert.equal(visible(library),tab==="library");assert.equal(visible(pool),tab==="computer");
      assert.equal(visible(pane.querySelector('[aria-label="Agent description"]')),tab==="other");
      assert.equal(visible(pane.querySelector('[data-r-agent-model]')),tab==="other");
      assert.ok(visible(pane.querySelector('[data-r-info-pane-hero] [aria-label="Agent name"]')));
      assert.ok(visible(pane.querySelector('[data-r-info-pane-hero] [aria-label="Agent title"]')));
      assert.equal(visible(pane.querySelector('.sand-agent-settings [aria-label="Agent name"]')),false);
      assert.equal(visible(pane.querySelector('.sand-agent-settings [aria-label="Agent title"]')),false);
      assert.equal(pane.querySelector(".sand-agent-settings"),settings);assert.equal(pane.querySelector(".sand-box-vnc-pool"),pool);
    }
    pane.querySelector('[data-r-tab="details"]').click();
    await React.act(async()=>pane.querySelector('[aria-label="Agent settings"]').click());
    assert.equal(pane.getAttribute("data-r-tabs-tab"),"other");assert.equal(pane.querySelector(".sand-agent-settings"),settings);assert.equal(pane.querySelector(".sand-box-vnc-pool"),pool);
    await React.act(async()=>pane.querySelector('[aria-label="Notifications"]').click());
    assert.deepEqual(changes,[["notify","A",true]]);
    window.__sandInfoPaneTabsStop();
  } finally {
    if(root)await React.act(async()=>root.unmount());window.close();
    for(const [name,value]of saved){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}
  }
});
function ancestors(node){const result=[];for(let parent=node.parentElement;parent;parent=parent.parentElement)result.push(parent);return result;}
