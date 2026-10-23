import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import postcss from "postcss";
import { createInfoPaneAction0753, infoPaneButtons0753Css } from "../frontend/src/extensions/info-pane-buttons-0753.js";
import { patchNativeInfoPaneTabs } from "../scripts/lib/info-pane-tabs-renderer-extension.mjs";

const pinned = new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js", import.meta.url);
const skip = existsSync(pinned) ? false : "pinned renderer not hydrated";
function functions(source, names) {
  return parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .filter(node => node.type === "FunctionDeclaration" && names.includes(node.id.name))
    .map(node => source.slice(node.start, node.end)).join("\n");
}

export function headerFixture(source) {
  const compiler = { c: length => Array(length).fill(Symbol.for("react.memo_cache_sentinel")) };
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const nativeStyles = vm.runInNewContext(`var x_e=0,lie={};${functions(source, ["C2t", "Fe"])};var I2t=C2t();Fe`);
  const classNames = (...values) => values.filter(value => typeof value === "string").join(" ");
  const Icon = ({ name, size }) => jsx.jsx("span", { "data-icon": name, "data-icon-size": size });
  const Button = createInfoPaneAction0753({ compiler, jsx, styles: nativeStyles, classNames, Icon });
  const Header = vm.runInNewContext(functions(patchNativeInfoPaneTabs(source), ["Nmt"]) + ";Nmt", {
    he: compiler, p: jsx, re: classNames, RInfoPaneAction0753: Button, zwe: "md",
  });
  const actions = [];
  const tree = Header({ onOpenSettings: () => actions.push("settings"), onClose: () => actions.push("close") });
  const buttons = Array.from(tree.props.children.at(-1).props.children, node => node.type(node.props)).map(node => node.type(node.props));
  return { tree, buttons, actions, Button };
}

test("transplanted header retains settings and close callbacks, labels and glyphs", { skip }, async () => {
  const { buttons, actions } = headerFixture(await readFile(pinned, "utf8"));
  assert.deepEqual(buttons.map(button => button.props["aria-label"]), ["Agent settings", "Close details"]);
  assert.deepEqual(buttons.map(button => button.props.children[0].props.name), ["settings-gear", "close"]);
  assert.equal(buttons[0].props["data-info-row"], "settings");
  for (const button of buttons) {
    assert.equal(button.type, "button");
    assert.equal(button.props["data-variant"], "elevated");
    assert.equal(button.props.children[0].props.size, "lg");
    button.props.onClick();
  }
  assert.deepEqual(actions, ["settings", "close"]);
});

test("official dimensions override old defaults; rules remain confined to the header", { skip }, async () => {
  const { buttons } = headerFixture(await readFile(pinned, "utf8"));
  const rules = [];
  postcss.parse(infoPaneButtons0753Css).walkRules(rule => {
    for (const selector of rule.selectors) assert.match(selector, /^(?:\[data-theme=cursor-dark\] )?\.sand-info-pane__top/);
    rules.push(rule);
  });
  for (const button of buttons) {
    assert.ok(button.props.className.includes("sand-10ijsmw"));
    assert.ok(button.props.className.includes("sand-19upwzy"));
    assert.ok(!button.props.className.includes("sand-gd8bvy"));
    assert.ok(!button.props.className.includes("sand-1fgtraw"));
    assert.ok(button.props.className.includes("sand-149ho13"));
    assert.ok(button.props.className.includes("sand-mkeg23"));
  }
  assert.ok(rules.some(rule => rule.selector.includes(".sand-10ijsmw:") && rule.nodes.some(decl => decl.prop === "width" && decl.value === "36px")));
  assert.ok(rules.some(rule => rule.selector.includes(".sand-19upwzy:") && rule.nodes.some(decl => decl.prop === "height" && decl.value === "36px")));
  assert.ok(rules.some(rule => rule.selector.includes(":hover:not(:disabled)") && rule.nodes.some(decl => decl.prop === "background-image")));
  assert.ok(rules.some(rule => rule.selector.includes(":focus-visible") && rule.nodes.some(decl => decl.prop === "outline-style" && decl.value === "solid")));
});

test("header presentation anchors fail closed on source drift", { skip }, async () => {
  const source = await readFile(pinned, "utf8");
  assert.throws(() => patchNativeInfoPaneTabs(source.replace('"data-info-row":"settings"', '"data-info-row":"changed"')), /settings button drifted/);
  assert.throws(() => patchNativeInfoPaneTabs(source.replace('re("sand-info-pane__actions",', 're("changed",')), /header layout drifted/);
});
