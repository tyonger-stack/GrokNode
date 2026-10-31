import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");
const fixture = JSON.parse(read("tests", "fixtures", "official-0781-native-icons.json"));

/** The marketplace sources use ESM `.js` specifiers for their `.ts` files; bundle with the
 * resolver the other marketplace tests use so the assertions run the real module. */
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

const { nativeIconMarkerOf, buildNativeToolIcon } = await loadModule(
  "frontend/src/extensions/marketplace/native-icons.ts",
);

/** The smallest DOM buildNativeToolIcon touches: createElement, className, setAttribute,
 * style property writes, innerHTML, and append — the same stand-in shape the CTA test uses. */
function makeDocument() {
  const nodes = [];
  return {
    createElement(tagName) {
      const node = {
        tagName,
        className: "",
        innerHTML: "",
        children: [],
        style: {},
        attributes: new Map(),
        setAttribute(name, value) {
          node.attributes.set(name, String(value));
        },
        append(child) {
          node.children.push(child);
        },
      };
      nodes.push(node);
      return node;
    },
    nodes,
  };
}

test("the marker resolution accepts every shape the surfaces feed it", () => {
  assert.equal(nativeIconMarkerOf({ native: "onepassword" }), "onepassword", "the raw catalogue view");
  assert.equal(nativeIconMarkerOf({ entry: { native: "email" } }), "email", "the dialog model's row wrapper");
  assert.equal(nativeIconMarkerOf({ entry: { name: "1password" } }), "onepassword", "official's name probe");
  assert.equal(nativeIconMarkerOf({ name: "Email" }), "email", "the display name of the English locale");
  assert.equal(nativeIconMarkerOf({ pluginName: "onepassword", name: "unrelated" }), "onepassword", "pluginName first, official's own order");
  assert.equal(nativeIconMarkerOf(null), null);
  assert.equal(nativeIconMarkerOf({ name: "slack" }), null, "an ordinary connector stays upstream's letter chip");
  assert.equal(nativeIconMarkerOf({ native: "whatever" }), null, "an unknown marker is not a brand");
});

test("the native row icon is official's own frame, 40x40 with the 22px glyph", () => {
  const document = makeDocument();
  const globalDocument = globalThis.document;
  globalThis.document = document;
  try {
    const box = buildNativeToolIcon("onepassword", 40);
    assert.equal(box.className, fixture.onepassword.spanClass, "official's class recipe");
    assert.equal(box.style.width, "40px");
    assert.equal(box.style.height, "40px");
    assert.equal(box.style.borderRadius, "11px");
    assert.equal(box.style.backgroundColor, "rgb(48, 49, 54)", "official's 1Password brand background");
    assert.equal(box.style.color, "rgb(255, 255, 255)");
    assert.ok(box.innerHTML.includes(fixture.onepassword.pathD), "official's brand path bytes");
    assert.ok(box.innerHTML.includes('height="22"'), "the row glyph renders at official's 22px");
    assert.ok(box.innerHTML.includes('viewBox="0 0 24 24"'));

    const envelope = buildNativeToolIcon("email", 40);
    assert.equal(envelope.style.backgroundColor, "var(--sand-bg-magenta-primary)", "official's email token");
    const glyph = envelope.children[0];
    assert.equal(glyph.tagName, "i");
    assert.equal(glyph.className, fixture.email.iconClass, "official's envelope class recipe");
    assert.equal(glyph.attributes.get("data-icon-name"), "envelope");
    assert.ok(glyph.attributes.get("style").includes("--icon-size: 22px"), "the row envelope is 22px");
    assert.ok(glyph.attributes.get("style").includes("\ueb1c"), "the glyph is official's U+EB1C");
  } finally {
    globalThis.document = globalDocument;
  }
});

test("the native detail icon is official's 56x56 frame with the 31px glyph", () => {
  const document = makeDocument();
  const globalDocument = globalThis.document;
  globalThis.document = document;
  try {
    const box = buildNativeToolIcon("onepassword", 56);
    assert.equal(box.style.width, "56px");
    assert.equal(box.style.height, "56px");
    assert.equal(box.style.borderRadius, "16px");
    assert.ok(box.innerHTML.includes('height="31"'), "official's detail svg is 31px, not the row's 22");

    const envelope = buildNativeToolIcon("email", 56);
    const glyph = envelope.children[0];
    assert.ok(glyph.attributes.get("style").includes("--icon-size: 31px"), "official's detail envelope is 31px");
    assert.ok(glyph.attributes.get("style").includes("\ueb1c"), "the glyph is official's U+EB1C");
  } finally {
    globalThis.document = globalDocument;
  }
});

test("every icon surface routes through the native resolution", () => {
  const view = read("frontend", "src", "extensions", "marketplace", "view.ts");
  assert.match(view, /import \{ buildNativeToolIcon, nativeIconMarkerOf \} from "\.\/native-icons\.js";/);
  assert.match(view, /open\.append\(buildRowToolIcon\(row, row\.iconUrl, row\.name, 40\)\);/, "the browse rows");
  assert.match(
    view,
    /open\.append\(buildRowToolIcon\(item\.row \?\? item, item\.iconUrl, item\.name, 40\)\);/,
    "the installed rows resolve through their backing browse row first",
  );
  assert.match(view, /header\.append\(buildDetailToolIcon\(row, detail\.iconUrl, detail\.name\)\);/, "the detail header");
  assert.match(view, /if \(marker != null\) return buildNativeToolIcon\(marker, 56\);/, "the detail branch renders the 56px frame");
  assert.match(view, /if \(marker != null\) return buildNativeToolIcon\(marker, 40\);/, "the row branch renders the 40px frame");
});
