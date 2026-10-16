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
      contents: `export {createElement, act} from 'react'; export {createRoot} from 'react-dom/client'; export {LibraryHost} from './frontend/src/recovered/features/library/library-host';`,
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

function entry(id, content) {
  return { id, kind: "send-message", timestampMs: NOW - 3600000, seq: 1, message: { type: "text", content } };
}

async function render(t, ui, desktop) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = ui.createRoot(host);
  t.after(async () => { root.unmount(); host.remove(); });
  await ui.act(async () => { root.render(ui.createElement(ui.LibraryHost, { agentId: "agent-1", desktop, now: () => NOW })); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return { host, root, ui };
}

function shell(overrides) {
  return {
    calls: { opened: [] },
    checkGate: async () => true,
    getLibraryOrigin: async () => ORIGIN,
    resolveAttachmentMedia: async () => ({ kind: "image", dataUrl: "data:image/png;base64,aGVsbG8=", width: 1, height: 1 }),
    readAttachmentBytes: async () => null,
    downloadAttachment: async () => false,
    openExternal: async function (url) { this.calls.opened.push(url); },
    getLinkMetadata: async () => null,
    getDocument: async () => ({ source: "", share: null }),
    getDocumentEditRight: async () => ({ canEdit: false }),
    saveDocument: async () => ({ title: "" }),
    getDocumentAssets: async () => ({ assets: [] }),
    setDocumentVisibility: async () => "private",
    getCanvasShare: async () => ({ storeId: "s", canvasId: "c", share: null }),
    setCanvasVisibility: async () => "private",
    listLibraryDocs: async () => ({ docs: [] }),
    ...overrides,
  };
}

test("private pages offer 打开 and 分享…; public pages offer 打开 only", async (t) => {
  const ui = await loadBundle();
  for (const visibility of ["private", "public", "unknown"]) {
    const desktop = shell({
      getLibraryTranscript: async () => ({ entries: [entry("e", `see [spec](${ORIGIN}/documents/store-s1/doc-9)`)] }),
      resolveLibraryPages: async ({ refs }) => refs.map((ref) => ({ status: "found", ref, page: {
        kind: "document", storeId: "store-s1", documentId: "doc-9", title: "Spec",
        createdAtMs: NOW - 1000, updatedAtMs: NOW - 1000, visibility, canShareToTeam: false,
      } })),
    });
    const view = await render(t, ui, desktop);
    const menu = view.host.querySelector(`[aria-label="更多操作: Spec"]`);
    assert.ok(menu);
    await ui.act(async () => { menu.click(); });
    assert.equal(menu.getAttribute("aria-expanded"), "true");
    const items = [...document.querySelectorAll("[role='menuitem']")].map((node) => node.textContent);
    assert.ok(items.includes("打开"));
    assert.equal(items.includes("分享…"), visibility === "private");
    view.root.unmount();
  }
});

test("external docs open their url and have no page menu", async (t) => {
  const ui = await loadBundle();
  const desktop = shell({
    getLibraryTranscript: async () => ({ entries: [] }),
    resolveLibraryPages: async () => [],
    listLibraryDocs: async () => ({ docs: [{ key: "n1", provider: "notion", externalId: "x", url: "https://notion.so/x", title: "Notes", createdByBot: true, lastAction: "created", firstTouchedAtMs: NOW, lastTouchedAtMs: NOW }] }),
  });
  const view = await render(t, ui, desktop);
  assert.equal(view.host.querySelector("[aria-label^='更多操作']"), null);
  const row = [...view.host.querySelectorAll("button")].find((node) => node.textContent.includes("Notes"));
  await ui.act(async () => { row.click(); });
  assert.deepEqual(desktop.calls.opened, ["https://notion.so/x"]);
});

test("a partial page failure stays visible and retry clears it", async (t) => {
  const ui = await loadBundle();
  let failSecond = true;
  const desktop = shell({
    getLibraryTranscript: async () => ({ entries: [
      entry("a", `see [one](${ORIGIN}/documents/store-s1/doc-1)`),
      { ...entry("b", `see [two](${ORIGIN}/documents/store-s1/doc-2)`), seq: 2 },
    ] }),
    resolveLibraryPages: async ({ refs }) => refs.map((ref) => {
      if (ref.documentId === "doc-2" && failSecond) return { status: "failed", ref };
      return { status: "found", ref, page: {
        kind: "document", storeId: ref.storeId, documentId: ref.documentId, title: ref.documentId,
        createdAtMs: NOW, updatedAtMs: NOW, visibility: "team", canShareToTeam: true,
      } };
    }),
  });
  const view = await render(t, ui, desktop);
  assert.match(view.host.textContent, /无法加载你的部分页面/);
  assert.match(view.host.textContent, /doc-1/);
  failSecond = false;
  await ui.act(async () => { view.host.querySelector("[role='alert'] button").click(); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.doesNotMatch(view.host.textContent, /无法加载你的部分页面/);
  assert.match(view.host.textContent, /doc-2/);
});

test("a failed external-doc source shows its own retry", async (t) => {
  const ui = await loadBundle();
  let fail = true;
  const desktop = shell({
    getLibraryTranscript: async () => ({ entries: [] }),
    resolveLibraryPages: async () => [],
    listLibraryDocs: async () => { if (fail) throw new Error("down"); return { docs: [] }; },
  });
  const view = await render(t, ui, desktop);
  assert.match(view.host.textContent, /无法加载你的已连接文档/);
  fail = false;
  await ui.act(async () => { view.host.querySelector("[role='alert'] button").click(); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.doesNotMatch(view.host.textContent, /无法加载你的已连接文档/);
});

test("teardown releases the shared DOM", async () => {
  await closeLibraryDom(window);
});
