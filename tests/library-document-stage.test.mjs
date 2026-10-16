import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { closeLibraryDom } from "./library-dom-teardown.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const window = new Window();
for (const name of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "navigator", "DOMParser", "HTMLImageElement", "Text", "Range"]) {
  try {
    if (name === "window") globalThis[name] = window;
    else if (name === "getComputedStyle") globalThis[name] = window.getComputedStyle.bind(window);
    else if (window[name] !== undefined && globalThis[name] === undefined) globalThis[name] = window[name];
  } catch {
    // Read-only globals such as navigator stay untouched.
  }
}
if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function loadBundle() {
  const result = await build({
    stdin: {
      contents: "export {createElement, act} from 'react'; export {createRoot} from 'react-dom/client'; export {DocumentStage, assetLabel, extractLocalAssetNames} from './frontend/src/recovered/features/library/document-stage'; export {isDocumentAssetName, documentAssetName} from './frontend/src/recovered/features/library/native-document-markdown';",
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
const locator = { storeId: "s1", documentId: "doc-9" };
function providerFor(overrides = {}) {
  const calls = { saves: [], assetCalls: [] };
  return {
    calls,
    getDocument: async () => ({ source: "# Title\nbody", share: { visibility: "private", canShareToTeam: true } }),
    getDocumentEditRight: async () => ({ canEdit: true }),
    saveDocument: async ({ source }) => { calls.saves.push(source); return { title: "Title" }; },
    getDocumentAssets: async ({ names }) => { calls.assetCalls.push([...names]); return { assets: [] }; },
    ...overrides,
  };
}
async function settled(ui, ms = 0) {
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}
async function waitFor(ui, cond, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    let ok = false;
    await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); ok = cond(); });
    if (ok) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
  }
}
async function renderStage(t, ui, props) {
  const { createRoot } = ui;
  const host = document.createElement("div");
  const editorHandle = { current: null };
  host.__handle = editorHandle;
  props = { ...props, editorHandle };
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => { await ui.act(async () => { root.unmount(); }); host.remove(); });
  await ui.act(async () => { root.render(ui.createElement(ui.DocumentStage, props)); });
  await waitFor(ui, () => host.querySelector(".ProseMirror") !== null && host.__handle.current !== null || /Couldn't load this document/.test(host.textContent ?? ""));
  await settled(ui);
  return { host, root };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const proseEl = (host) => {
  const el = host.querySelector(".ProseMirror");
  assert.ok(el, "the Markdown editor is mounted");
  return el;
};
const saveState = (host) => host.querySelector('[aria-label="Save state"]').textContent;
async function setDocText(ui, host, text) {
  await ui.act(async () => {
    assert.ok(host.__handle && host.__handle.current, "the editor handle is attached");
    host.__handle.current.setText(text);
  });
  await settled(ui);
}
async function blurEditor(ui, host) {
  await ui.act(async () => {
    proseEl(host).dispatchEvent(new window.FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
  });
  await settled(ui);
}
async function clickText(ui, host, text) {
  const btn = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  assert.ok(btn, "button " + text + " exists");
  await ui.act(async () => { btn.click(); });
  await settled(ui);
}
async function clickLabel(ui, host, label) {
  const btn = host.querySelector('button[aria-label="' + label + '"]');
  assert.ok(btn, "button " + label + " exists");
  await ui.act(async () => { btn.click(); });
  await settled(ui);
}

test("content and permission load together and stay read-only until allowed", async (t) => {
  // Given the document read and edit-right check are both gated,
  const ui = await loadBundle();
  const contentGate = deferred();
  const rightGate = deferred();
  const seen = [];
  const provider = providerFor({
    getDocument: async (...args) => { seen.push("content"); return contentGate.promise; },
    getDocumentEditRight: async (...args) => { seen.push("right"); return rightGate.promise; },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = ui.createRoot(host);
  t.after(async () => { await ui.act(async () => { root.unmount(); }); host.remove(); });
  await ui.act(async () => { root.render(ui.createElement(ui.DocumentStage, { locator, title: "Title", provider, saveDelayMs: 10, onClose() {} })); });
  // When neither promise has resolved,
  // Then both requests start in parallel and the stage shows its loading state.
  assert.match(host.textContent, /Loading document/);
  assert.deepEqual([...seen].sort(), ["content", "right"]);
  // When content arrives with edit rights denied,
  await ui.act(async () => { contentGate.resolve({ source: "# Title\nbody", share: null }); });
  await ui.act(async () => { rightGate.resolve({ canEdit: false }); });
  await waitFor(ui, () => host.querySelector(".ProseMirror") !== null);
  // Then the body renders as real Markdown in a non-editable editor.
  assert.equal(host.querySelector("textarea"), null);
  assert.equal(proseEl(host).getAttribute("contenteditable"), "false");
  assert.equal(host.querySelector("h1")?.textContent, "Title");
});

test("edits debounce, blur flushes and the title follows a save", async (t) => {
  // Given an editable document stage,
  const ui = await loadBundle();
  const provider = providerFor();
  const titles = [];
  const { host } = await renderStage(t, ui, { locator, title: "Title", provider, saveDelayMs: 30, onClose() {}, onTitleChange: (title) => titles.push(title) });
  // When the body is edited,
  await setDocText(ui, host, "revised");
  // Then nothing saves before the debounce window closes.
  assert.equal(provider.calls.saves.length, 0);
  // When the editor loses focus,
  await blurEditor(ui, host);
  // Then the source saves once, the parent learns the new title, and the state settles.
  assert.equal(provider.calls.saves.length, 1);
  assert.match(provider.calls.saves[0] ?? "", /revised/);
  assert.deepEqual(titles, ["Title"]);
  assert.match(saveState(host), /All changes saved/);
});

test("clean blur saves nothing", async (t) => {
  // Given an editable document that the user never changes,
  const ui = await loadBundle();
  const provider = providerFor();
  const { host } = await renderStage(t, ui, { locator, title: "Title", provider, saveDelayMs: 10, onClose() {} });
  // When the editor loses focus,
  await blurEditor(ui, host);
  // Then no save fires.
  assert.deepEqual(provider.calls.saves, []);
  assert.match(saveState(host), /Saved/);
});

test("changes during an in-flight save queue a second write", async (t) => {
  // Given a save that stays in flight until released,
  const ui = await loadBundle();
  const gate = deferred();
  const provider = providerFor({ saveDocument: async ({ source }) => { provider.calls.saves.push(source); await gate.promise; return { title: "Title" }; } });
  const { host } = await renderStage(t, ui, { locator, title: "Title", provider, saveDelayMs: 5, onClose() {} });
  // When a first edit starts saving and a second edit lands mid-flight,
  await setDocText(ui, host, "first");
  await settled(ui, 20);
  await setDocText(ui, host, "final");
  await ui.act(async () => { gate.resolve(); });
  await waitFor(ui, () => provider.calls.saves.length >= 2);
  // Then both sources persist in order and the stage ends clean.
  assert.equal(provider.calls.saves.length, 2);
  assert.match(provider.calls.saves[1] ?? "", /final/);
  assert.match(saveState(host), /All changes saved/);
});

test("a failed save keeps the draft and retries", async (t) => {
  // Given a save endpoint that rejects once,
  const ui = await loadBundle();
  let fail = true;
  const provider = providerFor({ saveDocument: async ({ source }) => { if (fail) throw new Error("denied"); return { title: "T" }; } });
  const { host } = await renderStage(t, ui, { locator, title: "Title", provider, saveDelayMs: 10, onClose() {} });
  // When the debounce window runs out,
  await setDocText(ui, host, "changed");
  await waitFor(ui, () => /Save failed/.test(saveState(host)));
  // Then the draft is kept and a retry succeeds.
  assert.match(proseEl(host).textContent ?? "", /changed/);
  fail = false;
  await clickLabel(ui, host, "Retry save");
  await waitFor(ui, () => /All changes saved/.test(saveState(host)));
  assert.match(proseEl(host).textContent ?? "", /changed/);
});

test("unchanged source never triggers a redundant save", async (t) => {
  // Given an editable document,
  const ui = await loadBundle();
  const provider = providerFor();
  const { host } = await renderStage(t, ui, { locator, title: "Title", provider, saveDelayMs: 10, onClose() {} });
  // When the content round-trips back to the persisted source without edits,
  await settled(ui, 30);
  await blurEditor(ui, host);
  // Then no save happens.
  assert.deepEqual(provider.calls.saves, []);
});

test("asset images resolve inline with per-name retry and secure parsing", async (t) => {
  // Given a source mixing a real asset ref with non-asset and hostile refs,
  const ui = await loadBundle();
  let calls = 0;
  const provider = providerFor({
    getDocument: async () => ({ source: "# T\n\n![fig](asset:fig.png) ![evil](asset:../../etc/passwd) ![ext](https://example.com/x.png)", share: null }),
    getDocumentAssets: async ({ names }) => {
      provider.calls.assetCalls.push([...names]);
      calls += 1;
      if (calls === 1) return { assets: [{ name: "fig.png", status: "missing" }] };
      return { assets: [{ name: "fig.png", status: "ready", bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), contentType: "image/png", etag: null }] };
    },
  });
  const { host } = await renderStage(t, ui, { locator, title: "Title", provider, saveDelayMs: 10, onClose() {} });
  // Then only the strict asset: name is ever requested.
  assert.deepEqual(provider.calls.assetCalls, [["fig.png"]]);
  // When the asset is missing, the inline image is marked blocked,
  const img = host.querySelector('img[data-document-image]');
  assert.ok(img, "the inline asset image renders");
  assert.equal(img.getAttribute("data-rte-image-src"), "asset:fig.png");
  assert.equal(img.getAttribute("data-asset-status"), "missing");
  assert.ok(img.hasAttribute("data-rte-image-blocked"));
  // and clicking it retries just that name and resolves to a browser image URL.
  await ui.act(async () => { img.click(); });
  await waitFor(ui, () => (host.querySelector('img[data-document-image]')?.getAttribute("src") ?? "").startsWith("data:image/png;base64,"));
  assert.deepEqual(provider.calls.assetCalls[provider.calls.assetCalls.length - 1], ["fig.png"]);
  assert.equal(host.querySelector('img[data-document-image]')?.getAttribute("data-asset-status"), "ready");
});

test("too_large and not_image stay blocked without retry", async (t) => {
  // Given assets the backend refuses to serve as images,
  const ui = await loadBundle();
  const provider = providerFor({
    getDocument: async () => ({ source: "# T\n\n![big](asset:big.png) ![note](asset:note.txt)", share: null }),
    getDocumentAssets: async ({ names }) => {
      provider.calls.assetCalls.push([...names]);
      return { assets: [{ name: "big.png", status: "too_large", sizeBytes: 9 }, { name: "note.txt", status: "not_image" }] };
    },
  });
  const { host } = await renderStage(t, ui, { locator, title: "Title", provider, saveDelayMs: 10, onClose() {} });
  // Then both stay blocked and clicking them fires no retry.
  const imgs = [...host.querySelectorAll('img[data-document-image]')];
  assert.equal(imgs.length, 2);
  assert.ok(imgs.every((img) => img.hasAttribute("data-rte-image-blocked")));
  assert.deepEqual(imgs.map((img) => img.getAttribute("data-asset-status")).sort(), ["not_image", "too_large"]);
  const before = provider.calls.assetCalls.length;
  await ui.act(async () => { imgs.forEach((img) => img.click()); });
  await settled(ui);
  assert.equal(provider.calls.assetCalls.length, before);
});

test("a failed asset batch offers a materials retry", async (t) => {
  // Given an asset fetch that fails wholesale once,
  const ui = await loadBundle();
  let calls = 0;
  const provider = providerFor({
    getDocument: async () => ({ source: "# T\n\n![fig](asset:fig.png)", share: null }),
    getDocumentAssets: async ({ names }) => {
      calls += 1;
      if (calls === 1) throw new Error("down");
      return { assets: [] };
    },
  });
  const { host } = await renderStage(t, ui, { locator, title: "Title", provider, saveDelayMs: 10, onClose() {} });
  // When the batch fails, the stage surfaces a materials retry that reloads.
  await settled(ui, 100);
  assert.ok(calls >= 1, "asset fetch ran, dom=" + (host.textContent ?? "").slice(0, 200));
  let seenAlert = false;
  for (let i = 0; i < 50 && !seenAlert; i++) { await settled(ui, 20); seenAlert = /Could not load materials/.test(host.textContent ?? ""); }
  assert.ok(seenAlert, "alert shown; calls=" + calls + " dom=" + (host.textContent ?? "").slice(0, 300));
  await clickText(ui, host, "Retry materials");
  await waitFor(ui, () => !/Could not load materials/.test(host.textContent ?? ""));
  assert.equal(calls, 2);
});

test("close flushes pending edits and returns focus", async (t) => {
  // Given a dirty stage,
  const ui = await loadBundle();
  const provider = providerFor();
  let focused = 0;
  let closed = 0;
  const { host } = await renderStage(t, ui, { locator, title: "Title", provider, saveDelayMs: 60, onClose: () => { closed += 1; }, restoreFocus: () => { focused += 1; } });
  await setDocText(ui, host, "late edit");
  // When it closes before the debounce window ends,
  await clickLabel(ui, host, "Close document");
  // Then the edit still saves and focus returns to the invoker.
  await waitFor(ui, () => provider.calls.saves.length >= 1);
  assert.equal(closed, 1);
  assert.equal(focused, 1);
  assert.match(provider.calls.saves[0] ?? "", /late edit/);
});

test("a late load never overwrites the current locator", async (t) => {
  // Given two locators where the first load hangs,
  const ui = await loadBundle();
  const gate = deferred();
  const first = { storeId: "s1", documentId: "doc-a" };
  const second = { storeId: "s1", documentId: "doc-b" };
  const provider = providerFor({
    getDocument: async ({ locator: at }) => {
      if (at.documentId === "doc-a") return gate.promise;
      return { source: "# Bee", share: null };
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = ui.createRoot(host);
  t.after(async () => { await ui.act(async () => { root.unmount(); }); host.remove(); });
  await ui.act(async () => { root.render(ui.createElement(ui.DocumentStage, { locator: first, title: "A", provider, saveDelayMs: 10, onClose() {} })); });
  // When the stage moves to the second locator and the first load lands late,
  await ui.act(async () => { root.render(ui.createElement(ui.DocumentStage, { locator: second, title: "B", provider, saveDelayMs: 10, onClose() {} })); });
  await ui.act(async () => { gate.resolve({ source: "# Aye", share: null }); });
  await waitFor(ui, () => host.querySelector("h1") !== null);
  // Then the current locator wins.
  assert.equal(host.querySelector("h1")?.textContent, "Bee");
});

test("read failure retry issues a second request", async (t) => {
  // Given a document read that fails once,
  const ui = await loadBundle();
  let reads = 0;
  const failing = providerFor({
    getDocument: async () => { reads += 1; if (reads === 1) throw new Error("down"); return { source: "# T", share: null }; },
  });
  const { host } = await renderStage(t, ui, { locator, title: "Title", provider: failing, saveDelayMs: 10, onClose() {} });
  assert.match(host.textContent, /Couldn't load this document/);
  // When the read is retried, the editor mounts.
  await clickText(ui, host, "Retry");
  await waitFor(ui, () => host.querySelector(".ProseMirror") !== null);
  assert.equal(reads, 2);
});

test("an unmounted stage drops late save callbacks", async (t) => {
  // Given a save that stays in flight past unmount,
  const ui = await loadBundle();
  const gate = deferred();
  const titles = [];
  const provider = providerFor({ saveDocument: async ({ source }) => { await gate.promise; return { title: "T" }; } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = ui.createRoot(host);
  const editorHandle = { current: null };
  host.__handle = editorHandle;
  t.after(() => { host.remove(); });
  await ui.act(async () => { root.render(ui.createElement(ui.DocumentStage, { locator, title: "Title", provider, saveDelayMs: 5, onClose() {}, onTitleChange: (title) => titles.push(title), editorHandle })); });
  await waitFor(ui, () => host.querySelector(".ProseMirror") !== null);
  await setDocText(ui, host, "doomed");
  await settled(ui, 20);
  // When the stage unmounts and the save lands late,
  await ui.act(async () => { root.unmount(); });
  await ui.act(async () => { gate.resolve(); });
  await settled(ui);
  // Then no parent callback fires after unmount.
  assert.deepEqual(titles, []);
});

test("asset name parsing admits only strict asset: refs", async (t) => {
  // Given the exported parsing helpers,
  const ui = await loadBundle();
  // When mixed sources are scanned,
  assert.deepEqual(ui.extractLocalAssetNames("# T\n![a](asset:fig.png)\n"), ["fig.png"]);
  assert.deepEqual(ui.extractLocalAssetNames("![x](https://example.com/x.png) ![y](/abs.png) ![z](rel.png)"), []);
  assert.deepEqual(ui.extractLocalAssetNames("![e](asset:../../etc/passwd) ![u](asset:UPPER.PNG) ![d](asset:a..b)"), []);
  // Then strict names validate and anything else is rejected.
  assert.equal(ui.documentAssetName("asset:fig.png"), "fig.png");
  assert.equal(ui.documentAssetName("  Asset:fig.png "), "fig.png");
  assert.equal(ui.documentAssetName("https://example.com/x.png"), null);
  assert.equal(ui.isDocumentAssetName("fig.png"), true);
  assert.equal(ui.isDocumentAssetName("../../etc/passwd"), false);
});

test("browser sources never touch Node Buffer", () => {
  // Given the two shipped stage sources,
  const stage = readFileSync(new URL("../frontend/src/recovered/features/library/document-stage.tsx", import.meta.url), "utf8");
  const helper = readFileSync(new URL("../frontend/src/recovered/features/library/native-document-markdown.tsx", import.meta.url), "utf8");
  // Then neither reaches for the Node-only Buffer API.
  assert.equal(/Buffer\.(from|alloc)|new Buffer|globalThis\.Buffer/.test(stage), false);
  assert.equal(/Buffer\.(from|alloc)|new Buffer|globalThis\.Buffer/.test(helper), false);
});

after(async () => {
  await closeLibraryDom(window);
});
