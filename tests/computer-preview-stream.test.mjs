import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "acorn";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as compiler from "react/compiler-runtime";
import { Window } from "happy-dom";
import { PREVIEW_POOL_FIXTURE, VNC_VIEW_FIXTURE } from "./fixtures/computer-preview-pool.mjs";
import { computerSleepOverlayRuntime, loadOfficialAsleepArtifacts, loadOfficialShapeSvgs } from "../scripts/lib/computer-sleep-renderer-components.mjs";
import { patchComputerSleepRenderer } from "../scripts/lib/computer-sleep-renderer-patch.mjs";
import { patchComputerPreviewStream } from "../scripts/lib/computer-preview-stream-renderer-patch.mjs";

const canonicalPath = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets/index-UbX-y3il.js");

test("canonical retained monitor thumbnails pause at the shared VNC viewer boundary while interactive refs remain intact", { skip: existsSync(canonicalPath) ? false : "Bootstrap the pinned renderer to run canonical viewer topology." }, async () => {
  const source = readFileSync(canonicalPath, "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const names = ["dbn", "X8n", "mbn", "JTn"];
  const nodes = ast.body.filter(node => node.type === "FunctionDeclaration" && names.includes(node.id.name));
  assert.equal(nodes.length, names.length);
  const topology = nodes.map(node => source.slice(node.start, node.end)).join("\n");
  const window = new Window();
  const saved = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of [["window", window], ["document", window.document], ["IS_REACT_ACT_ENVIRONMENT", true]]) Object.defineProperty(globalThis, key, { configurable: true, value });
  const sessions = new Set();
  function VncSession({ src, ref }) {
    React.useEffect(() => { sessions.add(src); return () => sessions.delete(src); }, [src]);
    return jsx.jsx("webview", { src, ref });
  }
  Object.assign(window, { S: React, p: jsx, he: compiler, VncSession, nbn: 3, re: (...classes) => classes.join(" "), H5e: () => ({ width: 1280, height: 800 }), bZ: () => null, Fe: () => ({ className: "" }), Ut: { label: {} }, z1t: { captionText: {} } });
  window.eval(patchComputerPreviewStream(VNC_VIEW_FIXTURE + topology) + "\nwindow.Pool=dbn;window.Thumbnail=mbn;window.KeepViewer=JTn;window.Viewer=DAe;");
  const { createRoot } = await import("react-dom/client");
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const interactiveRef = React.createRef();
  function App({ src, open, viewerVisible = true }) {
    const retained = window.KeepViewer({ isViewerOpen: open, isInfoPaneOpen: true });
    return jsx.jsxs(React.Fragment, { children: [
      jsx.jsx(window.Pool, { src }),
      retained ? jsx.jsx(window.Thumbnail, { monitor: { vncUrl: "thumbnail-B", subagentId: "B", title: "B" }, onFocus: () => {} }) : null,
      jsx.jsx(window.Viewer, { src: "interactive", isInteractive: true, isViewerVisible: viewerVisible, ref: interactiveRef }),
    ] });
  }
  try {
    await React.act(async () => root.render(jsx.jsx(App, { src: "preview-A", open: true })));
    await React.act(async () => root.render(jsx.jsx(App, { src: "preview-C", open: false })));
    assert.deepEqual([...sessions].sort(), ["interactive", "preview-A", "preview-C", "thumbnail-B"]);
    const interactiveNode = interactiveRef.current;
    assert.ok(interactiveNode);
    await React.act(async () => { window.__rCompPreviewAsleep = true; window.dispatchEvent(new window.Event("grok-node-preview-stream-state")); });
    assert.deepEqual([...sessions], ["interactive"], "retained thumbnails must release their preview sessions too");
    assert.equal(interactiveRef.current, interactiveNode);
    await React.act(async () => root.render(jsx.jsx(App, { src: "preview-D", open: false })));
    assert.deepEqual([...sessions], ["interactive"]);
    await React.act(async () => { window.__rCompPreviewAsleep = false; window.dispatchEvent(new window.Event("grok-node-preview-stream-state")); });
    assert.deepEqual([...sessions].sort(), ["interactive", "preview-D", "thumbnail-B"]);
    assert.equal(interactiveRef.current, interactiveNode);
    await React.act(async () => { window.__rCompPreviewAsleep = true; window.dispatchEvent(new window.Event("grok-node-preview-stream-state")); root.render(jsx.jsx(App, { src: "preview-D", open: false, viewerVisible: false })); });
    assert.deepEqual([...sessions], [], "a retained fullscreen viewer must release its stream when it is hidden and previews are paused");
    assert.equal(interactiveRef.current, null);
    await React.act(async () => root.render(jsx.jsx(App, { src: "preview-D", open: false, viewerVisible: true })));
    assert.deepEqual([...sessions], ["interactive"], "opening fullscreen while previews are paused must allow interactive viewing");
    assert.ok(interactiveRef.current);
  } finally {
    await React.act(async () => root.unmount());
    assert.equal(interactiveRef.current, null);
    window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("Sleep releases active and warm preview sessions; Restore connects the current Bot without interrupting interactive sessions", async () => {
  const [stage, shapes] = await Promise.all([loadOfficialAsleepArtifacts(), loadOfficialShapeSvgs()]);
  const window = new Window();
  const savedGlobals = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: window.document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const sessions = new Set();
  let closed = 0;
  function VncSession({ src }) {
    React.useEffect(() => {
      sessions.add(src);
      return () => { sessions.delete(src); closed += 1; };
    }, [src]);
    return jsx.jsx("webview", { src });
  }
  let state = "awake";
  window.desktop = { computer: { getSleepState: async () => state, sleep: async () => state = "asleep", wake: async () => state = "awake" } };
  window.S = React;
  window.p = jsx;
  window.re = (...classes) => classes.join(" ");
  window.VncSession = VncSession;
  window.setTimeout = callback => { queueMicrotask(callback); return 1; };
  let refresh;
  window.setInterval = callback => { refresh = callback; return 1; };
  const runtime = computerSleepOverlayRuntime(stage.html, shapes, "\uf46f");
  window.eval(patchComputerSleepRenderer(PREVIEW_POOL_FIXTURE, runtime) + "\nwindow.PreviewPool=dbn;");
  const { createRoot } = await import("react-dom/client");
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  function App({ src }) {
    return jsx.jsxs(React.Fragment, { children: [
      jsx.jsxs("div", { className: "sand-computer-preview__frame", children: [
        jsx.jsx(window.PreviewPool, { src }),
        jsx.jsx("button", { className: "sand-computer-preview__open", children: jsx.jsxs("span", { children: [jsx.jsx("i", { "data-icon-name": "arrows-expand-simple" }), "打开"] }) }),
      ] }, src),
      jsx.jsx(window.PreviewPool, { src: "interactive", isInteractive: true }, "interactive"),
    ] });
  }
  const previewSessions = () => [...sessions].filter(src => src.startsWith("preview-"));
  try {
    await React.act(async () => { root.render(jsx.jsx(App, { src: "preview-A" })); window.document.dispatchEvent(new window.Event("DOMContentLoaded")); });
    await React.act(async () => refresh());
    assert.deepEqual(previewSessions().sort(), ["preview-A", "preview-A/warm"]);
    assert.ok(sessions.has("interactive"));
    await React.act(async () => {
      window.document.querySelector(".sand-computer-preview__frame").dispatchEvent(new window.Event("pointerenter"));
      window.document.getElementById("rcompsleep-pill-sleep").click();
    });
    assert.equal(state, "asleep");
    assert.deepEqual(previewSessions(), [], "Sleep must release preview sessions, not merely hide their pixels");
    assert.equal(closed, 2);
    assert.equal(window.document.querySelector(".sand-computer-preview__frame webview"), null);
    assert.ok(sessions.has("interactive"), "full-screen sessions are outside the preview pause scope");
    await React.act(async () => root.render(jsx.jsx(App, { src: "preview-B" })));
    assert.deepEqual(previewSessions(), [], "switching Bots while asleep must not reconnect a preview");
    assert.ok(window.document.getElementById("rcompsleep-wake"), "a replaced preview frame must show Restore without waiting for the polling timer");
    await React.act(async () => window.document.getElementById("rcompsleep-wake").click());
    assert.equal(state, "awake");
    assert.deepEqual(previewSessions().sort(), ["preview-B", "preview-B/warm"]);
    assert.ok(sessions.has("interactive"));
    assert.equal(window.document.getElementById("rcompsleep-stage"), null);
  } finally {
    await React.act(async () => root.unmount());
    window.close();
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
