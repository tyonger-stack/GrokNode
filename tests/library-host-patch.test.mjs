import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { build } from "esbuild";
import vm from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import {
  assertLibraryCssScope,
  assertLibraryHostBundleSafety,
  buildLibraryHostBundle,
  LIBRARY_HOST_ANCHOR,
  LIBRARY_HOST_CALL,
  patchOriginalLibraryHost,
} from "../scripts/lib/library-host-renderer-patch.mjs";

const rendererDir = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
const syntheticSource = `const _a = {${LIBRARY_HOST_ANCHOR}};\nconsole.log("overview");\n`;

test("host bundle renders inside the overview tree", async () => {
  const bundle = await buildLibraryHostBundle();
  assert.ok(bundle.includes("RLibraryHost"));
  assert.ok(bundle.includes("sand-library-hover-card"));
  assert.ok(bundle.includes("grok_bot_library_hover_cards"));
  assert.ok(bundle.includes("DOMObserver"), "the real editor remains in the host bundle");
  assert.ok(!bundle.includes("createRoot("));
  assert.ok(bundle.includes(LIBRARY_HOST_CALL.slice(0, 20)) || bundle.includes("RLibraryHost"));
});

test("library CSS order matches the shipped renderer", async () => {
  const bundle = await buildLibraryHostBundle();
  const encoded = bundle.match(/style\.textContent=("(?:\\.|[^"])*")/)?.[1];
  assert.ok(encoded, "library host style text is missing");
  const css = JSON.parse(encoded);
  assert.ok(
    css.indexOf(".sand-file-viewer") < css.indexOf(".library-document-stage"),
    "document-stage rules must follow the shared file stage",
  );
  assert.ok(
    css.indexOf(".library-document-stage") < css.indexOf(".sand-media-viewer__thumb[aria-current"),
    "document-stage rules must precede the media viewer rules",
  );
  assert.ok(
    css.lastIndexOf(".sand-library-stage-icon-button") > css.lastIndexOf(".sand-media-viewer__thumb[aria-current"),
    "the shared stage button rules must follow the viewer rules",
  );
});

test("emitted host bundle initializes with the existing React runtime", async () => {
  const bundle = await buildLibraryHostBundle();
  const context = { S: React, p: jsxRuntime, Wr: ReactDOM, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL };
  vm.runInNewContext(bundle, context);
  assert.equal(typeof context.__sandLibraryHostNS.RLibraryHost, "function");
});

test("host patch applies exactly once and stays fail-closed", async () => {
  const bundle = await buildLibraryHostBundle();
  const patched = patchOriginalLibraryHost(syntheticSource, bundle);
  assert.ok(patched.includes("RLibraryHost"));
  assert.ok(patched.includes("sand-library-host"));
  assert.throws(() => patchOriginalLibraryHost(patched, bundle), /exactly once/);
  assert.throws(() => patchOriginalLibraryHost("console.log(1);", bundle), /exactly once|missing/);
});

test("patched real overview chunk still parses as a module", async (t) => {
  let entries;
  try {
    entries = await readdir(rendererDir);
  } catch {
    t.skip("src/app/dist is gitignored and only exists after bootstrap");
    return;
  }
  let target = null;
  for (const name of entries.filter((entry) => entry.endsWith(".js"))) {
    const text = await readFile(path.join(rendererDir, name), "utf8");
    if (text.includes(LIBRARY_HOST_ANCHOR)) target = text;
  }
  if (target === null) {
    t.skip("overview anchor not present in this bundle");
    return;
  }
  const bundle = await buildLibraryHostBundle();
  const patched = patchOriginalLibraryHost(target, bundle);
  assert.doesNotThrow(() => parse(patched, { sourceType: "module", ecmaVersion: "latest" }));
  if (process.env.R7B_EVIDENCE_DIR) {
    await writeFile(path.join(process.env.R7B_EVIDENCE_DIR, "host-bundle.js"), bundle);
    await writeFile(path.join(process.env.R7B_EVIDENCE_DIR, "patched-overview.js"), patched);
  }
});

test("real overview chunk carries the mount anchor exactly once", async (t) => {
  let entries;
  try {
    entries = await readdir(rendererDir);
  } catch {
    t.skip("src/app/dist is gitignored and only exists after bootstrap");
    return;
  }
  const hits = [];
  for (const name of entries.filter((entry) => entry.endsWith(".js"))) {
    const text = await readFile(path.join(rendererDir, name), "utf8");
    let count = 0;
    let at = text.indexOf(LIBRARY_HOST_ANCHOR);
    while (at >= 0) { count += 1; at = text.indexOf(LIBRARY_HOST_ANCHOR, at + 1); }
    if (count > 0) hits.push({ name, count });
  }
  assert.equal(hits.length, 1, `anchor must live in exactly one chunk: ${JSON.stringify(hits)}`);
  assert.equal(hits[0].count, 1);
});

