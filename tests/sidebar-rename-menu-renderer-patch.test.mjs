// Regression cover for the 0.71.2 "Rename chat / Rename Bot" sidebar context-menu entry.
//
// The patched menu and row are evaluated for real with stub React primitives, so a wrong
// gate (offering rename on collapsed/pinned rows), a dropped section, or a memo slot clash
// fails here rather than only on a live click.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parse } from "acorn";

import {
  applyOriginalRendererSidebarRenameMenu,
  patchOriginalSidebarRenameMenu,
  SIDEBAR_RENAME_MENU_ANCHORS,
} from "../scripts/lib/sidebar-rename-menu-renderer-patch.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PINNED_CHUNK = path.join(REPO_ROOT, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const run = promisify(execFile);

// src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped.
const pinnedChunk = await readFile(PINNED_CHUNK, "utf8").catch(() => null);
const pinnedSkip = pinnedChunk == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;
const patched = pinnedChunk == null ? null : patchOriginalSidebarRenameMenu(pinnedChunk);

function moduleLevelBindings(source) {
  const names = new Set();
  const addPattern = node => {
    if (node == null) return;
    if (node.type === "Identifier") names.add(node.name);
    else if (node.type === "ObjectPattern") for (const prop of node.properties) addPattern(prop.type === "RestElement" ? prop.argument : prop.value);
    else if (node.type === "ArrayPattern") for (const el of node.elements) addPattern(el);
    else if (node.type === "AssignmentPattern") addPattern(node.left);
    else if (node.type === "RestElement") addPattern(node.argument);
  };
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) names.add(node.id.name);
    else if (node.type === "VariableDeclaration") for (const decl of node.declarations) addPattern(decl.id);
    else if (node.type === "ImportDeclaration") for (const spec of node.specifiers) names.add(spec.local.name);
  }
  return names;
}

function functionSource(source, head) {
  const start = source.indexOf(head);
  assert.ok(start >= 0, `missing ${head}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${head}`);
}

const SENTINEL = Symbol.for("react.memo_cache_sentinel");
const stubs = () => {
  const comp = name => Object.assign(() => null, { displayName: name });
  const It = { Item: comp("It.Item"), Section: comp("It.Section") };
  return {
    he: { c: n => Array.from({ length: n }, () => SENTINEL) },
    p: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: comp("Fragment") },
    It,
    bt: comp("bt"),
    names: ["scn", "rcn", "ncn", "tcn", "lcn", "ucn", "dcn", "icn", "acn", "ocn", "ccn", "mcn"],
  };
};

/** Evaluate the patched `fcn` (and the injected item) against stub primitives. */
function evaluateMenu(source) {
  const item = functionSource(source, "function RRenameMenuItem(");
  const menu = functionSource(source, "function fcn(");
  const s = stubs();
  const factory = new Function("he", "p", "It", "bt", ...s.names, `${item}\n${menu}\nreturn { fcn, RRenameMenuItem };`);
  return { ...factory(s.he, s.p, s.It, s.bt, ...s.names.map(name => Object.assign(() => null, { displayName: name }))), It: s.It };
}

/** Lift the injected row expression and evaluate it for a given row shape. */
function evaluateRowRename(source, { collapsed, pinnedTile, isGroup, locale = "zh" }) {
  const start = source.indexOf("let RRenameMenu;");
  const end = source.indexOf("let Rn;", start);
  assert.ok(start >= 0 && end > start, "row rename expression not injected");
  const calls = [];
  const fn = new Function("c", "G", "s", "oe", "RLocT", "t", `${source.slice(start, end)}return RRenameMenu;`);
  const value = fn(collapsed, pinnedTile, { isGroup }, v => calls.push(v), (en, zh) => (locale === "zh" ? zh : en), Array.from({ length: 137 }, () => SENTINEL));
  return { value, calls };
}

test("every anchor resolves exactly once in the pristine bundle", { skip: pinnedSkip }, () => {
  for (const [label, before] of SIDEBAR_RENAME_MENU_ANCHORS) {
    assert.equal(pinnedChunk.split(before).length - 1, 1, label);
  }
});

test("the patched chunk parses as an ES module with node --check", { skip: pinnedSkip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sidebar-rename-"));
  const file = path.join(dir, "chunk.mjs");
  await writeFile(file, patched);
  await run(process.execPath, ["--check", file]);
});

test("injected identifiers are chunk top-level bindings", { skip: pinnedSkip }, () => {
  const top = moduleLevelBindings(patched);
  for (const name of ["RRenameMenuItem", "he", "p", "bt", "It"]) assert.ok(top.has(name), name);
});

