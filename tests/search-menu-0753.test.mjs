import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "acorn";
import { patchOriginalSidebarTopBarSearch } from "../scripts/lib/sidebar-search-renderer-patch.mjs";
import { patchMainAgentRenderer } from "../scripts/lib/main-agent-renderer-patch.mjs";
import { applySearchPaletteRendererPatch, patchSearchPaletteRenderer } from "../scripts/lib/search-palette-renderer-patch.mjs";
import { patchSearchMenu0753, SEARCH_MENU_0753_COMPONENTS, SEARCH_MENU_0753_STYLE } from "../scripts/lib/search-menu-0753-patch.mjs";
import official from "../scripts/lib/search-menu-0753-official.json" with { type: "json" };
import { applyPair } from "../scripts/lib/i18n-patch-engine.mjs";

const assets = new URL("../src/app/dist/renderer/assets/", import.meta.url);
const baseline = await readFile(new URL("index-UbX-y3il.js", assets), "utf8").catch(() => null);
const skip = baseline == null ? "pinned renderer not hydrated" : false;
const patched = baseline == null ? null : patchSearchPaletteRenderer(patchMainAgentRenderer(patchOriginalSidebarTopBarSearch(baseline)));

function runtime(language = "zh") {
  const calls = [];
  const context = vm.createContext({
    S: React, p: { jsx, jsxs },
    he: { c: size => React.useMemo(() => Array(size).fill(Symbol.for("react.memo_cache_sentinel")), []) },
    Fe: (...styles) => ({ className: styles.filter(value => value && typeof value === "object").flatMap(value => Object.entries(value).filter(([key]) => key !== "$$css").map(([, value]) => value)).filter(value => typeof value === "string").join(" ") }),
    re: (...values) => values.filter(Boolean).join(" "),
    Ar: () => { throw new Error("The scroll area cannot host a modal dialog"); },
    DX: ({ children, className, style, "aria-label": label, open, onOpenChange }) => {
      assert.equal(open, true);
      calls.push({ dialog: label, close: () => onOpenChange(false) });
      return jsx("section", { role: "dialog", className, style, "aria-label": label, children });
    },
    fr: props => jsx("button", { "aria-label": props["aria-label"], onClick: props.onClick, children: "×" }),
    RLocT: (en, zh) => language === "zh" ? zh : en,
    RCreateBotOpen: () => calls.push("bot"),
    RSearchPaletteSet: value => calls.push(["search", value]),
    navigator: { platform: "MacIntel" },
    Wf: value => value.trim().split(/\s+/).filter(Boolean),
    jj: value => value.trim().toLowerCase(),
    I4n: values => values,
    A4n: () => false,
    oct: "New Bot",
  });
  vm.runInContext(SEARCH_MENU_0753_COMPONENTS + `
    RSMClearRecipients=()=>{RSMGroupActive=false;};
    globalThis.api={commands:RSMSearchCommands,message:RSMMessage,host:RSMShortcutsHost,
      read:()=>({group:RSMGroupActive,shortcuts:RSMShortcutsVisible}),
      clear:()=>RSMClearRecipients(),close:()=>RSMShortcutsPublish(false),
      actions:value=>{RSMKeyboardActions=value;}};
  `, context);
  return { calls, context, api: context.api };
}

function menuOptions(runtime, info = []) {
  return {
    leading: [{ id: "open-hidden-chats", label: "Open Hidden Bots" }], info,
    settings: [
      { id: "settings:general", label: "通用", run: () => runtime.calls.push("general") },
      { id: "settings:computer", label: "电脑", run: () => runtime.calls.push("computer") },
      { id: "settings:vault", label: "保险库", run: () => runtime.calls.push("vault") },
      { id: "settings:router", label: "路由", run: () => runtime.calls.push("router") },
    ],
    trailing: [], openGroup: () => runtime.calls.push("group"), close: () => runtime.calls.push("close"),
  };
}

test("official leading commands precede localized settings and omit the obsolete hidden-Bots row", () => {
  const state = runtime();
  const commands = state.api.commands(menuOptions(state));
  assert.deepEqual(Array.from(commands, row => row.label), ["新建 Bot", "创建群聊", "键盘快捷键", "设置：通用", "设置：电脑", "设置：保险库", "设置：路由"]);
  assert.equal(commands[2].detail, "帮助");
  assert.equal(commands[3].detail, "设置");
  commands[0].run();
  assert.deepEqual(state.calls, [["search", false], "close", "bot"]);
  commands.find(row => row.id === "settings:vault").run();
  assert.equal(state.calls.at(-1), "vault");
});

test("Members stays conditional on the existing current-chat context", () => {
  const state = runtime();
  assert(!state.api.commands(menuOptions(state)).some(row => row.id === "info:members"));
  const commands = state.api.commands(menuOptions(state, [
    { id: "info:members", label: "Members", run: () => state.calls.push("members") },
    { id: "info:settings", label: "Chat Settings" },
  ]));
  assert.equal(commands[3].label, "成员");
  assert.equal(commands[3].detail, "当前聊天");
  commands[3].run();
  assert.equal(state.calls.at(-1), "members");
  assert(!commands.some(row => row.id === "info:settings"));
});

