import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { closeLibraryDom } from "./library-dom-teardown.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = process.env.TASK12_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const window = new Window({ settings: { enableJavaScriptEvaluation: false, disableIframePageLoading: true } });
for (const name of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle"]) {
  globalThis[name] = name === "window" ? window : name === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `
  export {createElement, act} from 'react';
  export {createRoot} from 'react-dom/client';
  export {CanvasStage} from './frontend/src/recovered/features/library/canvas-stage';
  export {LibraryPageMenu} from './frontend/src/recovered/features/library/page-menu';
  export {PageShare, pageShare} from './frontend/src/recovered/features/library/page-share';
  export {bindLibraryPageProvider} from './frontend/src/recovered/features/library/canvas-provider';
  export {createCanvasService} from './source/host/extensions/library/canvas-service';
`, resolveDir: root, loader: "tsx" }, bundle: true, platform: "node", format: "esm", write: false, loader: { ".css": "empty" } });
const { createElement: h, act, createRoot, CanvasStage, LibraryPageMenu, PageShare, pageShare, bindLibraryPageProvider, createCanvasService } =
  await import("data:text/javascript;base64," + Buffer.from(output.outputFiles[0].text).toString("base64"));
const canvasId = "123e4567-e89b-42d3-a456-426614174000";
const secondId = "123e4567-e89b-42d3-a456-426614174001";
const storeId = "node-store:task-12";
const origin = "https://library.example.test";
const locator = { kind: "store", storeId, canvasId };
const snapshot = { storeId, canvasId, share: { visibility: "private", canShareToTeam: true } };
const identity = { providerOrigin: origin, ref: { kind: "canvas", storeId, canvasId } };
const page = { ...identity.ref, title: "Canvas report", visibility: "private", canShareToTeam: true, createdAtMs: null, updatedAtMs: null };
const deferred = () => Promise.withResolvers();
const buttons = () => [...document.querySelectorAll("button")];
const button = text => buttons().find(item => item.textContent === text || item.getAttribute("aria-label") === text);
const item = text => [...document.querySelectorAll('[role="menuitem"], [role="option"]')].find(node => node.textContent.startsWith(text));
const click = async node => { assert.ok(node, "control exists"); await act(async () => node.click()); };
const record = (name, observable) => {
  if (!evidence) return;
  writeFileSync(path.join(evidence, name + ".html"), document.body.innerHTML);
  writeFileSync(path.join(evidence, name + ".json"), JSON.stringify({ scenario: name, observable, pass: true }, null, 2));
};
function setup(t, overrides = {}) {
  const calls = { copied: [], opened: [], writes: [] };
  const provider = { getCanvasShare: async () => snapshot,
    setCanvasVisibility: async args => { calls.writes.push(args); return args.visibility; },
    setDocumentVisibility: async args => { calls.writes.push(args); return args.visibility; }, ...overrides };
  const links = { config: { nodeOrigin: origin }, copyLink: async href => { calls.copied.push(href); }, openExternal: href => calls.opened.push(href) };
  const host = document.createElement("div"); document.body.append(host);
  const react = createRoot(host);
  t.after(async () => { await act(async () => react.unmount()); host.remove(); });
  return { provider, links, calls, render: async element => { await act(async () => react.render(element)); },
    stage: extra => h(CanvasStage, { locator, providerOrigin: origin, provider, links, title: page.title, theme: "light", onClose() {}, ...extra }) };
}

