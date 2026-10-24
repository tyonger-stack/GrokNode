import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMap } from "node:module";
import { createHash } from "node:crypto";
import { parse } from "acorn";
import { fullAncestor } from "acorn-walk";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOST_ENTRY = path.join(repoRoot, "frontend/src/extensions/library-host-mount.tsx");

export const LIBRARY_HOST_ANCHOR = 'onOpenRoutine:Ie=>_({kind:"existing",id:Ie})})]}),k.length>0?p.jsx(D2n,{counts:I,onOpenSection:J,sections:k}):null';
export const LIBRARY_HOST_NAMESPACE = "__sandLibraryHostNS";
export const LIBRARY_HOST_CALL = `p.jsx(${LIBRARY_HOST_NAMESPACE}.RLibraryHost,{agentId:t.id})`;
const LIBRARY_HOST_REPLACEMENT = `onOpenRoutine:Ie=>_({kind:"existing",id:Ie})})]}),${LIBRARY_HOST_CALL},k.length>0?p.jsx(D2n,{counts:I,onOpenSection:J,sections:k}):null`;
const BUNDLE_MARK = "/* sand-library-host */";

const REACT_SHIM = `
const useState = (...args) => S.useState(...args);
const useEffect = (...args) => S.useEffect(...args);
const useLayoutEffect = (...args) => S.useLayoutEffect(...args);
const useMemo = (...args) => S.useMemo(...args);
const useRef = (...args) => S.useRef(...args);
const useId = (...args) => S.useId(...args);
const useCallback = (...args) => S.useCallback(...args);
const useContext = (...args) => S.useContext(...args);
const useImperativeHandle = (...args) => S.useImperativeHandle(...args);
const useSyncExternalStore = (...args) => S.useSyncExternalStore(...args);
const useDeferredValue = (...args) => S.useDeferredValue(...args);
const useInsertionEffect = (...args) => S.useInsertionEffect(...args);
const useDebugValue = (...args) => S.useDebugValue(...args);
const version = S.version;
const createRef = (...args) => S.createRef(...args);
const createContext = (...args) => S.createContext(...args);
const forwardRef = (...args) => S.forwardRef(...args);
const cloneElement = (...args) => S.cloneElement(...args);
const isValidElement = (...args) => S.isValidElement(...args);
const memo = (...args) => S.memo(...args);
const Fragment = S.Fragment;
const Children = S.Children;
function createElement(type, props, ...children) {
  const next = props == null ? {} : { ...props };
  if (children.length === 1) next.children = children[0];
  else if (children.length > 1) next.children = children;
  return p.jsx(type, next);
}
const React = { ...S, useState, useEffect, useLayoutEffect, useMemo, useRef, useId, useCallback, useContext, useImperativeHandle, useSyncExternalStore, useDeferredValue, useInsertionEffect, useDebugValue, version, createRef, createContext, forwardRef, cloneElement, isValidElement, memo, Fragment, Children, createElement };
export { useState, useEffect, useLayoutEffect, useMemo, useRef, useId, useCallback, useContext, useImperativeHandle, useSyncExternalStore, useDeferredValue, useInsertionEffect, useDebugValue, version, createRef, createContext, forwardRef, cloneElement, isValidElement, memo, Fragment, Children, createElement };
export default React;
`;

const JSX_SHIM = `
const Fragment = S.Fragment;
function jsx(type, props, key) { return p.jsx(type, props, key); }
function jsxs(type, props, key) { return p.jsxs(type, props, key); }
export { Fragment, jsx, jsxs, jsx as jsxDEV };
`;

const DOM_SHIM = `
function createPortal(children, container, key) { return Wr.createPortal(children, container, key); }
const flushSync = (...args) => Wr.flushSync(...args);
export { createPortal, flushSync };
export default { createPortal, flushSync };
`;