test("the row offers rename only for expanded rows, with 0.71.2's chat/Bot labels", { skip: pinnedSkip }, () => {
  const bot = evaluateRowRename(patched, { collapsed: false, pinnedTile: false, isGroup: false });
  assert.equal(bot.value.label, "重命名 Bot");
  bot.value.onStart();
  assert.deepEqual(bot.calls, [true], "onStart flips the same inline-editor flag as double-click");
  assert.equal(evaluateRowRename(patched, { collapsed: false, pinnedTile: false, isGroup: true }).value.label, "重命名聊天");
  assert.equal(evaluateRowRename(patched, { collapsed: false, pinnedTile: false, isGroup: true, locale: "en" }).value.label, "Rename chat");
  assert.equal(evaluateRowRename(patched, { collapsed: true, pinnedTile: false, isGroup: false }).value, undefined);
  assert.equal(evaluateRowRename(patched, { collapsed: false, pinnedTile: true, isGroup: false }).value, undefined);
});

test("the menu renders a rename section right after the pin/mark section", { skip: pinnedSkip }, () => {
  const { fcn, RRenameMenuItem, It } = evaluateMenu(patched);
  const onStart = () => {};
  const out = fcn({ agent: { id: "a", isGroup: false }, rename: { label: "Rename Bot", onStart } });
  const children = out.props.children;
  assert.equal(children.length, 5);
  const section = children[1];
  assert.equal(section.type, It.Section);
  assert.equal(section.props.children.type, RRenameMenuItem);
  const item = RRenameMenuItem(section.props.children.props);
  assert.equal(item.type, It.Item);
  assert.equal(item.props.onSelect, onStart);
  assert.equal(item.props.children, "Rename Bot");
  assert.equal(item.props.leading.props.name, "pencil-square");

  const without = fcn({ agent: { id: "a", isGroup: false } });
  assert.equal(without.props.children[1], null, "no rename prop → no section");
});

test("memo caches are grown to cover every added slot", { skip: pinnedSkip }, () => {
  const maxSlot = (body, v) => Math.max(...[...body.matchAll(new RegExp(`\\b${v}\\[(\\d+)\\]`, "g"))].map(m => Number(m[1])));
  const menu = functionSource(patched, "function fcn(");
  assert.match(menu, /he\.c\(70\)/);
  assert.equal(maxSlot(menu, "e"), 69);
  const row = functionSource(patched, "const udn=function(e){");
  assert.match(row, /he\.c\(137\)/);
  assert.equal(maxSlot(row, "t"), 136);
});

/** Apply every anchor except one — the "revert one anchor" mutation. */
function patchExcept(skipLabel) {
  let out = pinnedChunk;
  for (const [label, before, after] of SIDEBAR_RENAME_MENU_ANCHORS) if (label !== skipLabel) out = out.replace(before, after);
  return out;
}

test("mutation: reverting the menu-sections anchor drops the rename entry", { skip: pinnedSkip }, () => {
  const { fcn } = (() => {
    try { return evaluateMenu(patchExcept("menu sections")); } catch { return { fcn: null }; }
  })();
  const out = fcn?.({ agent: { id: "a", isGroup: false }, rename: { label: "x", onStart() {} } });
  assert.notEqual(out?.props.children.length, 5, "without the anchor the menu must not grow a rename section");
});

test("mutation: reverting the row-props anchor leaves the menu without a rename prop", { skip: pinnedSkip }, () => {
  const mutated = patchExcept("row menu props");
  assert.ok(!functionSource(mutated, "const udn=function(e){").includes("rename:RRenameMenu"));
  assert.ok(functionSource(patched, "const udn=function(e){").includes("rename:RRenameMenu"));
});

test("mutation: reverting the row memo anchor leaves slots past the cache size", { skip: pinnedSkip }, () => {
  const row = functionSource(patchExcept("row memo cache"), "const udn=function(e){");
  const size = Number(/he\.c\((\d+)\)/.exec(row)[1]);
  const max = Math.max(...[...row.matchAll(/\bt\[(\d+)\]/g)].map(m => Number(m[1])));
  assert.ok(max >= size, "the slot guard must catch an ungrown cache");
});

test("mutation: a drifted anchor fails closed", { skip: pinnedSkip }, () => {
  for (const [label, before] of SIDEBAR_RENAME_MENU_ANCHORS) {
    assert.throws(() => patchOriginalSidebarRenameMenu(pinnedChunk.replace(before, `${before.slice(0, -1)}\u0000`)), /missing or ambiguous/, label);
  }
  assert.throws(() => patchOriginalSidebarRenameMenu(patched), /already applied/);
});

test("apply writes the patched chunk and provenance", { skip: pinnedSkip }, async () => {
  const stage = await mkdtemp(path.join(tmpdir(), "sidebar-rename-stage-"));
  const assets = path.join(stage, "dist", "renderer", "assets");
  await mkdir(assets, { recursive: true });
  await cp(PINNED_CHUNK, path.join(assets, "index-UbX-y3il.js"));
  const provenance = await applyOriginalRendererSidebarRenameMenu({ stageRoot: stage });
  assert.equal(provenance.file, "dist/renderer/assets/index-UbX-y3il.js");
  assert.equal(await readFile(path.join(assets, "index-UbX-y3il.js"), "utf8"), patched);
  const record = JSON.parse(await readFile(path.join(stage, "dist", "renderer-sidebar-rename-menu-extension.json"), "utf8"));
  assert.match(record.evidence.featureGate, /grok_bot_multiplayer/);
});