test("host bundle adds no colliding top-level names to the chunk", async (t) => {
  let entries;
  try {
    entries = await readdir(rendererDir);
  } catch {
    t.skip("src/app/dist is gitignored and only exists after bootstrap");
    return;
  }
  let chunk = null;
  for (const name of entries.filter((entry) => entry.endsWith(".js"))) {
    const text = await readFile(path.join(rendererDir, name), "utf8");
    if (text.includes(LIBRARY_HOST_ANCHOR)) chunk = text;
  }
  if (chunk === null) {
    t.skip("overview anchor not present in this bundle");
    return;
  }
  const chunkTop = new Set();
  for (const node of parse(chunk, { sourceType: "module", ecmaVersion: "latest" }).body) {
    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) if (decl.id.type === "Identifier") chunkTop.add(decl.id.name);
    }
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) chunkTop.add(node.id.name);
  }
  for (const name of ["S", "p", "Wr", "Qe"]) assert.ok(chunkTop.has(name), `chunk runtime ${name} must stay top-level`);
  const bundle = await buildLibraryHostBundle();
  const bundleTop = new Set();
  for (const node of parse(bundle, { sourceType: "script", ecmaVersion: "latest" }).body) {
    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) if (decl.id.type === "Identifier") bundleTop.add(decl.id.name);
    }
  }
  const collisions = [...bundleTop].filter((name) => chunkTop.has(name));
  assert.deepEqual(collisions, [], `bundle top-level names must not collide: ${JSON.stringify(collisions)}`);
});

function probe(contents) {
  const root = path.resolve(import.meta.dirname, "..");
  return build({
    absWorkingDir: root,
    stdin: { contents, resolveDir: root, sourcefile: "library-guard-probe.js" },
    outfile: path.join(root, "library-guard-probe.js"),
    bundle: true, format: "iife", platform: "browser", write: false,
    sourcemap: "external", metafile: true, logLevel: "silent",
  });
}

test("guard permits the imported ProseMirror editor observer with source provenance", async () => {
  const result = await probe('import { EditorView } from "prosemirror-view"; globalThis.EditorView = EditorView;');
  await assert.doesNotReject(() => assertLibraryHostBundleSafety(result));
  assert.ok(Object.keys(result.metafile.inputs).some((name) => name.endsWith("prosemirror-view/dist/index.js")));
});

test("guard admits only audited detached schedulers, rejecting changed source bytes", async () => {
  const result = await probe('import mammoth from "mammoth/mammoth.browser.js"; import JSZip from "jszip"; globalThis.converters = [mammoth, JSZip];');
  await assert.doesNotReject(() => assertLibraryHostBundleSafety(result));
  const mapFile = result.outputFiles.find((file) => file.path.endsWith(".js.map"));
  const payload = JSON.parse(mapFile.text);
  const index = payload.sources.findIndex((source) => source.endsWith("mammoth/mammoth.browser.js"));
  assert.ok(index >= 0);
  payload.sourcesContent[index] += "\nnew MutationObserver(() => {});";
  const changed = { ...result, outputFiles: result.outputFiles.map((file) => file === mapFile ? { path: file.path, text: JSON.stringify(payload) } : file) };
  await assert.rejects(() => assertLibraryHostBundleSafety(changed), /MutationObserver/);
});

test("guard rejects host observers including aliases, computed properties and forged comments", async () => {
  for (const code of [
    "new MutationObserver(() => {}).observe(document.body, {subtree:true});",
    "new window.MutationObserver(() => {}).observe(document.body, {subtree:true});",
    'const Watch = globalThis["MutationObserver"]; new Watch(() => {});',
    'const { MutationObserver: Watch } = window; new Watch(() => {});',
    "// node_modules/prosemirror-view/dist/index.js\nclass DOMObserver { constructor() { new MutationObserver(() => {}); } } new DOMObserver();",
  ]) await assert.rejects(() => probe(code).then(assertLibraryHostBundleSafety), /MutationObserver/);
});

test("guard rejects actual root bindings and a second React runtime, not diagnostic text", async () => {
  await assert.doesNotReject(() => probe('throw new Error("createRoot( and new MutationObserver are forbidden");').then(assertLibraryHostBundleSafety));
  for (const code of [
    "function createRoot() { throw new Error('forbidden'); } createRoot();",
    'const mount = Wr["createRoot"]; mount(document.body);',
    'const {createRoot: mount} = Wr; mount(document.body);',
    'import {createRoot as mount} from "react-dom/client"; mount(document.body);',
    'import React from "react"; globalThis.secondReact = React;',
  ]) await assert.rejects(() => probe(code).then(assertLibraryHostBundleSafety), /createRoot|chunk React runtime/);
});

test("guard fails closed when build provenance is absent", async () => {
  const result = await probe("globalThis.ok = true;");
  delete result.metafile;
  await assert.rejects(() => assertLibraryHostBundleSafety(result), /provenance is missing/);
});

test("host bundle injects only scoped library css", async () => {
  const bundle = await buildLibraryHostBundle();
  const marker = "style.textContent=";
  const at = bundle.indexOf(marker);
  assert.ok(at >= 0, "injected style block must exist");
  const payload = JSON.parse(bundle.slice(at + marker.length).split(";document.head.append")[0]);
  assert.ok(!payload.includes("sand-kit-primitives"), "global design-system css must not ride along");
  assert.ok(!payload.includes(".sand-kit-button"), "global button rules must not be re-injected");
  assertLibraryCssScope(payload);
});
