import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parse } from "acorn";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { patchOriginalSidebarTopBarSearch } from "../scripts/lib/sidebar-search-renderer-patch.mjs";
import { patchMainAgentRenderer } from "../scripts/lib/main-agent-renderer-patch.mjs";
import { patchSearchPaletteRenderer } from "../scripts/lib/search-palette-renderer-patch.mjs";
import { SEARCH_MENU_0753_COMPONENTS } from "../scripts/lib/search-menu-0753-patch.mjs";
import { patchRecipientPicker0755, RECIPIENT_PICKER_0755_COMPONENTS } from "../scripts/lib/recipient-picker-0755-patch.mjs";
import official from "../scripts/lib/recipient-picker-0755-official.json" with { type: "json" };

const baseline = await readFile(new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js", import.meta.url), "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
const available = { skip: baseline == null ? "pinned renderer not hydrated" : false };
const before = baseline == null ? null : patchSearchPaletteRenderer(patchMainAgentRenderer(patchOriginalSidebarTopBarSearch(baseline)));
const patched = before == null ? null : patchRecipientPicker0755(before);
const syntax = patched == null ? null : parse(patched, { ecmaVersion: "latest", sourceType: "module" });
const named = name => { const node = syntax.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name); assert(node, name); return patched.slice(node.start, node.end); };
const catalogSyntax = parse(SEARCH_MENU_0753_COMPONENTS, { ecmaVersion: "latest", sourceType: "module" });
const catalogNode = catalogSyntax.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "RSMCatalogText");
const agents = [{ id: "one", name: "公文大师", isGroup: false }, { id: "two", name: "飞书小秘书", isGroup: false }, { id: "three", name: "资料收集员", isGroup: false }];
const cssClass = (...styles) => ({ className: styles.filter(value => value && typeof value === "object").flatMap(value => Object.entries(value).filter(([key]) => key !== "$$css").map(([, value]) => value)).filter(value => typeof value === "string").join(" ") });
const visitElements = (element, predicate, result = []) => {
  if (!element || typeof element !== "object") return result;
  if (Array.isArray(element)) { element.forEach(child => visitElements(child, predicate, result)); return result; }
  if (predicate(element)) result.push(element);
  React.Children.forEach(element.props?.children, child => visitElements(child, predicate, result));
  return result;
};
function picker(initialRecipients = [], language = "zh") {
  let recipients = [...initialRecipients], cursor = 0;
  const slots = [], events = [];
  const context = vm.createContext({
    S: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useId: () => "recipient-picker-test",
    },
    p: { jsx, jsxs, Fragment: React.Fragment },
    he: { c: size => Array(size).fill(Symbol.for("react.memo_cache_sentinel")) },
    Fe: cssClass, re: (...values) => values.filter(Boolean).join(" "), Ut: { body1: {}, body2: {}, caption: {}, label: {} },
    RLocT: (en, zh) => language === "zh" ? zh : en,
    RSM0753PC: ({ children }) => jsx("kbd", { children }), RSM0753Yb: { medium: {} },
    ml: ({ agent }) => jsx("span", { "data-avatar": agent.id }), hme: ({ id }) => jsx("span", { "data-avatar": id }),
    au: ({ icon }) => jsx("span", { "data-icon": icon }), Dr: ({ name }) => jsx("span", { "data-icon": name }),
    Jj: { xs: 16 }, _4n: "⌘", iAe: true, sHe: "Meta", Ymt: 9, Sge: 20, RSMGroupActive: true,
    mme: () => ({ activeOptionRef: { current: null }, markKeyboardNavigation() {} }),
    I4n: (rows, query) => rows.filter(row => row.name.toLowerCase().includes(query.trim().toLowerCase())),
    jj: value => value.trim().toLowerCase(), Wf: value => value.trim().split(/\s+/).filter(Boolean), A4n: () => false,
  });
  vm.runInContext(SEARCH_MENU_0753_COMPONENTS.slice(catalogNode.start, catalogNode.end) + RECIPIENT_PICKER_0755_COMPONENTS + ["Bie", "Kmt", "k2e", "J4n", "M4n", "q4n", "L4n"].map(named).join("\n") + ";globalThis.renderPicker=L4n;", context);
  const props = {
    agents,
    onAddRecipient: recipient => { recipients.push(recipient); events.push(["add", recipient.id]); },
    onRemoveRecipient: index => { recipients.splice(index, 1); events.push(["remove", index]); },
    onCommit: value => events.push(["commit", value]), onClose: () => events.push(["close"]), onPrefetchAgent() {},
  };
  return {
    events,
    render() { cursor = 0; return context.renderPicker({ ...props, recipients }); },
    recipients: () => recipients,
    context,
  };
}

