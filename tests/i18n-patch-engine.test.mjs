import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_LINES,
  applyAnchored,
  applyPair,
} from "../scripts/lib/i18n-patch-engine.mjs";

const NL = String.fromCharCode(10);
const BT = String.fromCharCode(96);
const DL = String.fromCharCode(36);

test("engine leaves single-quoted containers untouched (Ask-first regression)", async () => {
  const container = "'Write one short rule. " + '"Ask first"' + " takes priority.'";
  const src = "a.jsx(Le,{children:" + container + "})" + NL + "a.jsx(Le,{children:" + '"Ask first"' + "})";
  const out = applyPair(src, "Ask first", "先询问", "FULL");
  assert.equal(out.hits, 1);
  assert.ok(out.patched.includes(container), "container must stay raw");
  assert.ok(out.patched.includes('(RLocT("Ask first","先询问"))'));
});

test("engine skips backtick template text", async () => {
  const tpl = BT + "Auto-detect (" + DL + "{ze(e)})" + BT;
  const src = "f=e!=null?" + tpl + ":" + '"Auto-detect"';
  const out = applyPair(src, "Auto-detect", "自动检测", "FULL");
  assert.equal(out.hits, 1);
  assert.ok(out.patched.includes(tpl), "template must stay raw");
  assert.ok(out.patched.includes('(RLocT("Auto-detect","自动检测"))'));
});

test("engine never nests inside its own branches", async () => {
  const src = 'x({title:"Cancel"})';
  const once = applyPair(src, "Cancel", "取消", "FULL").patched;
  assert.ok(once.includes('(RLocT("Cancel","取消"))'));
  assert.throws(() => applyPair(once, "Cancel", "取消", "FULL"), /has no anchor/);
});

test("engine replaces prop, ternary, throw and expression colon shapes", async () => {
  const src = 'a({label:"Retry"}) b=s?"Retry":z c=new Error("Retry") d={k:"Retry"} e={46:"Retry"}';
  const out = applyPair(src, "Retry", "重试", "FULL");
  assert.equal(out.hits, 3);
  assert.ok(out.patched.includes('label:(RLocT("Retry","重试"))'));
  assert.ok(out.patched.includes('s?(RLocT("Retry","重试"))'));
  assert.ok(out.patched.includes('46:"Retry"'), "digit-key map must stay raw");
});

test("engine respects PROP and PROP_COLON modes", async () => {
  const src = 'x({children:"Cancel"}) y=s?"Cancel":z';
  const prop = applyPair(src, "Cancel", "取消", "PROP");
  assert.equal(prop.hits, 1);
  assert.ok(prop.patched.includes('y=s?"Cancel":z'), "ternary must stay raw in PROP mode");
  const src2 = 'd={46:"Delete"} f=x?"b":"Delete" e={created:"Re"}';
  const pc = applyPair(src2, "Delete", "删除", "PROP_COLON");
  assert.equal(pc.hits, 1);
  assert.ok(pc.patched.includes('d={46:"Delete"}'));
});

test("anchored replacement is exact-once fail-closed", async () => {
  const src = "function XGn(n){return 1} function XGn(n){return 1}";
  assert.throws(() => applyAnchored(src, "function XGn(n){return 1}", "Z"), /ambiguous/);
  assert.throws(() => applyAnchored(src, "missing", "Z"), /missing/);
  const once = applyAnchored("a function XGn(n){return 1} b", "function XGn(n){return 1}", "Z");
  assert.equal(once, "a Z b");
});

test("runtime prelude resolves preference then system tags", async () => {
  const prelude = RUNTIME_LINES.join(NL);
  const probe = 'return RLocT("A","B");';
  const fn = new Function("window", "navigator", "location", prelude + NL + probe);
  const run = (pref, langs) => fn(
    { desktop: { language: { initial: { preference: pref } } } },
    { languages: langs, language: langs[0] },
    {},
  );
  assert.equal(run("zh-CN", ["en-US"]), "B");
  assert.equal(run("follow-system", ["zh-CN"]), "B");
  assert.equal(run("follow-system", ["en-US"]), "A");
});