test("metadata loading/ready/error remains independent of iframe onLoad; theme and revision remount", async t => {
  const read = deferred();
  const f = setup(t, { getCanvasShare: () => read.promise });
  await f.render(f.stage());
  assert.equal(document.querySelector("[data-share-state]").dataset.shareState, "loading");
  const frame = document.querySelector("iframe");
  assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
  assert.equal(frame.referrerPolicy, "no-referrer");
  await act(async () => frame.dispatchEvent(new window.Event("load")));
  assert.equal(document.querySelector("[data-frame-state]").dataset.frameState, "loaded");
  assert.equal(document.querySelector("[data-share-state]").dataset.shareState, "loading");
  record("load-independent", { frame: "loaded", share: "loading" });
  await act(async () => read.resolve(snapshot));
  assert.equal(document.querySelector("[data-share-state]").dataset.shareState, "ready");
  assert.ok(button("Share"));
  await f.render(f.stage({ theme: "dark", revision: "v2" }));
  const refreshed = document.querySelector("iframe");
  assert.notEqual(refreshed, frame);
  assert.match(refreshed.src, /theme=dark&rev=v2$/);
  assert.equal(document.querySelector("[data-frame-state]").dataset.frameState, "loading");
  assert.equal(document.querySelector("[data-share-state]").dataset.shareState, "ready");
  record("refresh", { frame: "loading", share: "ready", src: refreshed.src });
});

test("failed metadata does not block a loaded canvas; null share offers external open", async t => {
  const f = setup(t, { getCanvasShare: async () => { throw new Error("metadata unavailable"); } });
  await f.render(f.stage());
  await act(async () => document.querySelector("iframe").dispatchEvent(new window.Event("load")));
  assert.equal(document.querySelector("[data-share-state]").dataset.shareState, "error");
  assert.equal(button("Sharing unavailable").disabled, true);
  record("metadata-error", { share: "error", frame: "loaded", shareDisabled: true });
  await f.render(f.stage({ provider: { ...f.provider, getCanvasShare: async () => ({ ...snapshot, share: null }) } }));
  assert.equal(button("Share"), undefined);
  await click(button("Open in browser"));
  assert.deepEqual(f.calls.opened, [`${origin}/canvas/node-store%3Atask-12/${canvasId}`]);
  record("null-share-open", { opened: f.calls.opened });
});

test("retired metadata requests cannot replace the newly selected canvas", async t => {
  const first = deferred(), second = deferred();
  const f = setup(t, { getCanvasShare: ({ locator: target }) => target.canvasId === canvasId ? first.promise : second.promise });
  await f.render(f.stage());
  await f.render(f.stage({ locator: { ...locator, canvasId: secondId } }));
  await act(async () => second.resolve({ ...snapshot, canvasId: secondId, share: null }));
  await act(async () => first.resolve(snapshot));
  assert.equal(button("Share"), undefined);
  await click(button("Open in browser"));
  assert.ok(f.calls.opened[0].endsWith(secondId));
  record("stale-read", { opened: f.calls.opened });
});

test("canvas and document page menus expose Open always and Share only for private/team", async t => {
  const f = setup(t);
  let opens = 0;
  const observed = [];
  for (const kind of ["canvas", "document"]) for (const visibility of ["private", "team", "public", "unknown"]) {
    const target = { ...page, kind, documentId: "document-12", visibility };
    await f.render(h(LibraryPageMenu, { key: kind + visibility, page: target, providerOrigin: origin,
      provider: f.provider, links: f.links, onOpen: () => opens++, onVisibilityChange() {} }));
    await click(button(`更多操作: ${page.title}`));
    const sharing = visibility === "private" || visibility === "team";
    assert.equal(Boolean(item("分享…")), sharing);
    assert.equal(pageShare(target) !== null, sharing);
    assert.ok(item("打开"));
    assert.doesNotMatch(document.body.textContent, /Export|Edit canvas|Filter/);
    record(`menu-${kind}-${visibility}`, { open: true, share: sharing });
    observed.push({ kind, visibility, sharing });
    await click(item("打开"));
  }
  assert.equal(opens, 8);
  record("menu-matrix", { opens, observed });
});

