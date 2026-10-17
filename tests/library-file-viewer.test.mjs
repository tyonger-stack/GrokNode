import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { closeLibraryDom } from "./library-dom-teardown.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const window = new Window();
for (const name of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle"]) {
  globalThis[name] = name === "window" ? window : name === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function loadBundle() {
  const result = await build({
    stdin: {
      contents: `export {createElement, act} from 'react'; export {createRoot} from 'react-dom/client'; export {LibraryFileViewer, classifyLibraryFileKind} from './frontend/src/recovered/features/library/file-viewer';`,
      resolveDir: repoRoot,
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    write: false,
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}
const textOf = (bytes) => ({ kind: "bytes", bytes });
function bridges(overrides = {}) {
  const calls = { downloads: 0 };
  return {
    calls,
    readTextBytes: async () => textOf(new TextEncoder().encode(overrides.text ?? "")) ,
    readPdfBytes: async () => null,
    readDocxBytes: async () => null,
    readTableBytes: async () => null,
    onDownload: async () => { calls.downloads += 1; return true; },
  };
}
async function render(t, element) {
  const { createRoot, act } = await loadBundle();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => { await act(async () => root.unmount()); host.remove(); });
  return { host, root };
}

test("closed stays unmounted", async (t) => {
  const { LibraryFileViewer, act, createElement: h } = await loadBundle();
  const { host, root } = await render(t);
  const b = bridges();
  await act(async () => { root.render(h(LibraryFileViewer, { kind: "unknown", source: "s", name: "n", isOpen: false, onClose() {}, readTextBytes: b.readTextBytes, readPdfBytes: b.readPdfBytes, readDocxBytes: b.readDocxBytes, readTableBytes: b.readTableBytes, onDownload: b.onDownload })); });
  assert.equal(host.innerHTML, "");
});

test("unknown explains itself and downloads", async (t) => {
  const { LibraryFileViewer, act, createElement: h } = await loadBundle();
  const { host, root } = await render(t);
  const b = bridges();
  let closed = 0;
  await act(async () => { root.render(h(LibraryFileViewer, { kind: "unknown", source: "s", name: "mystery.bin", isOpen: true, onClose: () => { closed += 1; }, readTextBytes: b.readTextBytes, readPdfBytes: b.readPdfBytes, readDocxBytes: b.readDocxBytes, readTableBytes: b.readTableBytes, onDownload: b.onDownload })); });
  assert.match(host.textContent, /isn't available/);
  host.querySelector('[aria-label="下载"]').click();
  await act(async () => {});
  assert.equal(b.calls.downloads, 1);
  host.querySelector('[aria-label="关闭"]').click();
  assert.equal(closed, 1);
});

test("json parses to a tree and falls back to source", async (t) => {
  const { LibraryFileViewer, act, createElement: h } = await loadBundle();
  const { host, root } = await render(t);
  const make = (text) => bridges({ text });
  const good = make('{"a": [1, 2], "b": "x"}');
  await act(async () => { root.render(h(LibraryFileViewer, { kind: "json", source: "s", name: "d.json", isOpen: true, onClose() {}, readTextBytes: good.readTextBytes, readPdfBytes: good.readPdfBytes, readDocxBytes: good.readDocxBytes, readTableBytes: good.readTableBytes, onDownload: good.onDownload })); });
  assert.match(host.textContent, /a:/);
  const bad = make('{"a": ');
  await act(async () => { root.render(h(LibraryFileViewer, { kind: "json", source: "s", name: "d.json", isOpen: true, onClose() {}, readTextBytes: bad.readTextBytes, readPdfBytes: bad.readPdfBytes, readDocxBytes: bad.readDocxBytes, readTableBytes: bad.readTableBytes, onDownload: bad.onDownload })); });
  assert.match(host.querySelector("pre").textContent, /\{"a":/);
});

test("html toggles render and source", async (t) => {
  const { LibraryFileViewer, act, createElement: h } = await loadBundle();
  const { host, root } = await render(t);
  const b = bridges({ text: "<h1>Hi</h1>" });
  await act(async () => { root.render(h(LibraryFileViewer, { kind: "html", source: "s", name: "p.html", isOpen: true, onClose() {}, readTextBytes: b.readTextBytes, readPdfBytes: b.readPdfBytes, readDocxBytes: b.readDocxBytes, readTableBytes: b.readTableBytes, onDownload: b.onDownload })); });
  assert.ok(host.querySelector("iframe[sandbox]"));
  host.querySelectorAll('[role="tab"]')[1].click();
  await act(async () => {});
  assert.match(host.querySelector("pre").textContent, /Hi/);
});

test("classifier covers every dispatched kind", async () => {
  const { classifyLibraryFileKind } = await loadBundle();
  assert.deepEqual([
    classifyLibraryFileKind("a.PNG"), classifyLibraryFileKind("b.mp4"), classifyLibraryFileKind("c.MP3"),
    classifyLibraryFileKind("d.pdf"), classifyLibraryFileKind("e.md"), classifyLibraryFileKind("f.txt"),
    classifyLibraryFileKind("g.HTML"), classifyLibraryFileKind("h.json"), classifyLibraryFileKind("i.xlsx"),
    classifyLibraryFileKind("j.docx"), classifyLibraryFileKind("k.bin"),
  ], ["image", "video", "audio", "pdf", "markdown", "text", "html", "json", "table", "docx", "unknown"]);
});

test("audio resolves the original remote locator before setting its playback URL", async (t) => {
  const { LibraryFileViewer, act, createElement: h } = await loadBundle();
  const { host, root } = await render(t);
  const b = bridges();
  const sources = [];
  const source = "file:///home/box/music/original.wav";
  await act(async () => root.render(h(LibraryFileViewer, {
    ...b, kind: "audio", source, name: "original.wav", isOpen: true, onClose() {},
    resolveMedia: async (locator) => { sources.push(locator); return { kind: "audio", src: "data:audio/wav;base64,UklGRg==" }; },
  })));
  assert.deepEqual(sources, [source]);
  assert.equal(host.querySelector("audio").getAttribute("src"), "data:audio/wav;base64,UklGRg==");
});

for (const kind of ["html", "json"]) test(`${kind} retries a failed read of the original source`, async (t) => {
  const { LibraryFileViewer, act, createElement: h } = await loadBundle();
  const { host, root } = await render(t);
  const b = bridges();
  const sources = [];
  const source = `file:///home/box/original.${kind}`;
  await act(async () => root.render(h(LibraryFileViewer, {
    ...b, kind, source, name: `original.${kind}`, isOpen: true, onClose() {},
    readTextBytes: async (locator) => {
      sources.push(locator);
      if (sources.length === 1) throw new Error("transport unavailable");
      return textOf(new TextEncoder().encode(kind === "html" ? "<h1>Recovered</h1>" : '{"recovered":true}'));
    },
  })));
  const retry = host.querySelector('[aria-label="Retry"]');
  assert.ok(retry, "failed transport exposes the original retry action");
  await act(async () => retry.click());
  assert.deepEqual(sources, [source, source]);
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.ok(kind === "html" ? host.querySelector("iframe").srcdoc.includes("Recovered") : host.textContent.includes("recovered"));
});

for (const kind of ["html", "json"]) test(`${kind} does not retry missing or oversized files`, async (t) => {
  const { LibraryFileViewer, act, createElement: h } = await loadBundle();
  const { host, root } = await render(t);
  const b = bridges();
  for (const result of [null, { kind: "too-large", size: 90000000 }]) {
    await act(async () => root.render(h(LibraryFileViewer, {
      ...b, kind, source: "file:///home/box/original", name: "original", isOpen: true, onClose() {}, readTextBytes: async () => result,
    })));
    assert.equal(host.querySelector('[aria-label="Retry"]'), null);
    assert.ok(host.querySelector('[aria-label="下载"]'));
  }
});

test("audio rejects a missing resolver result without playing the remote file locator", async (t) => {
  const { LibraryFileViewer, act, createElement: h } = await loadBundle();
  const { host, root } = await render(t);
  await act(async () => root.render(h(LibraryFileViewer, {
    ...bridges(), kind: "audio", source: "file:///home/box/original.wav", name: "original.wav", isOpen: true, onClose() {}, resolveMedia: async () => null,
  })));
  assert.equal(host.querySelector("audio"), null);
  assert.ok(host.querySelector('[role="alert"]'));
});

test("teardown releases the shared DOM", async () => {
  await closeLibraryDom(window);
});
