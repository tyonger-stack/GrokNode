import assert from "node:assert/strict";
import {readFile,mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {existsSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import {Window} from "happy-dom";
import {parse} from "acorn";
import {AVATAR_PICKER_CSS,OFFICIAL_SHAPES,patchShapePicker,applyShapePickerPatch,officialPicker} from "../scripts/lib/shape-picker-patch.mjs";
import {createOfficialAvatarEngine} from "../scripts/lib/computer-sleep-official/avatar-engine.mjs";
import {patchMainAgentRenderer} from "../scripts/lib/main-agent-renderer-patch.mjs";
const repo=path.resolve(import.meta.dirname,".."),artifact=path.join(repo,"scripts/lib/computer-sleep-official");
const baseline=path.join(repo,"src/app/dist/renderer/assets/index-UbX-y3il.js");
const skip=existsSync(baseline)?false:"pinned bundle not hydrated";
const engine=createOfficialAvatarEngine(React,jsx);
const states=JSON.parse(await readFile(path.join(artifact,"avatar-states.json"),"utf8"));
test("13 distinct official outlines, intact SVG references for every state",async()=>{
 assert.equal(new Set(OFFICIAL_SHAPES.map(shape=>engine.outline({body:engine.body(shape),size:36}))).size,13);
 const window=new Window();
 try{
 for(const state of ["idle","sleeping","waking"])for(const shape of OFFICIAL_SHAPES){
  window.document.body.innerHTML=states[state][shape];
  const svg=window.document.querySelector("svg");assert.ok(svg);
  const ids=[...svg.querySelectorAll("[id]")].map(el=>el.id);assert.equal(new Set(ids).size,ids.length);
  for(const node of svg.querySelectorAll("*"))for(const attribute of node.attributes){
   const refs=[...attribute.value.matchAll(/url\(#([^\)]+)\)/g)].map(m=>m[1]);
   if(attribute.name==="href"&&attribute.value.startsWith("#"))refs.push(attribute.value.slice(1));
   for(const ref of refs)assert.ok(ids.includes(ref),state+" "+shape+" "+ref);
  }
  assert.notEqual(states.idle[shape],states.sleeping[shape]);assert.notEqual(states.waking[shape],states.sleeping[shape]);
  assert.equal((await readFile(path.join(artifact,"shapes",shape+".svg"),"utf8")).trim(),states.idle[shape]);
 }
 }finally{window.close()}
});
test("original engine selects exact bodies and sleepy/surprised expressions",()=>{
 for(const shape of OFFICIAL_SHAPES)for(const [state,face] of [["sleeping","sleepy"],["waking","surprised"]]){
  const mark=engine.create({body:engine.body(shape)});
  engine.state(mark,state,{isResting:true,isCompact:true,seed:1});
  for(let at=0;at<240;at++)mark.advance(1/120);
  assert.equal(mark.frame().body,engine.body(shape));assert.equal(mark.face,face);assert.equal(mark.isPlaying,false);
 }
});
test("actual picker: 5+5+3, exact commits, staged selection and tooltips",()=>{
 const colors=[{id:"black",label:"Black",value:"#000"},{id:"blue",label:"Blue",value:"#1084FE"},{id:"green",label:"Green",value:"#00C972"}],calls=[];
 const picker=vm.runInNewContext("("+officialPicker.toString()+")",{
 p:jsx,Ij:OFFICIAL_SHAPES,PQ:colors,Cee:a=>a.avatarColor??"blue",Eee:a=>a.avatarShape??"blob",
 RCompAvatarLabels:()=>Object.fromEntries(OFFICIAL_SHAPES.map(s=>[s,s[0].toUpperCase()+s.slice(1)])),
 sd:()=>null,MNe:()=>"#fff",RCompAvatarSuffix:kind=>" character "+kind,RCompAvatarColorLabel:c=>c.label,RCompAvatarOutline:s=>engine.outline({body:engine.body(s),size:36}),Fe:()=>({className:"color-cell"}),$we:{cell:{},colorCell:{},colorCellSelected:{}},_s:{keyboardFocus:{}}
 });
 const tree=picker({agent:{id:"A",avatarShape:"blob",avatarColor:"blue"},character:{commitCharacter:x=>calls.push(x)},staged:{avatarShape:"star",avatarColor:"green"},isCharacterActive:true});
 const [shapeGroup,colorGroup]=tree.props.children,rows=shapeGroup.props.children;
 assert.deepEqual(Array.from(rows,r=>r.props.children.length),[5,5,3]);
 const shapes=rows.flatMap(r=>r.props.children);
 assert.deepEqual(Array.from(shapes.filter(b=>b.props["aria-pressed"]),b=>b.key),["star"]);
 for(const [at,button]of shapes.entries()){
  assert.equal(button.props.title,OFFICIAL_SHAPES[at][0].toUpperCase()+OFFICIAL_SHAPES[at].slice(1));button.props.onClick();
 }
 const colorButtons=colorGroup.props.children;assert.equal(colorButtons.length,3);assert.equal(colorButtons[2].props["aria-pressed"],true);colorButtons[1].props.onClick();
 assert.deepEqual(Array.from(calls.slice(0,13),c=>c.avatarShape),OFFICIAL_SHAPES);
 assert.deepEqual({...calls[13]},{avatarColor:"blue"});
});
test("editor keeps the official popover width and six-column color rail",()=>{
 assert.match(AVATAR_PICKER_CSS,/\.sand-avatar-editor\{width:min\(calc\(min\(272px,100vw - 32px\) \+ 2\*var\(--cursor-spacing-3\)\),100vw - 32px\)!important\}/);
 assert.match(AVATAR_PICKER_CSS,/\.r-avatar-colors\{align-self:center;max-width:calc\(6\*32px \+ 5\*var\(--cursor-spacing-2\)\);flex-wrap:wrap\}/);
});
test("staged adapter resolves assets once, preserves native reset, fails closed",{skip},async()=>{
 const stage=await mkdtemp(path.join(tmpdir(),"grok-avatar-"));
 try{
 const root=path.join(stage,"dist","renderer");await mkdir(path.join(root,"assets"),{recursive:true});
 const source=await readFile(baseline,"utf8");
 await writeFile(path.join(root,"assets/index-UbX-y3il.js"),patchMainAgentRenderer(source));await writeFile(path.join(root,"assets/index-test.css"),"body{}");
 await writeFile(path.join(root,"index.html"),'<script src="./assets/index-UbX-y3il.js"></script><link href="./assets/index-test.css">');
 const provenance=await applyShapePickerPatch({stageRoot:stage});assert.deepEqual(provenance.rows,[5,5,3]);
 const patched=await readFile(path.join(root,"assets/index-UbX-y3il.js"),"utf8");parse(patched,{ecmaVersion:"latest",sourceType:"module"});
 assert.ok(patched.includes('commitCharacter({avatarShape:"",avatarColor:""})'));assert.ok(patched.includes("p.jsx(RCompOfficialAvatarView"));
 assert.throws(()=>patchShapePicker(patched,"","source"),/already applied/);
 assert.throws(()=>patchShapePicker(source.replace("function sd(n)","function sdDrift(n)"),"","source"),/functions missing/);
 assert.ok((await readFile(path.join(root,"assets/index-test.css"),"utf8")).includes(".r-avatar-shape-row"));
 }finally{await rm(stage,{recursive:true,force:true})}
});
