import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { applyPair } from "../scripts/lib/i18n-patch-engine.mjs";
import { MAIN_I18N_PAIRS } from "../scripts/lib/main-i18n-patch.mjs";
import {
  ROUTER_SECTION_CHILDREN_BEFORE,
  SECTION_CHILDREN_AFTER,
  SECTION_CHILDREN_BEFORE,
  SUPPORT_SUBMENU_COMPONENT,
  patchAccountSupport0758,
} from "../scripts/lib/account-support-0758-patch.mjs";

const assetsRoot = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
const bundle = await readFile(path.join(assetsRoot, "index-UbX-y3il.js"), "utf8").catch(() => null);
const bundleSkip = bundle == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;

// Two prerequisites run before this pass on the same chunk: the router patch
// drops the Help Center / Send Feedback rows from the section (its
// ACCOUNT_MENU_AFTER), and the search-menu pass appends the module-scope
// (hoisted) RSMOpenShortcuts declaration. Simulate both on the pristine bytes.
const staged = bundle == null ? null
  : (bundle.replace(ROUTER_SECTION_CHILDREN_BEFORE, SECTION_CHILDREN_BEFORE) + "\nfunction RSMOpenShortcuts(){}\n");
const patched = staged == null ? null : patchAccountSupport0758(staged);

// Memo slots the official OGe claims; the transplant must keep the same cache size.
const OFFICIAL_MEMO_SLOTS = 35;

const NEW_PAIR_IDS = ["77Emn0", "XYLcNv", "KKkUEB"];
const MOVED_LABELS = [["About", "关于"], ["Help Center", "帮助中心"], ["Send Feedback", "发送反馈"]];

function assertPatchedShape(source) {
  assert.equal(source.split("ROGe0758").length - 1, 2, "ROGe0758 must appear exactly twice: definition + one call site");
  assert.equal(source.split(SECTION_CHILDREN_AFTER).length - 1, 1, "the rewired section children must be present");
  assert.ok(!source.includes(SECTION_CHILDREN_BEFORE), "the old flat children array must be gone");
}

function extractFunction(source, name) {
  const start = source.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " must be present in the patched chunk");
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(name + " body never closes");
}

// Render the transplanted component for real. The memo cache starts sentinel-filled
// exactly like the chunk's own he.c (useMemoCache fills Array(n) with
// Symbol.for("react.memo_cache_sentinel")), so every guard misses and first render
// executes the whole body: any free identifier beyond p/he/It/bt/S would throw a
// ReferenceError here instead of silently skipping.
function renderSubmenu(componentSource, handlers) {
  const jsx = (type, props) => ({ type, props });
  const p = { jsx, jsxs: jsx };
  const memoSentinel = Symbol.for("react.memo_cache_sentinel");
  const he = { c: size => { assert.equal(size, OFFICIAL_MEMO_SLOTS); return Array(size).fill(memoSentinel); } };
  const It = {
    SubMenu: "It.SubMenu",
    SubMenuTrigger: "It.SubMenuTrigger",
    SubMenuContent: "It.SubMenuContent",
    Item: "It.Item",
    Section: "It.Section",
  };
  const bt = ({ name }) => ({ icon: name });
  const S = { useId: () => "r1" };
  const component = new Function("p", "he", "It", "bt", "S", componentSource + "\nreturn ROGe0758;")(p, he, It, bt, S);
  return { tree: component(handlers), bt };
}

