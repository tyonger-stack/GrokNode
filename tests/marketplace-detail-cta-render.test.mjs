import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The marketplace sources use ESM `.js` specifiers for their `.ts` files, which Node will not resolve
 * on its own. Bundle through esbuild with a `.js` -> `.ts` resolver, the same shape the main-agent
 * test uses, so the assertions below execute the real builders rather than a copy of them.
 */
async function loadMarketplace() {
  const outfile = path.join(repoRoot, "node_modules", ".cache", "tests-marketplace-detail-cta.mjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, "frontend/src/extensions/marketplace/detail-cta.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    plugins: [{
      name: "js-to-ts",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
          const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
          return existsSync(candidate) ? { path: candidate } : null;
        });
      },
    }],
  });
  return import(pathToFileURL(outfile).href);
}

const { createAddAccountCta, createToolsRowCta } = await loadMarketplace();
// Pulled from the same bundle so the expectations and the code under test cannot come from two
// different module instances.
const { TEXT } = await loadModule("frontend/src/extensions/marketplace/model.ts");
const { DETAIL_ADD_ACCOUNT_FULL_CLASSES, DETAIL_TOOLS_ROW_CLASSES } = await loadModule(
  "frontend/src/extensions/marketplace/official-styles.ts",
);

async function loadModule(entry) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", `tests-mkt-${path.basename(entry, ".ts")}.mjs`);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    plugins: [{
      name: "js-to-ts",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
          const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
          return existsSync(candidate) ? { path: candidate } : null;
        });
      },
    }],
  });
  return import(pathToFileURL(outfile).href);
}

/**
 * The smallest DOM these builders touch: createElement, createTextNode, classList.add,
 * setAttribute, style.setProperty, append, and textContent.
 *
 * It is a stand-in for the browser, not a re-implementation of the builders — the assertions below
 * run the same `createAddAccountCta` / `createToolsRowCta` that `view.ts` calls, so a regression to
 * the old aria-label-only form is visible here rather than only in a rendered screenshot.
 */
function makeDocument() {
  const makeStyle = () => {
    const props = new Map();
    return { setProperty: (name, value) => void props.set(name, value), props };
  };
  const makeNode = (tagName) => {
    const classes = [];
    const attributes = new Map();
    const children = [];
    return {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      type: "",
      className: "",
      classList: {
        add: (name) => {
          if (!classes.includes(name)) classes.push(name);
        },
      },
      style: makeStyle(),
      setAttribute: (name, value) => void attributes.set(name, String(value)),
      getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
      hasAttribute: (name) => attributes.has(name),
      append: (...nodes) => void children.push(...nodes),
      get textContent() {
        return children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
      },
      set textContent(value) {
        children.length = 0;
        if (value !== "") children.push(String(value));
      },
      get children() {
        return children;
      },
      get classListValues() {
        return classes;
      },
    };
  };
  return {
    createElement: (tagName) => makeNode(tagName),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text), tagName: null }),
  };
}

test("the add-account CTA renders the official label as text, not as an aria-label", () => {
  const cta = createAddAccountCta(makeDocument());

  // The defect this guards: the label lived in aria-label, so the button rendered icon-only, 34px
  // tall, with the copy reachable only by a screen reader.
  assert.equal(cta.textContent, "添加其他账户");
  assert.equal(cta.getAttribute("aria-label"), null, "official carries no aria-label on this CTA");
  assert.equal(TEXT.addAccount, "添加其他账户", "the copy is also the official string, not a label of our own");

  // Glyph first, then the text node — official's child order. Exactly one element child, the glyph.
  const elements = cta.children.filter((c) => c.nodeType !== 3);
  assert.equal(elements.length, 1);
  assert.equal(elements[0].tagName, "I");
  assert.equal(elements[0].getAttribute("data-icon-name"), "plus");
  assert.equal(elements[0].getAttribute("aria-hidden"), "true");
  assert.equal(elements[0].style.props.get("--icon-size"), "10px");
  assert.equal(cta.children.length, 2, "the glyph and the label text, nothing else");
  assert.equal(cta.children[0].nodeType, 1, "official's child order is glyph first, then the text node");
  assert.equal(cta.children[1].nodeType, 3, "the label must be a text node, not a second element");
  assert.equal(cta.children[1].textContent, "添加其他账户");

  // Every class in the recipe has to reach the node, or the geometry assertions below prove nothing.
  for (const className of DETAIL_ADD_ACCOUNT_FULL_CLASSES) {
    assert.ok(cta.classListValues.includes(className), `rendered CTA is missing ${className}`);
  }
  // These two are the 14px horizontal inset. 0.18 ships neither class, so they come from the lifted
  // rules; if the class stopped landing on the node the row would compute 12px 0px instead of
  // 12px 14px, which is the second defect this file exists to catch.
  assert.ok(cta.classListValues.includes("sand-1pic42t"), "padding-inline-start class must be applied");
  assert.ok(cta.classListValues.includes("sand-1onr9mi"), "padding-inline-end class must be applied");
  assert.equal(cta.type, "button");
});

test("the 工具 row renders its label and chevron, and keeps the 14px inset classes", () => {
  const row = createToolsRowCta(makeDocument(), "已启用 23/23 个");

  assert.equal(row.textContent, "已启用 23/23 个");
  const elements = row.children.filter((c) => c.nodeType !== 3);
  assert.equal(elements.length, 2, "a label span and the chevron glyph");
  assert.equal(elements[0].tagName, "SPAN");
  assert.equal(elements[1].getAttribute("data-icon-name"), "chevron-right");
  for (const className of DETAIL_TOOLS_ROW_CLASSES) {
    assert.ok(row.classListValues.includes(className), `rendered row is missing ${className}`);
  }
  assert.ok(row.classListValues.includes("sand-1pic42t"));
  assert.ok(row.classListValues.includes("sand-1onr9mi"));
  assert.equal(row.type, "button");
});

test("view.ts actually calls these builders, rather than re-inlining them", () => {
  // Without this the two tests above could keep passing while the render path drifted back to
  // building the button inline — the classic way a guard protects dead code.
  // 2026-10-05: the add-account CTA is no longer appended directly. It became a collapsible
  // sibling (collapsed button ⇄ expanded form) so the node reference has to be mutable; the
  // builder call is what this test pins, not the literal `list.append(...)` form.
  const view = readFileSync(path.join(repoRoot, "frontend", "src", "extensions", "marketplace", "view.ts"), "utf8");
  assert.match(view, /const buildCollapsed = \(\): HTMLButtonElement => \{\s*\n\s*const cta = createAddAccountCta\(document\);/);
  assert.match(view, /const buildForm = \(\): HTMLElement =>\s*\n\s*createAddAccountForm\(document,/);
  assert.match(view, /list\.append\(createToolsRowCta\(document, detail\.toolsLabel\)\);/);
  assert.doesNotMatch(view, /setAttribute\("aria-label", TEXT\.addAccount\)/);
  assert.doesNotMatch(view, /createTextNode\(TEXT\.addAccount\)/, "the text node now belongs to detail-cta.ts");
});