export function chunkReactPlugin() {
  return {
    name: "chunk-react",
    setup(buildApi) {
      const load = (contents) => ({ contents, loader: "js" });
      buildApi.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "chunk-react" }));
      buildApi.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: "jsx", namespace: "chunk-react" }));
      buildApi.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({ path: "jsx", namespace: "chunk-react" }));
      buildApi.onResolve({ filter: /^react-dom$/ }, () => ({ path: "dom", namespace: "chunk-react" }));
      buildApi.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: "client", namespace: "chunk-react" }));
      buildApi.onLoad({ filter: /.*/, namespace: "chunk-react" }, (args) => {
        if (args.path === "react") return load(REACT_SHIM);
        if (args.path === "jsx") return load(JSX_SHIM);
        if (args.path === "dom") return load(DOM_SHIM);
        return load('export function mountHost(){ throw new Error("Library host is a child of the overview tree"); }');
      });
    },
  };
}

// Only the scoped Library stylesheets may ship inside the host bundle. The
// overview chunk already loads the app design system (index-lCyB53CO.css), so
// re-injecting it here restyles unrelated surfaces (2026-10-12: the sidebar
// search/new buttons shifted after sand-kit-primitives.css rode along).
const LIBRARY_CSS_DIR = path.join(repoRoot, "frontend/src/recovered/features/library");
export const LIBRARY_CSS_SCOPES = Object.freeze([
  ".sand-agent-library",
  ".sand-library",
  ".sand-file-viewer",
  ".sand-text-viewer",
  ".sand-docx-viewer",
  ".library-canvas",
  ".library-document",
  ".library-page",
  ".sand-media-viewer",
]);

export function assertLibraryCssScope(cssText) {
  const source = String(cssText).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of source.split("}")) {
    const selector = (block.split("{")[0] ?? "").trim();
    if (selector === "" || selector.startsWith("@")) continue;
    for (const part of selector.split(",")) {
      const head = part.trim();
      if (head === "") continue;
      if (!LIBRARY_CSS_SCOPES.some((scope) => head.startsWith(scope))) {
        throw new Error(`Library host CSS must stay scoped, found: ${head}`);
      }
    }
  }
}

function cssPlugin(collected) {
  return {
    name: "library-css",
    setup(buildApi) {
      buildApi.onLoad({ filter: /\.css$/ }, async (args) => {
        // Global stylesheets (e.g. sand-kit-primitives.css) already ship with
        // the overview chunk; stub them without collecting so the injected
        // <style> cannot override unrelated surfaces.
        if (path.relative(LIBRARY_CSS_DIR, path.resolve(args.path)).startsWith("..")) {
          return { contents: "globalThis.__sandLibraryCssKept = 1; export default \"\";", loader: "js" };
        }
        collected.push({ filePath: args.path, text: await readFile(args.path, "utf8") });
        return { contents: "globalThis.__sandLibraryCssKept = 1; export default \"\";", loader: "js" };
      });
    },
  };
}