function assertSubmenuStructure(tree, handlers, bt) {
  assert.equal(tree.type, "It.SubMenu");
  const [trigger, content] = tree.props.children;
  assert.equal(trigger.type, "It.SubMenuTrigger");
  assert.equal(trigger.props.label, "Support");
  assert.equal(trigger.props.leading.type, bt, "trigger leading must be rendered by the bt icon component");
  assert.equal(trigger.props.leading.props.name, "book");
  assert.equal(trigger.props.trailing.props.name, "chevron-right");
  assert.equal(trigger.props.trailing.props.color, "tertiary");
  assert.equal(trigger.props.children, "Support");
  assert.equal(content.type, "It.SubMenuContent");
  assert.equal(content.props["aria-label"], "Support options");
  assert.equal(content.props.minWidth, 180);
  assert.equal(content.props.size, "md");
  const section = content.props.children;
  assert.equal(section.type, "It.Section");
  const items = section.props.children;
  assert.deepEqual(items.map(item => item.props.children), ["Help Center", "Keyboard shortcuts", "Send Feedback", "About"]);
  assert.deepEqual(items.map(item => item.props.leading.props.name), ["question-circle", "keyboard", "mail", "info"]);
  assert.equal(items[1].props.onSelect, handlers.onOpenKeyboardShortcuts, "the keyboard shortcuts item must select the exact onOpenKeyboardShortcuts prop");
  return items;
}

function assertNewPairsLocalize(source, table) {
  for (const id of NEW_PAIR_IDS) {
    const row = table.find(entry => entry[2] === id);
    if (row == null) throw new Error("i18n table is missing the new pair row for " + id);
    const { patched: localized, hits } = applyPair(source, row[0], row[1], row[3]);
    assert.ok(hits >= 1, "new pair has no anchor on the patched chunk: " + row[0]);
    assert.ok(localized.includes(`(RLocT("${row[0]}","${row[1]}"))`), "new pair not localized: " + row[0]);
  }
}

test("the account support patch is guarded by the search-menu pass and lands exactly once", { skip: bundleSkip }, () => {
  assert.throws(() => patchAccountSupport0758(bundle), /function RSMOpenShortcuts/, "must fail closed before the search-menu pass has run");
  const unroutered = bundle.replace(ROUTER_SECTION_CHILDREN_BEFORE, ROUTER_SECTION_CHILDREN_BEFORE) + "\nfunction RSMOpenShortcuts(){}\n";
  assert.equal(unroutered.split(SECTION_CHILDREN_BEFORE).length - 1, 0, "pristine bytes must not match the post-router anchor");
  assertPatchedShape(patched);
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  assert.throws(() => patchAccountSupport0758(patched), /already applied/);
  const anchorless = staged.replace(SECTION_CHILDREN_BEFORE, "children:[ee,te,ne,Z]");
  assert.throws(() => patchAccountSupport0758(anchorless), /expected once, found 0/);
});