test("the official placeholder is unchanged with zero, one, or several selected Bots", available, () => {
  for (const selected of [[], [{ kind: "agent", ...agents[0] }], agents.slice(0, 2).map(agent => ({ kind: "agent", ...agent }))]) {
    const state = picker(selected), tree = state.render();
    const input = visitElements(tree, element => element.type === "input")[0];
    assert.equal(input.props.placeholder, "Start a chat with…");
    assert.equal(input.props["aria-label"], "Start a chat with…");
    const html = renderToStaticMarkup(tree);
    assert.doesNotMatch(html, /Add or create another Bot|Tab<|>add<|>open</);
    assert.match(html, /aria-label="Close new chat"|aria-label="关闭新聊天"/);
  }
});

test("the copied official row shows the group hint only for the highlighted result", available, () => {
  const state = picker([{ kind: "agent", ...agents[0] }]), tree = state.render();
  const rows = visitElements(tree, element => typeof element.type === "function" && element.type.name === "RRPRow");
  assert.equal(rows.length, 2);
  const first = renderToStaticMarkup(rows[0]), second = renderToStaticMarkup(rows[1]);
  assert.match(first, /添加到群聊/);
  assert.doesNotMatch(second, /添加到群聊/);
  assert.match(first, /aria-setsize="2"/);
  assert.match(first, /rrp0755-sand-/);
});

test("selecting a Bot keeps the group picker open and removal uses the original controller callback", available, () => {
  const state = picker(), tree = state.render();
  const row = visitElements(tree, element => typeof element.type === "function" && element.type.name === "RRPRow")[0];
  const rowTree = row.type(row.props);
  rowTree.props.onClick();
  assert.equal(state.recipients()[0].id, "one");
  const selected = state.render(), html = renderToStaticMarkup(selected);
  assert.match(html, /移除 公文大师/);
  assert.match(html, /role="listbox"/);
  const chip = visitElements(selected, element => typeof element.type === "function" && element.type.name === "RRPRecipientChip")[0];
  chip.props.onRemove();
  assert.equal(state.recipients().length, 0);
  assert.deepEqual(state.events, [["add", "one"], ["remove", 0]]);
});

test("holding the modifier shows official keycaps and releasing it restores the row hint", available, () => {
  const state = picker([{ kind: "agent", ...agents[0] }]);
  state.render().props.onKeyDown({ key: "Meta" });
  const held = renderToStaticMarkup(state.render());
  assert.match(held, /<kbd>⌘<\/kbd>/);
  assert.doesNotMatch(held, /添加到群聊/);
  state.render().props.onKeyUp({ key: "Meta" });
  assert.match(renderToStaticMarkup(state.render()), /添加到群聊/);
});

test("the port preserves the controller and fails closed on repeated application", available, () => {
  assert.throws(() => patchRecipientPicker0755(patched), /already applied/);
  assert.equal(named("J4n"), (() => { const a = parse(before, { ecmaVersion: "latest", sourceType: "module" }); const n = a.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "J4n"); return before.slice(n.start, n.end); })());
  assert.match(renderToStaticMarkup(picker([], "en").render()), /Start a chat with…/);
});

test("the retained source and CSS identify the actual official 0.75.5 artifact", async t => {
  const { extractFile } = await import("@electron/asar");
  const archive = "/Applications/Grok Bot.app/Contents/Resources/app.asar";
  const present = await stat(archive).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (present == null) return t.skip("official comparison artifact unavailable");
  const source = extractFile(archive, official.file).toString();
  assert.equal(createHash("sha256").update(source).digest("hex"), official.sourceSha256);
  for (const code of Object.values(official.functions)) assert(source.includes(code));
  assert(official.css.includes("rrp0755-sand-15bd2j"));
});
