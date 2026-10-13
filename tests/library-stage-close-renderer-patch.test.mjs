import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { createHash } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import { patchOriginalLibraryStageClose } from "../scripts/lib/library-stage-close-renderer-patch.mjs";

const root = path.resolve(import.meta.dirname,"..");
const source = await fs.readFile(path.join(root,"src/app/dist/renderer/assets/index-UbX-y3il.js"),"utf8");
const css = await fs.readFile(path.join(root,"frontend/src/extensions/library-stage-close.css"),"utf8");
const patched = patchOriginalLibraryStageClose(source,css);
const tree = parse(patched,{sourceType:"module",ecmaVersion:"latest"});

test("only shared viewer close and new component change the pinned renderer",()=>{
  const original = patched.split("\n/* sand-library-stage-close */")[0].replace('p.jsx(RLibraryStageClose,{"aria-label":"Close preview",onClick:d})','p.jsx(fr,{"aria-label":"Close preview",icon:"close",onClick:d,shape:"square",size:"sm",variant:"ghost"})');
  assert.equal(createHash("sha256").update(original).digest("hex"),createHash("sha256").update(source).digest("hex"));
});

test("production component retains close callback, icon and native tooltip",()=>{
  const fn = tree.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="RLibraryStageClose");
  const callback=()=>{};
  const ctx={p:{jsx:(type,props)=>({type,props})},RLocT:(en,zh)=>zh};
  vm.runInNewContext(patched.slice(fn.start,fn.end),ctx);
  const out=ctx.RLibraryStageClose({"aria-label":"Close preview",onClick:callback});
  assert.equal(out.props.onClick,callback);
  assert.equal(out.props.title,"关闭");
  assert.equal(out.props["data-stage-resting-focus"],"");
  assert.equal(out.props.children.props.children,String.fromCodePoint(0xed82));
  assert.equal(out.props.children.props.style.fontSize,16);
  assert.equal(out.props.className,"sand-library-stage-icon-button");
});

test("missing or duplicate close anchor cannot silently patch",()=>{
  assert.throws(()=>patchOriginalLibraryStageClose(patched,css),/already/);
  assert.throws(()=>patchOriginalLibraryStageClose("function lkn(){return null}",css),/missing/);
  const anchor='p.jsx(fr,{"aria-label":"Close preview",icon:"close",onClick:d,shape:"square",size:"sm",variant:"ghost"})';
  assert.throws(()=>patchOriginalLibraryStageClose(source.replace(anchor,anchor+","+anchor),css),/ambiguous/);
});