test("engine double-quoted apostrophes never open string spans", async () => {
  const src = "x({title:" + JSON.stringify("You're up to date") + "})" + NL + "x({title:" + JSON.stringify("Behavior") + "})";
  const first = applyPair(src, "You're up to date", "已是最新版本", "FULL");
  assert.equal(first.hits, 1);
  const second = applyPair(first.patched, "Behavior", "行为", "FULL");
  assert.equal(second.hits, 1);
  assert.ok(second.patched.includes("(RLocT(" + JSON.stringify("Behavior") + ","));
});

test("engine PANEL covers assignments, returns, custom props and option maps", async () => {
  const assignSrc = "let o=" + JSON.stringify("Sign Out") + ";o=" + JSON.stringify("Cancel");
  assert.equal(applyPair(assignSrc, "Sign Out", "退出登录", "PANEL").hits, 1);
  assert.equal(applyPair(assignSrc, "Cancel", "取消", "PANEL").hits, 1);
  assert.equal(applyPair("if(x)return" + JSON.stringify("Stable"), "Stable", "稳定版", "PANEL").hits, 1);
  assert.equal(applyPair("d={dark:" + JSON.stringify("Dark") + "}", "Dark", "深色", "PANEL").hits, 1);
  assert.equal(applyPair("x({submitAriaLabel:" + JSON.stringify("Add rule") + "})", "Add rule", "添加规则", "PANEL").hits, 1);
  assert.equal(applyPair("children:[a," + JSON.stringify("Search") + "]", "Search", "搜索", "PANEL").hits, 1);
  assert.equal(applyPair("placeholder:k.title??" + JSON.stringify("Search"), "Search", "搜索", "PANEL").hits, 1);
  assert.throws(() => applyPair("children:[a," + JSON.stringify("Search") + "]", "Search", "搜索", "FULL"), /has no anchor/);
  assert.throws(() => applyPair("let o=" + JSON.stringify("Sign Out"), "Sign Out", "退出登录", "FULL"), /has no anchor/);
  assert.throws(() => applyPair("s===" + JSON.stringify("Cancel") + "?a:b", "Cancel", "取消", "PANEL"), /has no anchor/);
  assert.throws(() => applyPair("d={46:" + JSON.stringify("Delete") + "}", "Delete", "删除", "PANEL"), /has no anchor/);
});

test("engine ignores quotes inside regex literals when scanning spans", async () => {
  const src = "const w=/[\\p{L}\\p{M}'-]+/gu,x={children:" + JSON.stringify("About") + "};";
  const out = applyPair(src, "About", "关于", "FULL");
  assert.equal(out.hits, 1);
  assert.ok(out.patched.includes("(RLocT(" + JSON.stringify("About") + ","));
});

test("engine refuses unbounded single-quote spans", async () => {
  const stray = "var re=/x/;s='" + "y".repeat(5000);
  const src = stray + ",x={children:" + JSON.stringify("About") + "};";
  const out = applyPair(src, "About", "关于", "FULL");
  assert.equal(out.hits, 1);
});

test("engine branches code inside template interpolations but not template text", async () => {
  const src = "t=`Fresh ${n===0?" + JSON.stringify("Any running work will be interrupted.") + ":" + JSON.stringify("Done") + "} press \"Done\"!`;";
  const out = applyPair(src, "Any running work will be interrupted.", "所有正在运行的工作都将被中断。", "FULL");
  assert.equal(out.hits, 1);
  assert.ok(out.patched.includes("(RLocT(" + JSON.stringify("Any running work will be interrupted.") + ","));
  assert.equal(applyPair(src, "Done", "完成", "FULL").hits, 1);
});
