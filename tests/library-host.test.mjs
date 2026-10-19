import { writeFileSync, mkdirSync } from "node:fs";
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
const evidence = process.env.R1_EVIDENCE_DIR;
function record(name, host, outcome) {
  if (!evidence) return;
  mkdirSync(evidence, { recursive: true });
  writeFileSync(path.join(evidence, name + ".html"), host.outerHTML);
  writeFileSync(path.join(evidence, name + ".json"), JSON.stringify({ scenario: name, outcome }, null, 2));
}
const observers = new Set();
globalThis.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; observers.add(this); }
  observe(target) { this.target = target; }
  disconnect() { observers.delete(this); }
};
async function intersect(ui, host, visible = true) {
  const observer = [...observers].find((item) => host.contains(item.target));
  assert.ok(observer, "actual host sentinel is observed");
  await ui.act(async () => observer.callback([{ isIntersecting: visible }]));
}
const ORIGIN = "https://library.example.test";
const NOW = Date.now();
const HOUR = 3600000;
const DAY = 24 * HOUR;
async function loadBundle() {
  const result = await build({
    stdin: {
      contents: `export {createElement, act} from 'react'; export {createRoot} from 'react-dom/client'; export {LibraryHost} from './frontend/src/recovered/features/library/library-host'; export {RLibraryHost, libraryDesktopFromWindow} from './frontend/src/extensions/library-host-mount';`,
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
function textEntry(id, offsetMs, content, images = [], extra = {}) {
  return { id, kind: "send-message", timestampMs: NOW + offsetMs, seq: 1000 + offsetMs / HOUR, message: { type: "text", content, images }, ...extra };
}
function baseEntries() {
  return [
    textEntry("e-today", -1 * HOUR, "look", [{ url: "file:///a/today.png", alt: "Today" }]),
    textEntry("e-week", -3 * DAY, "see", [{ url: "file:///a/week.png", alt: "Week" }]),
    textEntry("e-old", -30 * DAY, "old", [{ url: "file:///a/old.png", alt: "Old" }]),
    { id: "e-null", kind: "send-message", timestampMs: null, seq: 10, message: { type: "text", content: " timeless", images: [{ url: "file:///a/null.png", alt: "Null" }] } },
    textEntry("e-doc", -2 * HOUR, `read [spec](${ORIGIN}/documents/store-s1/doc-9)`, []),
    { id: "e-link", kind: "send-message", timestampMs: NOW - 30 * 60000, seq: 999, message: { type: "attachment", url: "https://example.com/r.pdf" } },
  ];
}
function mockDesktop(overrides = {}) {
  const calls = { opened: [], downloads: 0 };
  const pages = {
    [`document:store-s1:doc-9`]: { kind: "document", storeId: "store-s1", documentId: "doc-9", title: "Spec", createdAtMs: null, updatedAtMs: NOW - 2 * HOUR, visibility: "private", canShareToTeam: false },
  };
  return {
    calls,
    checkGate: async () => true,
    getLibraryOrigin: async () => ORIGIN,
    getLibraryTranscript: async () => ({ entries: baseEntries() }),
    resolveLibraryPages: async ({ refs, includeDocuments }) => refs.map((ref) => {
      if (ref.kind === "document" && includeDocuments === false) return { status: "absent", ref };
      const key = `${ref.kind}:${ref.storeId}:${ref.documentId ?? ref.canvasId}`;
      const page = pages[key];
      return page === undefined ? { status: "absent", ref } : { status: "found", ref, page };
    }),
    listLibraryDocs: async () => ({ docs: [{ key: "n1", provider: "notion", externalId: "x1", url: "https://notion.so/x1", title: "Notes", createdByBot: true, lastAction: "edited", firstTouchedAtMs: NOW - 5 * HOUR, lastTouchedAtMs: NOW - 90 * 60000, kind: "document" }] }),
    resolveAttachmentMedia: async () => ({ kind: "image", dataUrl: "data:image/png;base64,aGVsbG8=", width: 1, height: 1 }),
    readAttachmentBytes: async () => ({ kind: "bytes", bytes: new TextEncoder().encode("# Hi") }),
    downloadAttachment: async () => { calls.downloads += 1; return true; },
    openExternal: async (url) => { calls.opened.push(url); },
    getLinkMetadata: async () => null,
    getDocument: async () => ({ source: "# Hi", share: null }),
    getDocumentEditRight: async () => ({ canEdit: false }),
    saveDocument: async () => ({ title: "Hi" }),
    getDocumentAssets: async () => ({ assets: [] }),
    setDocumentVisibility: async () => "private",
    getCanvasShare: async () => ({ storeId: "s", canvasId: "c", share: null }),
    setCanvasVisibility: async () => "private",
    ...overrides,
  };
}
async function renderHost(t, ui, desktop, agentId = "agent-1") {
  const host = document.createElement("div");
  document.body.append(host);
  const root = ui.createRoot(host);
  t.after(async () => { await ui.act(async () => root.unmount()); host.remove(); });
  await ui.act(async () => { root.render(ui.createElement(ui.LibraryHost, { agentId, desktop, now: () => NOW })); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return host;
}
const headings = (host) => [...host.querySelectorAll("h3")].map((el) => el.textContent);
const rows = (host) => [...host.querySelectorAll("li button")].map((el) => el.textContent);

test("v2 merges pages, docs and media with groups and reveal", async (t) => {
  const ui = await loadBundle();
  const desktop = mockDesktop();
  const host = await renderHost(t, ui, desktop);
  assert.equal(host.querySelector("section")?.getAttribute("aria-label"), "资料库");
  assert.equal(host.textContent.includes("对话中的文件"), false, "official panel has no DIY heading");
  assert.deepEqual(headings(host), ["今天", "本周", "更早"]);
  const today = rows(host);
  assert.ok(today.some((text) => text.includes("Spec")));
  assert.ok(today.some((text) => text.includes("Notes")));
  assert.ok(desktop.calls.opened.length === 0);
});

test("external and link rows open outside, file rows open a viewer", async (t) => {
  const ui = await loadBundle();
  const desktop = mockDesktop();
  const host = await renderHost(t, ui, desktop);
  const buttons = [...host.querySelectorAll("li button")];
  const external = buttons.find((el) => el.textContent.includes("Notes"));
  await ui.act(async () => { external.click(); });
  assert.deepEqual(desktop.calls.opened, ["https://notion.so/x1"]);
  const file = buttons.find((el) => el.textContent.includes("Today"));
  await ui.act(async () => { file.click(); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const gallery = document.querySelector('[role="dialog"][aria-label^="Media"]');
  assert.ok(gallery !== null, "image rows open the visual gallery");
  const caption = gallery.querySelector(".sand-media-viewer__caption");
  assert.ok(caption !== null && caption.textContent.includes("Today"), "gallery caption names the clicked source");
  const current = gallery.querySelector("img.sand-media-viewer__image");
  assert.ok(current !== null && (current.getAttribute("src") || "").startsWith("data:image/"), "gallery resolves the current source through the media DTO");
  assert.equal(host.contains(gallery), false, "gallery mounts outside the list");
  await ui.act(async () => { gallery.querySelector('[aria-label="关闭媒体预览"]').click(); });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  record("R1-gallery-open", host, { gallery: true });
});

test("gallery pages through every visual source and downloads the original", async (t) => {
  const ui = await loadBundle();
  const downloads = [];
  const desktop = mockDesktop({
    getLibraryTranscript: async () => ({ entries: [
      textEntry("g1", -HOUR, "one", [{ url: "file:///a/one.png", alt: "One" }]),
      textEntry("g2", -2 * HOUR, "two", [{ url: "file:///a/two.png", alt: "Two" }]),
    ] }),
    downloadAttachment: async (path, name) => { downloads.push([path, name]); return true; },
  });
  const host = await renderHost(t, ui, desktop);
  const second = [...host.querySelectorAll("li button")].find((b) => b.textContent.includes("Two"));
  await ui.act(async () => { second.click(); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const gallery = document.querySelector('[role="dialog"]');
  assert.ok(gallery !== null);
  assert.match(gallery.getAttribute("aria-label"), /Media 2 of 2/);
  await ui.act(async () => { gallery.querySelector('[aria-label="Next media"]').click(); });
  assert.match(document.querySelector('[role="dialog"]').getAttribute("aria-label"), /Media 1 of 2/);
  await ui.act(async () => { document.querySelector('[aria-label="下载媒体"]').click(); });
  assert.deepEqual(downloads, [["file:///a/one.png", "One"]]);
  record("R1-gallery-nav-download", host, { downloads });
});

test("unknown gates fall back to the v1 media list", async (t) => {
  const ui = await loadBundle();
  const desktop = mockDesktop({ checkGate: async () => false });
  const host = await renderHost(t, ui, desktop);
  assert.ok(!host.textContent.includes("Spec"));
  assert.ok(host.textContent.includes("Today"));
});

test("failed transcript shows a retry that reloads", async (t) => {
  const ui = await loadBundle();
  let fail = true;
  const desktop = mockDesktop({ getLibraryTranscript: async () => { if (fail) throw new Error("down"); return { entries: baseEntries() }; } });
  const host = await renderHost(t, ui, desktop);
  assert.match(host.textContent, /资料加载失败/);
  fail = false;
  await ui.act(async () => { host.querySelector("section button").click(); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(host.textContent.includes("Today"));
});

test("each group reveals five rows at a time", async (t) => {
  const ui = await loadBundle();
  const images = Array.from({ length: 7 }, (_, i) => ({ url: `file:///a/t${i}.png`, alt: `T${i}` }));
  const desktop = mockDesktop({
    getLibraryTranscript: async () => ({ entries: [
      { id: "e-many", kind: "send-message", timestampMs: NOW - HOUR, seq: 100, message: { type: "text", content: "many", images } },
    ] }),
  });
  const host = await renderHost(t, ui, desktop);
  assert.equal(host.querySelectorAll("[data-library-media], [data-library-page], [data-library-external]").length, 5);
  const expand = [...host.querySelectorAll("button")].find((el) => el.textContent === "展开");
  assert.ok(expand !== undefined);
  await ui.act(async () => { expand.click(); });
  assert.equal(host.querySelectorAll("[data-library-media], [data-library-page], [data-library-external]").length, 8);
  assert.equal([...host.querySelectorAll("button")].filter((el) => el.textContent === "展开").length, 0);
});

test("history loads older entries without replacing the list", async (t) => {
  const ui = await loadBundle();
  const desktop = mockDesktop({
    getLibraryTranscript: async ({ cursor }) => (cursor === undefined
      ? { entries: [{ id: "e-new", kind: "send-message", timestampMs: NOW - HOUR, seq: 200, message: { type: "text", content: "new", images: [{ url: "file:///a/new.png", alt: "New" }] } }] }
      : { entries: [{ id: "e-old", kind: "send-message", timestampMs: NOW - 30 * DAY, seq: 50, message: { type: "text", content: "old", images: [{ url: "file:///a/old.png", alt: "Old" }] } }] }),
  });
  const host = await renderHost(t, ui, desktop);
  assert.ok(host.textContent.includes("New"));
  await intersect(ui, host);
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(host.textContent.includes("New"));
  assert.ok(host.textContent.includes("Old"));
});

test("every gate combination keeps enabled sources and drops only gated ones", async () => {
  const ui = await loadBundle();
  const names = ["grok_bot_library_v2", "grok_bot_library_pages", "grok_bot_documents_ui", "grok_bot_library_external_docs"];
  for (let mask = 0; mask < 16; mask += 1) {
    const on = Object.fromEntries(names.map((name, index) => [name, (mask & (1 << index)) !== 0]));
    const desktop = mockDesktop({ checkGate: async (name) => on[name] === true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = ui.createRoot(host);
    await ui.act(async () => { root.render(ui.createElement(ui.LibraryHost, { agentId: "agent-1", desktop, now: () => NOW })); });
    await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const text = host.textContent;
    await ui.act(async () => root.unmount());
    host.remove();
    const v2 = on.grok_bot_library_v2;
    assert.equal(text.includes("Today"), true, `media stays visible for ${mask}`);
    assert.equal(text.includes("Spec"), (v2 || on.grok_bot_library_pages) && on.grok_bot_documents_ui, `document page for ${mask}`);
    assert.equal(text.includes("Notes"), v2 && on.grok_bot_library_external_docs, `external doc for ${mask}`);
    assert.equal(text.includes("对话中的文件"), false, `no DIY heading for ${mask}`);
  }
});

test("v1 pages reveal five independently of media", async (t) => {
  const ui = await loadBundle();
  const desktop = mockDesktop({
    checkGate: async (name) => name !== "grok_bot_library_v2",
    getLibraryTranscript: async () => ({ entries: Array.from({ length: 11 }, (_, i) => textEntry(`p${i}`, -HOUR, `${ORIGIN}/documents/store-s1/doc-${i}`)) }),
    resolveLibraryPages: async ({ refs }) => refs.map((ref) => ({ ref, status: "found", page: { ...ref, title: ref.documentId, updatedAtMs: NOW, visibility: "public" } })),
  });
  const host = await renderHost(t, ui, desktop);
  const section = host.querySelector('[data-library-pages="v1"]');
  assert.ok(section);
  assert.equal(section.querySelectorAll("[data-library-page]").length, 5);
  await ui.act(async () => [...section.querySelectorAll("button")].find((b) => b.textContent === "展开").click());
  assert.equal(section.querySelectorAll("[data-library-page]").length, 10);
  record("R1-v1-plus5", host, { initial: 5, afterClick: 10 });
});

test("foreign cursor identities never reach Node resolution", async (t) => {
  const ui = await loadBundle();
  const dispatched = [];
  const store = "store-123e4567-e89b-42d3-a456-426614174000";
  const desktop = mockDesktop({
    getLibraryTranscript: async () => ({ entries: [textEntry("foreign", -HOUR, `https://cursor.com/documents/${store}/foreign ${ORIGIN}/documents/${store}/local /cursor/stores/user/canvases/123e4567-e89b-42d3-a456-426614174000/source.canvas.tsx`)] }),
    resolveLibraryPages: async ({ refs }) => { dispatched.push(...refs); return []; },
  });
  const host = await renderHost(t, ui, desktop);
  assert.deepEqual(dispatched, [{ kind: "document", storeId: store, documentId: "local" }]);
  record("R1-foreign-origin", host, { dispatched });
});

test("history failure retries and exhaustion is a state, not a truthy boolean", async (t) => {
  const ui = await loadBundle();
  let calls = 0;
  const desktop = mockDesktop({ getLibraryTranscript: async ({ cursor }) => {
    if (cursor === undefined) return { entries: baseEntries() };
    calls++;
    if (calls === 1) throw new Error("offline");
    return { entries: [] };
  } });
  const host = await renderHost(t, ui, desktop);
  await intersect(ui, host);
  const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "加载失败，重试");
  assert.ok(retry); assert.equal(retry.disabled, false);
  record("R1-history-failed", host, { calls, retryEnabled: true });
  await ui.act(async () => retry.click());
  assert.equal(host.querySelector('[data-library-history]').dataset.libraryHistory, "exhausted");
  assert.equal(calls, 2);
  record("R1-history-exhausted", host, { calls, state: "exhausted" });
});

test("history cap stays at ten despite rerenders and restarts on visibility reentry", async (t) => {
  const ui = await loadBundle();
  let calls = 0;
  const desktop = mockDesktop({ getLibraryTranscript: async ({ cursor }) => {
    if (cursor === undefined) return { entries: [textEntry("start", -HOUR, "", [{ url: "file:///a/start.png", alt: "Start" }], { seq: 100 })] };
    calls++;
    return { entries: [textEntry(`old${calls}`, -HOUR, "", [{ url: `file:///a/${calls}.png`, alt: `Older${calls}` }], { seq: cursor - 1 })] };
  } });
  const host = await renderHost(t, ui, desktop);
  await intersect(ui, host);
  assert.equal(calls, 10);
  await intersect(ui, host);
  assert.equal(calls, 10);
  record("R1-history-cap", host, { calls });
  await intersect(ui, host, false); await intersect(ui, host);
  assert.equal(calls, 20);
  record("R1-history-reentry", host, { calls });
});

test("switch Bot while older response is pending discards the response", async (t) => {
  const ui = await loadBundle();
  const pending = Promise.withResolvers();
  const desktop = mockDesktop({ getLibraryTranscript: async ({ cursor, agentId }) => cursor === undefined ? { entries: [textEntry(agentId, -HOUR, "", [{ url: `file:///a/${agentId}.png`, alt: agentId }])] } : pending.promise });
  const host = document.createElement("div"); document.body.append(host);
  const root = ui.createRoot(host);
  t.after(async () => { await ui.act(async () => root.unmount()); host.remove(); });
  await ui.act(async () => root.render(ui.createElement(ui.LibraryHost, { agentId: "A", desktop })));
  await intersect(ui, host);
  await ui.act(async () => root.render(ui.createElement(ui.LibraryHost, { agentId: "B", desktop })));
  await ui.act(async () => pending.resolve({ entries: [textEntry("late", -HOUR, "", [{ url: "file:///a/late.png", alt: "Late-A" }], { seq: 1 })] }));
  assert.doesNotMatch(host.textContent, /Late-A/);
  assert.equal(host.querySelector('[data-library-history]').dataset.libraryHistory, "loadable");
  record("R1-switch-pending", host, { staleAbsent: true, state: "loadable" });
});

test("live snapshots update and clear/removal invalidate pending page resolution", async (t) => {
  const ui = await loadBundle();
  let snapshot = { entries: baseEntries(), loadState: "ready", hasOlder: true, olderFailure: null };
  const listeners = new Set(), entriesObservers = new Set();
  let pending = Promise.withResolvers(), calls = 0;
  const transcript = {
    snapshotsFor: () => ({ get: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } }),
    observeEntries: (_id, observer) => { entriesObservers.add(observer); return () => entriesObservers.delete(observer); },
    load() {}, loadOlder: async () => {},
  };
  const desktop = mockDesktop({ transcript, resolveLibraryPages: () => { calls++; return pending.promise; } });
  const host = await renderHost(t, ui, desktop);
  await ui.act(async () => {
    snapshot = { ...snapshot, entries: [] };
    for (const observer of [...entriesObservers]) observer.onBaseline();
    for (const listener of [...listeners]) listener();
  });
  await ui.act(async () => pending.resolve([{ status: "found", page: { kind: "document", storeId: "store-s1", documentId: "doc-9", title: "Stale", visibility: "public" } }]));
  assert.doesNotMatch(host.textContent, /Today|Stale/);
  record("R1-clear-pending", host, { staleAbsent: true });
  await ui.act(async () => { snapshot = { ...snapshot, entries: [textEntry("fresh", -HOUR, "", [{ url: "file:///a/fresh.png", alt: "Fresh" }])] }; for (const listener of [...listeners]) listener(); });
  assert.match(host.textContent, /Fresh/);
  record("R1-live-update", host, { freshVisible: true });
  await ui.act(async () => { snapshot = { ...snapshot, entries: [] }; for (const observer of [...entriesObservers]) observer.onRemoved(); for (const listener of [...listeners]) listener(); });
  assert.doesNotMatch(host.textContent, /Fresh/);
  record("R1-removal", host, { removedAbsent: true });
});

test("host clipboard writes and rejects, canvas follows live desktop theme and restores focus", async (t) => {
  const ui = await loadBundle();
  const id = "123e4567-e89b-42d3-a456-426614174000";
  let changeTheme, fail = true; const copied = [];
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (value) => { if (fail) throw new Error("denied"); copied.push(value); } } } });
  t.after(() => Object.defineProperty(globalThis, "navigator", oldNavigator));
  const desktop = mockDesktop({
    theme: { initial: { resolved: "dark" }, onChanged: (fn) => { changeTheme = fn; return () => { changeTheme = null; }; } },
    getLibraryTranscript: async () => ({ entries: [textEntry("canvas", -HOUR, `${ORIGIN}/canvas/store-s1/${id}`)] }),
    resolveLibraryPages: async ({ refs }) => refs.map((ref) => ({ status: "found", ref, page: { ...ref, title: "Canvas", visibility: "private", updatedAtMs: NOW, canShareToTeam: false } })),
    getCanvasShare: async () => ({ storeId: "store-s1", canvasId: id, share: { visibility: "private", canShareToTeam: false } }),
  });
  const host = await renderHost(t, ui, desktop);
  const row = [...host.querySelectorAll("li button")].find((b) => b.textContent.includes("Canvas"));
  await ui.act(async () => { row.focus(); row.click(); });
  assert.match(document.querySelector("iframe").src, /theme=dark/);
  record("R1-dark-theme", document.body, { src: document.querySelector("iframe").src });
  await ui.act(async () => changeTheme({ resolved: "light" }));
  assert.match(document.querySelector("iframe").src, /theme=light/);
  await ui.act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Share").click());
  await ui.act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Copy link").click());
  assert.ok([...document.querySelectorAll("button")].some((b) => b.textContent === "Failed to copy"));
  assert.deepEqual(copied, []);
  record("R1-clipboard-failed", document.body, { copied });
  fail = false;
  await ui.act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Failed to copy").click());
  assert.deepEqual(copied, [`${ORIGIN}/canvas/store-s1/${id}`]);
  record("R1-clipboard-written", document.body, { copied });
  await ui.act(async () => document.querySelector('[aria-label="Close page"]').click());
  assert.equal(document.activeElement, row);
  record("R1-focus-restored", host, { focused: document.activeElement.textContent });
});

test("snapshot olderFailure after resolved loadOlder remains retryable and unsubscribes", async (t) => {
  const ui = await loadBundle();
  const listeners = new Set(), events = new Set();
  let snapshot = { entries: baseEntries(), loadState: "ready", hasOlder: true, olderFailure: null };
  let calls = 0;
  const transcript = {
    snapshotsFor: () => ({ get: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } }),
    observeEntries: (_id, value) => { events.add(value); return () => events.delete(value); },
    load() {},
    loadOlder: async () => { calls++; snapshot = { ...snapshot, hasOlder: calls === 1, olderFailure: calls === 1 ? { code: "offline" } : null }; for (const listener of [...listeners]) listener(); },
  };
  const desktop = mockDesktop({ transcript });
  const host = document.createElement("div"); document.body.append(host);
  const root = ui.createRoot(host);
  try {
    await ui.act(async () => root.render(ui.createElement(ui.LibraryHost, { agentId: "A", desktop })));
    await intersect(ui, host);
    assert.equal(host.querySelector('[data-library-history]').dataset.libraryHistory, "failed");
    await ui.act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "加载失败，重试").click());
    assert.equal(host.querySelector('[data-library-history]').dataset.libraryHistory, "exhausted");
    assert.equal(calls, 2);
    record("R1-snapshot-failure", host, { calls, finalState: "exhausted" });
  } finally { await ui.act(async () => root.unmount()); host.remove(); }
  assert.equal(listeners.size, 0); assert.equal(events.size, 0);
  record("R1-subscription-teardown", document.body, { snapshots: listeners.size, entries: events.size });
});

test("loading text renders an ellipsis while gates are pending", async (t) => {
  const ui = await loadBundle();
  const gate = Promise.withResolvers();
  const host = await renderHost(t, ui, mockDesktop({ checkGate: () => gate.promise }));
  assert.match(host.textContent, /正在加载资料…/);
  assert.doesNotMatch(host.textContent, /\\u2026/);
  record("R1-loading-text", host, { literalEscapeAbsent: true });
  await ui.act(async () => gate.resolve(false));
});

test("mount consumes complete live snapshots, actual media DTO and original source", async (t) => {
  const ui = await loadBundle();
  let snapshot = { entries: baseEntries(), loadState: "ready", hasOlder: false, olderFailure: null };
  const listeners = new Set(), events = new Set(), received = [];
  const transcript = {
    snapshotsFor: () => ({ get: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } }),
    observeEntries: (_id, value) => { events.add(value); return () => events.delete(value); }, load() {}, loadOlder: async () => {},
  };
  globalThis.Qe = () => ({ transcript });
  window.desktop = {
    experiments: { checkGate: async () => false },
    theme: { initial: { resolved: "dark" }, onChanged: () => () => {} },
    library: { getLibraryOrigin: async () => ORIGIN, getLibraryTranscript: async () => { throw new Error("one-shot transcript must not run"); } },
    resolveAttachmentMedia: async (source) => { received.push(source); return { kind: "image", src: "data:image/png;base64,aGVsbG8=" }; },
  };
  const host = document.createElement("div"); document.body.append(host); const root = ui.createRoot(host);
  try {
    await ui.act(async () => root.render(ui.createElement(ui.RLibraryHost, { agentId: "A" })));
    assert.match(host.textContent, /Today/);
    assert.equal(host.querySelector("img").getAttribute("src"), "data:image/png;base64,aGVsbG8=");
    assert.ok(received.includes("file:///a/today.png"));
    await ui.act(async () => { snapshot = { ...snapshot, entries: [] }; for (const event of [...events]) event.onBaseline(); for (const listener of [...listeners]) listener(); });
    assert.doesNotMatch(host.textContent, /Today/);
    record("R1-mount-live-media", host, { received, cleared: true });
  } finally { await ui.act(async () => root.unmount()); host.remove(); delete globalThis.Qe; delete window.desktop; }
  assert.equal(listeners.size, 0); assert.equal(events.size, 0);
});

test("document save title updates the row and refreshes page metadata", async (t) => {
  const ui = await loadBundle();
  let title = "Before", reads = 0, saved = null;
  const desktop = mockDesktop({
    getLibraryTranscript: async () => ({ entries: [textEntry("doc", -HOUR, `${ORIGIN}/documents/store-s1/doc-9`)] }),
    resolveLibraryPages: async ({ refs }) => { reads++; return refs.map((ref) => ({ status: "found", ref, page: { ...ref, title, visibility: "private", updatedAtMs: NOW } })); },
    getDocument: async () => ({ source: "# Before", share: null }),
    getDocumentEditRight: async () => ({ canEdit: true }),
    saveDocument: async ({ source }) => { saved = source; title = "Renamed"; return { title }; },
  });
  const host = await renderHost(t, ui, desktop);
  await ui.act(async () => [...host.querySelectorAll("li button")].find((b) => b.textContent.includes("Before")).click());
  const body = document.querySelector('[contenteditable="true"]');
  assert.ok(body?.editor, "actual Tiptap editor mounted");
  await ui.act(async () => body.editor.commands.setContent("<h1>Renamed</h1>", { emitUpdate: true }));
  await ui.act(async () => body.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })));
  assert.equal(saved?.trim(), "# Renamed");
  assert.ok([...host.querySelectorAll("li button")].some((b) => b.textContent.includes("Renamed")));
  assert.ok(reads >= 2);
  record("R1-title-save", host, { saved, title, metadataReads: reads });
});

test("file reads and downloads preserve the original non-file-URL locator", async (t) => {
  const ui = await loadBundle();
  const source = "/home/box/agent-data/original.txt", seen = [];
  const desktop = mockDesktop({
    getLibraryTranscript: async () => ({ entries: [{ id: "file", kind: "send-message", timestampMs: NOW - HOUR, seq: 999, message: { type: "attachment", url: source, file_name: "Original.txt" } }] }),
    readAttachmentBytes: async (path, cap) => { seen.push({ method: "read", path, cap }); return { kind: "bytes", bytes: new TextEncoder().encode("Original bytes") }; },
    downloadAttachment: async (path, name) => { seen.push({ method: "download", path, name }); return true; },
  });
  const host = await renderHost(t, ui, desktop);
  await ui.act(async () => [...host.querySelectorAll("li button")].find((b) => b.textContent.includes("Original.txt")).click());
  assert.match(document.body.textContent, /Original bytes/);
  await ui.act(async () => document.querySelector('[aria-label="下载"]').click());
  assert.deepEqual(seen.map((call) => [call.method, call.path]), [["read", source], ["download", source]]);
  record("R1-original-source", document.body, { seen });
});

test("library file preview owns close even when a native Open chip is in the transcript", async (t) => {
  const ui = await loadBundle();
  const source = "/home/box/agent-data/report.docx";
  let chipClicks = 0;
  const transcript = document.createElement("div");
  transcript.className = "sand-transcript";
  const chip = document.createElement("button");
  chip.setAttribute("aria-label", "Open report.docx");
  chip.addEventListener("click", () => { chipClicks += 1; });
  transcript.append(chip);
  document.body.append(transcript);
  t.after(() => transcript.remove());
  const desktop = mockDesktop({
    getLibraryTranscript: async () => ({ entries: [{ id: "docx", kind: "send-message", timestampMs: NOW - HOUR, seq: 1001, message: { type: "attachment", url: source, file_name: "report.docx" } }] }),
    readAttachmentBytes: async () => ({ kind: "bytes", bytes: new Uint8Array([0x50, 0x4b]) }),
    downloadAttachment: async () => true,
  });
  const host = await renderHost(t, ui, desktop);
  await ui.act(async () => [...host.querySelectorAll("li button")].find((b) => b.textContent.includes("report.docx")).click());
  assert.equal(chipClicks, 0, "must not replay the native Open chip (stale lkn onClose)");
  const dialog = document.querySelector(".sand-file-viewer");
  assert.ok(dialog !== null, "library-owned sand-file-viewer must open");
  assert.ok(dialog.querySelector('[aria-label="下载"]'), "download control present");
  assert.ok(dialog.querySelector('[aria-label="关闭"]'), "close control present");
  await ui.act(async () => dialog.querySelector('[aria-label="关闭"]').click());
  assert.equal(document.querySelector(".sand-file-viewer"), null, "close must unmount the library viewer");
  record("R1-library-owned-file-close", host, { chipClicks });
});

test("visibility echo refreshes host page rows", async (t) => {
  const ui = await loadBundle();
  let visibility = "private", reads = 0;
  const desktop = mockDesktop({
    getLibraryTranscript: async () => ({ entries: [textEntry("doc", -HOUR, `${ORIGIN}/documents/store-s1/doc-9`)] }),
    resolveLibraryPages: async ({ refs }) => { reads++; return refs.map((ref) => ({ status: "found", ref, page: { ...ref, title: "Shared", visibility, canShareToTeam: true, updatedAtMs: NOW } })); },
    setDocumentVisibility: async () => { visibility = "team"; return "team-view"; },
  });
  const host = await renderHost(t, ui, desktop);
  await ui.act(async () => host.querySelector('[aria-label="更多操作: Shared"]').click());
  await ui.act(async () => [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === "分享…").click());
  await ui.act(async () => document.querySelector('[aria-label="Who can access"]').click());
  await ui.act(async () => [...document.querySelectorAll('[role="option"]')].find((item) => item.textContent === "Team").click());
  assert.match(host.querySelector('[data-library-page]').textContent, /团队/);
  assert.equal(reads, 2);
  record("R1-visibility-refresh", host, { visibility, metadataReads: reads });
});

test("baseline during pending history cannot restore cleared entries or history state", async (t) => {
  const ui = await loadBundle();
  const pending = Promise.withResolvers(), listeners = new Set(), events = new Set();
  let snapshot = { entries: baseEntries(), loadState: "ready", hasOlder: true, olderFailure: null };
  const transcript = {
    snapshotsFor: () => ({ get: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } }),
    observeEntries: (_id, value) => { events.add(value); return () => events.delete(value); },
    load() {}, loadOlder: () => pending.promise,
  };
  const host = await renderHost(t, ui, mockDesktop({ transcript }));
  await intersect(ui, host);
  await ui.act(async () => {
    snapshot = { ...snapshot, entries: [], hasOlder: false };
    for (const event of [...events]) event.onBaseline();
    for (const listener of [...listeners]) listener();
  });
  await ui.act(async () => pending.resolve());
  assert.doesNotMatch(host.textContent, /Today|Spec/);
  assert.equal(host.querySelector('[data-library-history]').dataset.libraryHistory, "exhausted");
  record("R1-clear-history", host, { oldRowsAbsent: true, history: "exhausted" });
});