test("the real palette catalog hook passes its available settings and group callback to the port", { skip }, () => {
  const state = runtime();
  const node = parse(patched, { sourceType: "module", ecmaVersion: "latest" }).body.find(node => node.type === "FunctionDeclaration" && node.id.name === "RDn");
  Object.assign(state.context, {
    vDn: () => [{ id: "general", label: "通用", icon: "settings-gear" }, { id: "router", label: "路由", icon: "branch" }],
    qDn: id => "settings:" + id, jDn: {}, DDn: [], NDn: () => [], HOn: () => null,
    options: {
      palette: { openPalette() {}, closePalette: () => state.calls.push("close"), togglePalette() {} },
      leadingRows: [], infoRows: [], trailingRows: [],
      openSettings: id => state.calls.push(id), openPlugins() {},
      openNewGroupChat: () => state.calls.push("group"),
    },
  });
  vm.runInContext(patched.slice(node.start, node.end) + ";globalThis.Probe=function(){globalThis.catalog=RDn(options).commands;return null;};", state.context);
  renderToStaticMarkup(React.createElement(state.context.Probe));
  assert.deepEqual(Array.from(state.context.catalog.slice(0, 3), row => row.label), ["新建 Bot", "创建群聊", "键盘快捷键"]);
  state.context.catalog.find(row => row.id === "settings:router").run();
  assert.equal(state.calls.at(-1), "router");
  state.context.catalog[1].run();
  assert.equal(state.calls.at(-1), "group");
});

test("group entry creates a group selection even with one recipient and clears its mode on cancel", { skip }, () => {
  const state = runtime();
  const ast = parse(patched, { sourceType: "module", ecmaVersion: "latest" });
  const code = ["J4n", "Kmt", "k2e", "Bie"].map(name => {
    const node = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
    return patched.slice(node.start, node.end);
  }).join("\n");
  vm.runInContext(code + ";globalThis.commit=J4n;globalThis.rows=Bie;", state.context);
  const single = { kind: "agent", id: "one", name: "One" };
  assert.equal(state.context.commit({ recipients: [single], query: "", highlighted: null }).type, "single");
  state.api.commands(menuOptions(state))[1].run();
  assert.equal(state.api.read().group, true);
  assert.equal(state.context.commit({ recipients: [single], query: "", highlighted: null }).type, "group");
  const rows = state.context.rows([{ id: "one", name: "One" }, { id: "room", isGroup: true }], [], "");
  assert.deepEqual(Array.from(rows, row => row.agent.id), ["one"]);
  state.api.clear();
  assert.equal(state.api.read().group, false);
});

test("the transplanted shortcut dialog renders official groups and registered key bindings", () => {
  const state = runtime();
  state.api.actions([
    { id: "sand.commandPalette", hotkey: "mod+k" },
    { id: "sand.newAgent", hotkey: "mod+n" },
    { id: "sand.openSettings", hotkey: "mod+comma" },
    { id: "sand.keyboardShortcuts", hotkey: "mod+slash" },
  ]);
  state.api.commands(menuOptions(state))[2].run();
  const html = renderToStaticMarkup(React.createElement(state.api.host));
  assert.match(html, /role="dialog"/);
  assert.match(html, /键盘快捷键/);
  assert.match(html, /常用/);
  assert.match(html, /⌘/);
  assert.match(html, /sand-kit-key-cap/);
  assert.match(html, /rsm0753-sand-/);
  assert.doesNotMatch(html, /data-row="skills"/);
  const dialog = state.calls.find(call => call?.dialog === "键盘快捷键");
  assert(dialog, "The shortcut panel must open through the modal dialog primitive");
  dialog.close();
  assert.equal(state.api.read().shortcuts, false);
});

test("menu messages follow the selected language without modifying the upstream catalogs", () => {
  const state = runtime("en");
  const commands = state.api.commands({ ...menuOptions(state), settings: [{ id: "settings:general", label: "General" }] });
  assert.deepEqual(Array.from(commands, row => row.label), ["New Bot", "New group chat", "Keyboard shortcuts", "Settings: General"]);
});

test("the integrated renderer remains parseable and keeps translation anchors", { skip }, () => {
  parse(patched, { sourceType: "module", ecmaVersion: "latest" });
  assert(patched.includes('if(n.kind==="command")return null;'));
  assert(patched.includes('case"command":return"Action";'));
  assert(patched.includes('p.jsx(RSMShortcutsHost,{})'));
  assert(patched.includes('RSMKeyboardActions=be;'));
  assert.throws(() => patchSearchMenu0753(patched), /already applied/);
});

test("later translation passes preserve the official bilingual catalogs", { skip }, () => {
  const encodedCatalog = "const RSMCatalogs=JSON.parse(" + JSON.stringify(JSON.stringify(official.messages)) + ");";
  let localized = patched;
  for (const [en, zh] of [["New Bot", "新建 Bot"], ["Members", "成员"], ["Settings", "设置"]]) {
    localized = applyPair(localized, en, zh, "FULL").patched;
  }
  assert(localized.includes(encodedCatalog));
  parse(localized, { sourceType: "module", ecmaVersion: "latest" });
});

test("stage packaging records the command port and includes official keyboard CSS", { skip }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "search-menu-0753-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "dist/renderer/assets");
  await mkdir(directory, { recursive: true });
  const before = patchMainAgentRenderer(patchOriginalSidebarTopBarSearch(baseline));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(directory, "index-UbX-y3il.js"), before);
  await copyFile(new URL("index-lCyB53CO.css", assets), path.join(directory, "index-lCyB53CO.css"));
  const result = await applySearchPaletteRendererPatch({ stageRoot: root });
  assert(result.features.includes("official-command-catalog-0753"));
  assert((await readFile(path.join(directory, "index-lCyB53CO.css"), "utf8")).includes(SEARCH_MENU_0753_STYLE));
});

test("official shortcut sources and styles keep a verifiable upstream fingerprint", async t => {
  const source = await readFile("/tmp/official0753/dist/renderer/assets/index.eager-app-DjFE9lSq.js", "utf8").catch(() => null);
  if (source == null) return t.skip("official comparison artifact unavailable");
  assert.equal(createHash("sha256").update(source).digest("hex"), official.appSha256);
  for (const code of Object.values(official.functions)) assert(source.includes(code));
});