test("share access is server-confirmed, disables duplicate writes, recovers from rejection, and uses shared links", async t => {
  let write = deferred();
  const f = setup(t, { setCanvasVisibility: args => { f.calls.writes.push(args); return write.promise; } });
  await f.render(f.stage());
  await click(button("Share"));
  await click(button("Who can access"));
  assert.deepEqual([...document.querySelectorAll('[role="option"]')].map(node => node.textContent), ["Private✓", "Team"]);
  await click(item("Team"));
  assert.equal(button("Who can access").disabled, true);
  assert.match(button("Who can access").textContent, /Private/);
  await act(async () => write.reject(new Error("denied")));
  assert.match(document.querySelector('[role="alert"]').textContent, /Failed/);
  assert.equal(button("Who can access").disabled, false);
  record("write-rejected", { displayed: "Private", failed: true, writes: f.calls.writes });
  write = deferred();
  await click(button("Who can access")); await click(item("Team"));
  await act(async () => write.resolve("team-view"));
  assert.match(button("Who can access").textContent, /Team/);
  assert.equal(document.querySelector('[role="alert"]'), null);
  await click(button("Copy link")); await click(button("Open in browser"));
  assert.equal(button("Copied").textContent, "Copied");
  assert.deepEqual(f.calls.copied, f.calls.opened);
  assert.deepEqual(f.calls.opened, [`${origin}/canvas/node-store%3Atask-12/${canvasId}`]);
  assert.equal(f.calls.writes.length, 2);
  record("write-and-links", f.calls);
});

test("team unavailable is disabled; document sharing calls the document provider", async t => {
  const f = setup(t);
  let changed;
  const render = share => f.render(h(PageShare, { identity: { providerOrigin: origin, ref: { kind: "document", storeId, documentId: "document-12" } },
    title: "Document", share, provider: f.provider, links: f.links, onShareChange: value => { changed = value; }, open: true }));
  await render({ visibility: "private", canShareToTeam: false });
  await click(button("Who can access"));
  assert.equal(item("Team").getAttribute("aria-disabled"), "true");
  await click(item("Team"));
  assert.equal(f.calls.writes.length, 0);
  assert.equal(document.querySelectorAll('[role="option"]').length, 2);
  record("team-disabled", { teamDisabled: true, writeCount: 0, optionCount: 2 });
  await render({ visibility: "private", canShareToTeam: true });
  await click(item("Team"));
  assert.deepEqual(changed, { visibility: "team-view", canShareToTeam: true });
  assert.deepEqual(f.calls.writes[0], { locator: { storeId, documentId: "document-12" }, visibility: "team-view" });
  await click(button("Copy link"));
  assert.deepEqual(f.calls.copied, [`${origin}/documents/node-store%3Atask-12/document-12`]);
  record("document-share", f.calls);
});

test("UI actions traverse the actual canvas service with trusted context and validated server echo", async t => {
  const context = { providerOrigin: origin, principal: { accountId: "trusted-account", principalId: "trusted-user", teamIds: ["trusted-team"] }, signal: new AbortController().signal };
  const seen = [];
  let visibility = "CANVAS_VISIBILITY_PRIVATE";
  const service = createCanvasService({
    getCanvasMetadata: async (args, ctx) => { assert.equal(ctx, context); seen.push({ method: "read", args });
      return { metadata: { ...args, share: { visibility, canShareToTeam: true } } }; },
    setCanvasVisibility: async (args, ctx) => { assert.equal(ctx, context); seen.push({ method: "write", args });
      visibility = args.visibility === "private" ? "CANVAS_VISIBILITY_PRIVATE" : "CANVAS_VISIBILITY_TEAM_VIEW";
      return { visibility }; },
  }, { dataRoot: root });
  const provider = bindLibraryPageProvider({ ...service, setDocumentVisibility: async () => "private" }, () => context);
  const f = setup(t, provider);
  await f.render(f.stage());
  await click(button("Share")); await click(button("Who can access")); await click(item("Team"));
  assert.match(button("Who can access").textContent, /Team/);
  assert.equal((await provider.getCanvasShare({ locator })).share.visibility, "team-view");
  await assert.rejects(provider.setCanvasVisibility({ locator, visibility: "public" }));
  assert.equal(seen.filter(call => call.method === "write").length, 1);
  assert.deepEqual(Object.keys(seen[1].args).sort(), ["canvasId", "storeId", "visibility"]);
  record("trusted-service", { seen, trustedAccount: context.principal.accountId, persisted: visibility, publicRejected: true });
});

test("teardown releases the shared DOM", async () => {
  await closeLibraryDom(window);
});
