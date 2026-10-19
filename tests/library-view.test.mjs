import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { closeLibraryDom } from "./library-dom-teardown.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const window = new Window({ settings: { enableJavaScriptEvaluation: false, disableIframePageLoading: true } });
for (const name of ["window", "document", "HTMLElement", "Element", "Node", "getComputedStyle"]) {
  globalThis[name] = name === "window" ? window : name === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ORIGIN = "https://library.example.test";
const NOW = Date.parse("2026-10-11T02:00:00Z");

async function loadBundle() {
  const result = await build({
    stdin: {
      contents: `export {createElement, act} from 'react'; export {createRoot} from 'react-dom/client'; export {LibraryHost} from './frontend/src/recovered/features/library/library-host'; export {pageShowsEditAge} from './frontend/src/recovered/features/library/library-row';`,
      resolveDir: repoRoot,
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    write: false,
    loader: { ".css": "text" },
    logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}

function page(extra) {
  return {
    kind: "document", storeId: "store-s1", documentId: "doc-9", title: "Spec",
    createdAtMs: NOW - 3 * 3600000, updatedAtMs: NOW - 3600000, visibility: "private", canShareToTeam: false,
    ...extra,
  };
}

function desktopFor(pagesById, docs = []) {
  return {
    calls: { opened: [] },
    checkGate: async () => true,
    getLibraryOrigin: async () => ORIGIN,
    getLibraryTranscript: async () => ({ entries: [
      { id: "e-doc", kind: "send-message", timestampMs: NOW - 3600000, seq: 4, message: { type: "text", content: `see [spec](${ORIGIN}/documents/store-s1/doc-9)` } },
      { id: "e-img", kind: "send-message", timestampMs: NOW - 60000, seq: 5, message: { type: "text", content: "pic", images: [{ url: "file:///a/shot.png", alt: "" }] } },
      { id: "e-link", kind: "send-message", timestampMs: NOW - 120000, seq: 3, message: { type: "attachment", url: "https://example.com/r" } },
    ] }),
    resolveLibraryPages: async ({ refs }) => refs.map((ref) => {
      const found = pagesById[ref.documentId ?? ref.canvasId];
      return found === undefined ? { status: "absent", ref } : { status: "found", ref, page: found };
    }),
    listLibraryDocs: async () => ({ docs }),
    resolveAttachmentMedia: async () => ({ kind: "image", dataUrl: "data:image/png;base64,aGVsbG8=", width: 1, height: 1 }),
    readAttachmentBytes: async () => null,
    downloadAttachment: async () => false,
    openExternal: async (url) => { desktop.calls.opened.push(url); },
    getLinkMetadata: async () => null,
    getDocument: async () => ({ source: "", share: null }),
    getDocumentEditRight: async () => ({ canEdit: false }),
    saveDocument: async () => ({ title: "" }),
    getDocumentAssets: async () => ({ assets: [] }),
    setDocumentVisibility: async () => "private",
    getCanvasShare: async () => ({ storeId: "s", canvasId: "c", share: null }),
    setCanvasVisibility: async () => "private",
  };
}

let desktop;
async function render(t, ui, next) {
  desktop = next;
  const host = document.createElement("div");
  document.body.append(host);
  const root = ui.createRoot(host);
  t.after(async () => { root.unmount(); host.remove(); });
  await ui.act(async () => { root.render(ui.createElement(ui.LibraryHost, { agentId: "agent-1", desktop, now: () => NOW })); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return host;
}

test("page rows show kind, visibility and edit age; media age is hover-only", async (t) => {
  const ui = await loadBundle();
  assert.equal(ui.pageShowsEditAge({ createdAtMs: 0, updatedAtMs: 60_001 }), true);
  assert.equal(ui.pageShowsEditAge({ createdAtMs: 0, updatedAtMs: 60_000 }), false);
  assert.equal(ui.pageShowsEditAge({ createdAtMs: null, updatedAtMs: 60_001 }), false);
  const host = await render(t, ui, desktopFor({ "doc-9": page({}) }, [
    { key: "n1", provider: "notion", externalId: "x", url: "https://notion.so/x", title: "Notes", createdByBot: true, lastAction: "edited", firstTouchedAtMs: NOW - 5000, lastTouchedAtMs: NOW - 5000 },
  ]));
  const pageRow = host.querySelector("[data-library-page='document']");
  assert.equal(pageRow.querySelector("[data-library-page-glyph]").getAttribute("data-library-page-glyph"), "file-text");
  assert.match(pageRow.querySelector(".sand-library-meta").textContent, /文档 · 私密 · 编辑于 /);
  const media = host.querySelector("[data-library-media='image']");
  assert.ok(media.querySelector(".sand-library-thumb"));
  assert.equal(media.querySelector(".sand-library-age") !== null, true);
  assert.equal(media.querySelector(".sand-library-meta"), null);
  assert.match(media.textContent, /shot\.png/);
  const external = host.querySelector("[data-library-external='notion']");
  assert.equal(external.querySelector("[data-library-doc-glyph]").getAttribute("data-library-doc-glyph"), "file-text");
  assert.match(external.querySelector(".sand-library-meta").textContent, /编辑于 /);
  assert.equal(external.querySelector("[aria-label^='更多操作']"), null);
  assert.doesNotMatch(host.textContent, /筛选|导出|公开写入/);
});

test("an empty library uses the original empty copy without the DIY heading", async (t) => {
  const ui = await loadBundle();
  const empty = desktopFor({});
  empty.getLibraryTranscript = async () => ({ entries: [] });
  empty.listLibraryDocs = async () => ({ docs: [] });
  const host = await render(t, ui, empty);
  assert.equal(host.querySelector("section")?.getAttribute("aria-label"), "资料库");
  assert.equal(host.textContent.includes("对话中的文件"), false);
  assert.match(host.textContent, /此 Bot 创建的页面、文件和应用会显示在这里/);
});

test("an uploaded DOCX appears when the conversation contains a user attachment", async (t) => {
  const ui = await loadBundle();
  const next = desktopFor({});
  next.getLibraryTranscript = async () => ({ entries: [
    { id: "uploaded-docx", kind: "user-attachment", seq: 1, timestampMs: NOW,
      file_path: "file:///workspace/attachments/uploaded.docx", file_name: "uploaded.docx" },
  ] });
  const host = await render(t, ui, next);
  const row = host.querySelector("[data-library-media='file']");
  assert.ok(row, "the uploaded file should be a library row");
  assert.match(row.textContent, /uploaded\.docx/);
});

test("generic media names fall back, a failed thumb keeps the row, and a long title stays intact", async (t) => {
  const ui = await loadBundle();
  const generic = "a".repeat(32) + ".png";
  const longTitle = "规格说明".repeat(20);
  const next = desktopFor({ "doc-9": page({ title: longTitle }) }, [
    { key: "n1", provider: "notion", externalId: "x", url: "https://notion.so/x", title: null, createdByBot: true, lastAction: "created", firstTouchedAtMs: NOW, lastTouchedAtMs: NOW },
  ]);
  next.getLibraryTranscript = async () => ({ entries: [
    { id: "e-doc", kind: "send-message", timestampMs: NOW - 3600000, seq: 4, message: { type: "text", content: `see [spec](${ORIGIN}/documents/store-s1/doc-9)` } },
    { id: "e-img", kind: "send-message", timestampMs: NOW - 60000, seq: 5, message: { type: "text", content: "pic", images: [{ url: `file:///${generic}`, alt: generic }] } },
  ] });
  next.resolveAttachmentMedia = async () => { throw new Error("thumb"); };
  next.getLinkMetadata = async () => { throw new Error("metadata"); };
  const host = await render(t, ui, next);
  const media = host.querySelector("[data-library-media='image']");
  assert.match(media.textContent, /图片/);
  assert.equal(media.querySelector("img"), null);
  assert.ok(host.textContent.includes(longTitle));
  assert.match(host.textContent, /notion\.so/);
  assert.doesNotMatch(host.textContent, /#[0-9a-f]{3,6}/i);
});

test("teardown releases the shared DOM", async () => {
  await closeLibraryDom(window);
});