test("gateway asset bytes decode through the host path and render inline", async (t) => {
  const ui = await loadBundle();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const desktop = mockDesktop({
    getLibraryTranscript: async () => ({ entries: [textEntry("doc", -HOUR, "open " + ORIGIN + "/documents/store-s1/doc-9")] }),
    resolveLibraryPages: async ({ refs }) => refs.map((ref) => ({ status: "found", ref, page: { ...ref, title: "AssetDoc", visibility: "private", updatedAtMs: NOW } })),
    getDocument: async () => ({ source: "# AssetDoc" + "\n\n![logo](asset:logo.png)", share: null }),
    getDocumentEditRight: async () => ({ canEdit: false }),
    getDocumentAssets: async () => ({ assets: [{ name: "logo.png", status: "ready", bytes: { $b64: png }, contentType: "image/png", etag: null }] }),
  });
  const host = await renderHost(t, ui, desktop);
  await ui.act(async () => [...host.querySelectorAll("li button")].find((b) => b.textContent.includes("AssetDoc")).click());
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const img = document.querySelector('img[src^="data:image/png;base64,"]');
  assert.ok(img, "ready gateway asset bytes render inline as a data URL");
  assert.ok(img.getAttribute("src").includes(png));
  record("R1-asset-inline", host, { inline: true });
});

