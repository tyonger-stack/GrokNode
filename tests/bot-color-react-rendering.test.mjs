import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { botColorRuntime, buildBotColorTintTable, findBotColorMessageClasses } from "../scripts/lib/bot-color-renderer-components.mjs";
import { patchBotColorRenderer } from "../scripts/lib/bot-color-renderer-patch.mjs";

const evidence = path.resolve(process.env.BOT_COLOR_EVIDENCE_DIR ?? ".omo/evidence/bot-color-switch");
const renderer = new URL("../src/app/dist/renderer/", import.meta.url);

test("native chat switch paints during React commit while next settings read stays pending", {
  skip: existsSync(new URL("index.html", renderer)) ? false : "pinned renderer not hydrated",
}, async () => {
  mkdirSync(evidence, { recursive: true });
  const html = readFileSync(new URL("index.html", renderer), "utf8");
  const entry = html.match(/src="\.\/(assets\/index-[^"]+\.js)/)[1];
  const native = readFileSync(new URL(entry, renderer), "utf8");
  const cssName = html.match(/href="\.\/(assets\/index-[^"]+\.css)/)[1];
  const css = readFileSync(new URL(cssName, renderer), "utf8");
  const runtime = botColorRuntime(buildBotColorTintTable(css), findBotColorMessageClasses(css));
  const patched = patchBotColorRenderer(native, runtime);
  writeFileSync(path.join(evidence, "generated-renderer.js"), patched);
  const functions = new Map(parse(patched, { ecmaVersion: "latest", sourceType: "module" }).body
    .filter(n => n.type === "FunctionDeclaration").map(n => [n.id.name, patched.slice(n.start, n.end)]));
  assert.equal(createHash("sha256").update(native).digest("hex"), "ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa");
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const timers = [];
  let reads = 0, resolveNext;
  window.desktop = { agent: { getBotColorInChat() {
    reads++;
    return reads === 1 ? Promise.resolve(true) : new Promise(resolve => { resolveNext = resolve; });
  } } };
  const tail = (name, marker) => {
    const source = functions.get(name);
    assert.equal(source.split(marker).length, 2);
    return source.slice(source.indexOf(marker), -1);
  };
  // Execute the generated native cache/return expressions, with stable child seams.
  // The full yOn assembly runs unchanged except for the production patch.
  const harness = `
    const stable={}, noop=()=>{}, scrollRef=el=>refEvents.push(el), Ar=S.forwardRef((n,ref)=>p.jsx('div',{className:'ui-scroll-area',style:n.style,ref,onKeyDown:n.onKeyDown,children:n.children}));
    const scrollChild=p.jsx('div',{className:'sand-mvmkjj',children:'message'}), promptChild=p.jsx('textarea',{defaultValue:'draft'});
    function i_n(n){const e=S.useRef([]).current,ge=scrollRef,en=noop,Mn=stable,Es=scrollChild,rn='',Vn='';${tail("i_n", "let Sr;return")}}
    const c_n=S.memo(i_n);
    function S9n(n){const e=S.useRef([]).current,ts='sand-prompt-form',ks=n.onSubmit,za=promptChild;${tail("S9n", "let $a;return")}}
    function hve(n){return S.createElement(S9n,n)}
    function E3n(n){${functions.get("E3n").split("const e=he.c(58)")[0].slice("function E3n(n){".length)}const e=S.useRef([]).current,H=true,G='details',Y={width:321},U=null,se=null,le=null,te=false,ne='Details',j='sand-info-pane';${tail("E3n", "let Q;return")}}
    const re=(...names)=>names.join(' '),aSn=noop,$an=noop,lme=noop,pOn=()=>false,gOn=[],vt=noop,As=noop,JMn=noop,b_n=noop,iht=noop,nSn=noop;
    ${functions.get("yOn")}
    ${runtime}
    return {yOn,E3n};`;
  writeFileSync(path.join(evidence, "react-harness.js"), harness);
  const refEvents = [];
  const api = new Function("S", "p", "Cee", "QCe", "window", "document", "setInterval", "setTimeout", "refEvents", harness)(
    React, jsx, n => n.avatarColor, n => !!(n.avatarDataUrl || n.avatarVersion), window, window.document,
    f => { timers.push(f); }, f => { timers.push(f); }, refEvents);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const currentPresence = {}, transcriptSurface = {}, findInChat = {};
  const transcript = { currentPresence, transcriptSurface, transcriptPlaneKey: "plane" };
  const composer = { composerKey: "composer" };
  let submits = 0;
  const onSubmit = e => { e.preventDefault(); submits++; };
  function ActiveRow({ agent }) { return jsx.jsx("div", { className: "sand-agent-item", "data-active": true, "data-agent-id": agent.id }); }
  function Chat({ agent, remount = "same", mode = "composer" }) {
    const chat = api.yOn({ currentAgent: agent, currentAgentId: agent.id, transcript, composer, findInChat, onComposerSubmit: onSubmit });
    return jsx.jsxs(React.Fragment, { children: [jsx.jsx(ActiveRow, { agent }), jsx.jsxs("section", { children: [chat.transcript, chat[mode], jsx.jsx(api.E3n, { agent })] }, remount)] });
  }
  const agent = (id, avatarColor, extra = {}) => ({ id, avatarColor, ...extra });
  let commits = 0;
  const render = async props => React.act(async () => { root.render(jsx.jsx(React.Profiler, { id: "chat", onRender: () => { commits++; }, children: jsx.jsx(Chat, props) })); });
  const observations = [];
  function observe(label, expected, selectors = [".ui-scroll-area", ".sand-prompt-form", ".sand-info-pane"]) {
    const actual = selectors.map(selector => container.querySelector(selector).style.getPropertyValue("--sand-fill-accent"));
    observations.push({ label, reads, expected, actual });
    writeFileSync(path.join(evidence, "react-observations.json"), JSON.stringify(observations, null, 2));
    assert.deepEqual(actual, expected, label);
  }
  try {
    await render({ agent: agent("one", "red") });
    await React.act(async () => {
      document.dispatchEvent(new window.Event("DOMContentLoaded"));
      if (reads === 0) timers.at(-1)();
      await Promise.resolve();
    });
    observe("seeded red", Array(3).fill("var(--sand-fill-danger)"));
    await React.act(async () => { timers[0](); });
    assert.equal(reads, 2);
    const scroll = container.querySelector(".ui-scroll-area"), form = container.querySelector("form"), input = container.querySelector("textarea");
    const refCount = refEvents.length;
    scroll.scrollTop = 47;
    await render({ agent: agent("two", "violet") });
    observe("different hue switches before pending bridge resolves", Array(3).fill("var(--sand-fill-supplementary4)"));
    assert.equal(container.querySelector(".ui-scroll-area"), scroll);
    assert.equal(container.querySelector("form"), form);
    assert.equal(container.querySelector("textarea"), input);
    assert.equal(scroll.scrollTop, 47);
    assert.equal(refEvents.length, refCount, "tint clone preserves ref attachment");
    assert.equal(container.querySelector("aside").style.width, "321px");
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    assert.equal(submits, 1);
    await render({ agent: agent("same-hue", "violet") });
    observe("same hue switch preserves tint", Array(3).fill("var(--sand-fill-supplementary4)"));
    await render({ agent: agent("three", "violet"), remount: "new" });
    observe("same hue remount paints immediately", Array(3).fill("var(--sand-fill-supplementary4)"));
    for (const [label, extra, hue] of [["group", { isGroup: true }, "red"], ["avatar data", { avatarDataUrl: "data:image/png,x" }, "red"], ["avatar version", { avatarVersion: "v1" }, "red"], ["gray", {}, "gray"], ["black", {}, "black"]]) {
      await render({ agent: agent(label, hue, extra) });
      observe(label + " clears tint", ["", "", ""]);
    }
    await render({ agent: agent("current", "red"), mode: "newChatComposer" });
    observe("new chat has no native draft agent and keeps default", ["var(--sand-fill-danger)", "", "var(--sand-fill-danger)"]);
    await render({ agent: agent("hero", "red"), mode: "heroComposer" });
    observe("hero has no native draft agent and keeps default", ["var(--sand-fill-danger)", "", "var(--sand-fill-danger)"]);
    assert.equal(reads, 2, "no bridge read on agent switches");
    await render({ agent: agent("before-off", "red") });
    observe("all roots tinted before opt-out", Array(3).fill("var(--sand-fill-danger)"));
    await React.act(async () => { resolveNext(false); });
    observe("effective preference off clears mounted roots", ["", "", ""]);
    const beforeSameFlag = commits;
    await React.act(async () => { timers[0](); resolveNext(false); });
    assert.equal(commits, beforeSameFlag, "same effective flag does not notify React");
    observations.push({ label: "identity, submit, layout and idempotent snapshot", refCount, sameFlagCommits: commits - beforeSameFlag, scrollIdentity: true, formIdentity: true, textareaIdentity: true, scrollTop: 47, submits, width: "321px" });
    writeFileSync(path.join(evidence, "react-observations.json"), JSON.stringify(observations, null, 2));
  } finally {
    await React.act(async () => root.unmount());
    await window.happyDOM.close();
  }
});
