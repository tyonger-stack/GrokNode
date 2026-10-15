import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import {Window} from "happy-dom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import {parse} from "acorn";
import {existsSync} from "node:fs";
import {patchShapePicker,OFFICIAL_SHAPES} from "../scripts/lib/shape-picker-patch.mjs";
import {createOfficialAvatarEngine} from "../scripts/lib/computer-sleep-official/avatar-engine.mjs";
const repo=path.resolve(import.meta.dirname,"..");
const baseline=path.join(repo,"src/app/dist/renderer/assets/index-UbX-y3il.js");
test("actual replacement avatar retains spin/bounce/burst refs for every shape",{skip:existsSync(baseline)?false:"bundle not hydrated"},async()=>{
  const window=new Window(),saved=new Map(),frames=new Map();let seq=0;
  const env={window,document:window.document,HTMLElement:window.HTMLElement,Element:window.Element,Node:window.Node,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:fn=>{frames.set(++seq,fn);return seq},cancelAnimationFrame:id=>frames.delete(id)};
  for(const [key,value]of Object.entries(env)){saved.set(key,globalThis[key]);globalThis[key]=value;}
  let root;
  try{
    const {createRoot}=await import("react-dom/client");
    const original=await readFile(baseline,"utf8"),engine=await readFile(path.join(repo,"scripts/lib/computer-sleep-official/avatar-engine.mjs"),"utf8");
    const source=patchShapePicker(original,"",engine).text;
    const code=parse(source,{ecmaVersion:"latest",sourceType:"module"}).body.filter(n=>n.type==="FunctionDeclaration"&&["RCompOfficialAvatarEngine","RCompOfficialAvatarView"].includes(n.id?.name)).map(n=>source.slice(n.start,n.end)).join("\n");
    const View=vm.runInNewContext(code+"\nRCompOfficialAvatarView",{S:React,p:jsx,createOfficialAvatarEngine,PQ:[{id:"blue",value:"#1084FE"}]});
    const container=document.createElement("div");document.body.append(container);root=createRoot(container);
    for(const shape of OFFICIAL_SHAPES){
      const ref=React.createRef();
      await React.act(async()=>root.render(jsx.jsx(View,{shape,color:"blue",size:36,state:"idle",ref})));
      assert.ok(container.querySelector("svg path"),shape);
      for(const method of ["spin","bounce","burst"])assert.equal(typeof ref.current[method],"function");
      await React.act(async()=>{
        ref.current.spin(2);ref.current.bounce();ref.current.burst();
        for(const [id,callback]of [...frames]){frames.delete(id);callback(performance.now()+40);}
      });
      assert.ok(container.querySelector("svg path"),shape);
    }
  }finally{
    if(root)await React.act(async()=>root.unmount());window.close();
    for(const [key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
  }
});