test("native doc opens as a body-level stage dialog and closes with focus", async (t) => {
  const ui = await loadBundle();
  const desktop = mockDesktop({
    getLibraryTranscript: async () => ({ entries: [textEntry("doc", -HOUR, "open " + ORIGIN + "/documents/store-s1/doc-9")] }),
    resolveLibraryPages: async ({ refs }) => refs.map((ref) => ({ status: "found", ref, page: { ...ref, title: "StageDoc", visibility: "private", updatedAtMs: NOW } })),
    getDocument: async () => ({ source: "# StageDoc", share: null }),
    getDocumentEditRight: async () => ({ canEdit: false }),
  });
  const host = await renderHost(t, ui, desktop);
  const row = [...host.querySelectorAll("li button")].find((b) => b.textContent.includes("StageDoc"));
  await ui.act(async () => { row.focus(); row.click(); });
  await ui.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const dialog = document.querySelector('[role="dialog"][aria-label="StageDoc"]');
  assert.ok(dialog, "doc stage is a labelled dialog");
  assert.ok(document.querySelector('[data-library-page-stage="document"]'), "stage carries the page-stage marker");
  assert.equal(host.contains(dialog), false, "stage mounts outside the list section");
  assert.equal(host.contains(document.activeElement), false, "focus moved into the stage");
  await ui.act(async () => { const closeBtn = dialog.querySelector('button[aria-label="Close document"]'); assert.ok(closeBtn, "stage header closes through the icon button"); closeBtn.click(); });
  assert.equal(document.querySelector('[data-library-page-stage="document"]'), null);
  assert.equal(document.activeElement, row, "close restores focus to the row");
  record("R1-doc-stage", host, { portal: true, focusRestored: true });
});

test("teardown releases the shared DOM", async () => {
  assert.equal(observers.size, 0);
  await closeLibraryDom(window);
  if (evidence) writeFileSync(path.join(evidence, "R1-teardown.json"), JSON.stringify({ observers: observers.size, domClosed: true, messagePortsClosed: true }));
});