export async function assertLibraryHostBundleSafety(result) {
  const file = result.outputFiles.find((file) => file.path.endsWith(".js"));
  const mapFile = result.outputFiles.find((file) => file.path.endsWith(".js.map"));
  if (!file || !mapFile || !result.metafile) throw new Error("Library host build provenance is missing.");
  const payload = JSON.parse(mapFile.text);
  const sourceMap = new SourceMap(payload);
  const editorPath = fileURLToPath(import.meta.resolve("prosemirror-view"));
  const editorSource = await readFile(editorPath, "utf8");
  const editorTree = parse(editorSource, { sourceType: "module", ecmaVersion: "latest", locations: true });
  const observerClass = editorTree.body.find((node) => node.type === "ClassDeclaration" && node.id.name === "DOMObserver");
  const constructor = observerClass?.body.body.find((node) => node.kind === "constructor");
  const inputs = new Set(Object.keys(result.metafile.inputs).map((input) => path.resolve(repoRoot, input)));
  // These exact browser distributions schedule promises on a detached text node,
  // observing only characterData. A dependency update requires a fresh audit.
  const detachedSchedulers = new Map([
    [fileURLToPath(import.meta.resolve("mammoth/mammoth.browser.js")), "ce90d8f7d6a558bd5d358b32d06af5571daf04ac4e9841523ac9c0cd24c9ab61"],
    [fileURLToPath(import.meta.resolve("jszip/dist/jszip.min.js")), "7f839b2d4688b845c105ebf5d2f9803075f91ea0fe72bdaac176c3a04dd3d2c1"],
  ]);
  for (const input of inputs) {
    if (/[/\\]node_modules[/\\](react|react-dom)[/\\]/.test(input)) {
      throw new Error(`Library host must reuse the chunk React runtime: ${input}`);
    }
  }
  fullAncestor(parse(file.text, { ecmaVersion: "latest", locations: true }), (parent) => {
    for (const node of parent.type === "ObjectPattern" ? parent.properties : [parent]) {
      const name = node.type === "Identifier" ? node.name : node.type === "MemberExpression"
        ? (node.computed ? node.property.value : node.property.name) : node.type === "Property"
          ? (node.computed ? node.key.value : node.key.name ?? node.key.value) : null;
      if (name !== "MutationObserver" && name !== "WebKitMutationObserver" && name !== "createRoot") continue;
      const origin = sourceMap.findEntry(node.loc.start.line - 1, node.loc.start.column);
      const sourcePath = origin.originalSource && path.resolve(path.dirname(mapFile.path), origin.originalSource);
      const sourceIndex = payload.sources.findIndex((source) => path.resolve(path.dirname(mapFile.path), source) === sourcePath);
      const schedulerHash = detachedSchedulers.get(sourcePath);
      const detachedScheduler = name !== "createRoot" && inputs.has(sourcePath) && schedulerHash
        && createHash("sha256").update(payload.sourcesContent[sourceIndex]).digest("hex") === schedulerHash;
      // Only the actual imported editor constructor may own a DOM observer.
      const editorObserver = name === "MutationObserver" && sourcePath === editorPath && inputs.has(editorPath)
        && payload.sourcesContent[sourceIndex] === editorSource && constructor
        && origin.originalLine >= constructor.loc.start.line - 1 && origin.originalLine < constructor.loc.end.line;
      if (!editorObserver && !detachedScheduler) {
        throw new Error(`Library host must render inside the overview React tree: ${name} at ${origin.originalSource ?? "unmapped"}:${(origin.originalLine ?? -1) + 1}`);
      }
    }
  });
}

export async function buildLibraryHostBundle() {
  const css = [];
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [HOST_ENTRY],
    outfile: path.join(repoRoot, "library-host.js"),
    sourcemap: "external",
    metafile: true,
    bundle: true,
    format: "iife",
    globalName: LIBRARY_HOST_NAMESPACE,
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    write: false,
    logLevel: "silent",
    legalComments: "none",
    define: { "import.meta.url": "document.baseURI" },
    plugins: [chunkReactPlugin(), cssPlugin(css)],
  });
  const file = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
  if (!file.includes("function RLibraryHost") && !file.includes("RLibraryHost")) {
    throw new Error("Library host bundle did not emit RLibraryHost.");
  }
  await assertLibraryHostBundleSafety(result);
  for (const entry of css) {
    const relative = path.relative(LIBRARY_CSS_DIR, path.resolve(entry.filePath));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Library host must not bundle global CSS: ${entry.filePath}`);
    }
    assertLibraryCssScope(entry.text);
  }
  const cssText = [...css].sort((left, right) => {
    const rank = (entry) => path.basename(entry.filePath) === "stage-icon-button.css" ? 1 : 0;
    return rank(left) - rank(right);
  }).map((entry) => entry.text).join("\n");
  const style = css.length === 0 ? "" : `
;(()=>{if(typeof document==="undefined"||document.getElementById("sand-library-host-style"))return;const style=document.createElement("style");style.id="sand-library-host-style";style.textContent=${JSON.stringify(cssText)};document.head.append(style);})();
`;
  return `${BUNDLE_MARK}\n${file}${style}`;
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Original renderer ${label} anchor must appear exactly once.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalLibraryHost(source, bundle) {
  if (typeof bundle !== "string" || !bundle.includes(BUNDLE_MARK)) {
    throw new Error("Library host bundle is missing.");
  }
  const patched = replaceExactlyOnce(source, LIBRARY_HOST_ANCHOR, LIBRARY_HOST_REPLACEMENT, "library host mount");
  if (patched.includes(BUNDLE_MARK)) throw new Error("Library host bundle was already applied.");
  return `${patched}\n${bundle}`;
}