test("the section renders the Support submenu before Settings and keeps the moved rows out of it", { skip: bundleSkip }, () => {
  assert.match(patched, /children:\[ee,te,ne,p\.jsx\(ROGe0758,\{onOpenHelpCenter:Y,onOpenKeyboardShortcuts:RSMOpenShortcuts,onSendFeedback:h\.open,onOpenAbout:H\}\),Z\]/);
  // The displaced rows stay computed (dead code, like the sidebar-search port's a0n)
  // so the surrounding memo bookkeeping is untouched.
  assert.match(patched, /e\[37\]!==H\?\(se=p\.jsx\(It\.Item,\{leading:X,onSelect:H,children:"About"\}\)/);
  assert.match(patched, /e\[40\]!==Y\?\(Q=p\.jsx\(It\.Item,\{leading:le,onSelect:Y,children:"Help Center"\}\)/);
  assert.match(patched, /e\[43\]!==h\.open\?\(ce=p\.jsx\(It\.Item,\{leading:ae,onSelect:h\.open,children:"Send Feedback"\}\)/);
});

test("the transplanted component parses alone and the whole patched chunk passes node --check", { skip: bundleSkip }, () => {
  parse(SUPPORT_SUBMENU_COMPONENT, { ecmaVersion: "latest", sourceType: "module" });
  assert.equal(extractFunction(patched, "ROGe0758"), SUPPORT_SUBMENU_COMPONENT);
  const dir = mkdtempSync(path.join(tmpdir(), "account-support-chunk-"));
  try {
    const file = path.join(dir, "chunk.mjs");
    // main-i18n appends the RLocT runtime after this pass; mimic that before parsing for real.
    writeFileSync(file, `${patched}\nfunction RLocT(en,zh){return en}\n`);
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("structure eval: the submenu renders with official labels, icons and handlers", { skip: bundleSkip }, () => {
  const RSMOpenShortcuts = () => {};
  const handlers = {
    onOpenHelpCenter: "HELP",
    onOpenKeyboardShortcuts: RSMOpenShortcuts,
    onSendFeedback: "FEEDBACK",
    onOpenAbout: "ABOUT",
  };
  const { tree, bt } = renderSubmenu(extractFunction(patched, "ROGe0758"), handlers);
  const items = assertSubmenuStructure(tree, handlers, bt);
  // The three moved items keep the 0.18 spellings their FULL pairs match, and the
  // keyboard item's label is the raw literal main-i18n's PANEL pair localizes.
  assert.equal(items[0].props.children, "Help Center");
  assert.equal(items[1].props.children, "Keyboard shortcuts");
  assert.equal(items[2].props.children, "Send Feedback");
  assert.equal(items[3].props.children, "About");
});

test("the three new pairs localize the injected literals and the moved labels keep their anchors", { skip: bundleSkip }, () => {
  assertNewPairsLocalize(patched, MAIN_I18N_PAIRS);
  for (const [en, zh] of MOVED_LABELS) {
    const row = MAIN_I18N_PAIRS.find(entry => entry[0] === en);
    assert.ok(row != null && row[3] === "FULL", en + " must keep its FULL pair");
    const { patched: localized, hits } = applyPair(patched, en, zh, row[3]);
    assert.ok(hits >= 2, en + " should anchor in the pristine flat row and the injected copy");
    const localizedChildren = localized.split(`children:(RLocT("${en}","${zh}"))`).length - 1;
    assert.ok(localizedChildren >= 2, en + " must localize inside children props (flat row + injected item)");
  }
});

test("mutation: reverting the section rewire while keeping the transplant fails the shape check", { skip: bundleSkip }, () => {
  const reverted = patched.replace(SECTION_CHILDREN_AFTER, SECTION_CHILDREN_BEFORE);
  assert.notEqual(reverted, patched);
  assert.throws(() => assertPatchedShape(reverted), /ROGe0758/);
});

test("mutation: two swapped submenu items fail the order assertion", { skip: bundleSkip }, () => {
  const source = extractFunction(patched, "ROGe0758");
  const before = "children:[h,v,x,w]";
  assert.equal(source.split(before).length - 1, 1);
  const swapped = source.replace(before, "children:[v,h,x,w]");
  const RSMOpenShortcuts = () => {};
  const handlers = { onOpenHelpCenter: "HELP", onOpenKeyboardShortcuts: RSMOpenShortcuts, onSendFeedback: "FEEDBACK", onOpenAbout: "ABOUT" };
  const { tree, bt } = renderSubmenu(swapped, handlers);
  assert.throws(() => assertSubmenuStructure(tree, handlers, bt), /Help Center/);
});

test("mutation: wiring the keyboard item to the about handler fails the identity assertion", { skip: bundleSkip }, () => {
  const source = extractFunction(patched, "ROGe0758");
  const before = "onSelect:r,children:_";
  assert.equal(source.split(before).length - 1, 1);
  const rewired = source.replace(before, "onSelect:a,children:_");
  const RSMOpenShortcuts = () => {};
  const handlers = { onOpenHelpCenter: "HELP", onOpenKeyboardShortcuts: RSMOpenShortcuts, onSendFeedback: "FEEDBACK", onOpenAbout: "ABOUT" };
  const { tree, bt } = renderSubmenu(rewired, handlers);
  assert.throws(() => assertSubmenuStructure(tree, handlers, bt), /onOpenKeyboardShortcuts/);
});

test("mutation: deleting the Support options pair from the table fails the i18n assertion", { skip: bundleSkip }, () => {
  const table = MAIN_I18N_PAIRS.filter(entry => entry[2] !== "KKkUEB");
  assert.equal(table.length, MAIN_I18N_PAIRS.length - 1);
  assert.throws(() => assertNewPairsLocalize(patched, table), /KKkUEB/);
});
