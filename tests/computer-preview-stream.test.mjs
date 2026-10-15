import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "acorn";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as compiler from "react/compiler-runtime";
import { Window } from "happy-dom";
import { PREVIEW_POOL_FIXTURE, VNC_VIEW_FIXTURE, PREVIEW_OWNER_FIXTURE } from "./fixtures/computer-preview-pool.mjs";
import { computerSleepOverlayRuntime, loadOfficialAsleepArtifacts, loadOfficialShapeSvgs } from "../scripts/lib/computer-sleep-renderer-components.mjs";
import { patchComputerSleepRenderer } from "../scripts/lib/computer-sleep-renderer-patch.mjs";
import { patchComputerPreviewStream } from "../scripts/lib/computer-preview-stream-renderer-patch.mjs";

const canonicalPath = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets/index-UbX-y3il.js");
function setPreviewPaused(window, agentId, paused) {
  window.__rCompPreviewPausedBots ??= new Set();
  if (paused) window.__rCompPreviewPausedBots.add(agentId);
  else window.__rCompPreviewPausedBots.delete(agentId);
  window.dispatchEvent(new window.Event("grok-node-preview-stream-state"));
}

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
  window.eval(patchComputerPreviewStream(VNC_VIEW_FIXTURE + PREVIEW_OWNER_FIXTURE + topology) + "\nwindow.Pool=dbn;window.Thumbnail=mbn;window.KeepViewer=JTn;window.Viewer=DAe;window.Owner=bbn;");
  const { createRoot } = await import("react-dom/client");
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const interactiveRef = React.createRef();
  const peerRef = React.createRef();
  function App({ src, open, viewerVisible = true }) {
    const retained = window.KeepViewer({ isViewerOpen: open, isInfoPaneOpen: true });
    return jsx.jsxs(React.Fragment, { children: [jsx.jsx(window.Owner, { agentId: "bot-A", children: jsx.jsxs(React.Fragment, { children: [
      jsx.jsx(window.Pool, { src }),
      retained ? jsx.jsx(window.Thumbnail, { monitor: { vncUrl: "thumbnail-B", subagentId: "B", title: "B" }, onFocus: () => {} }) : null,
      jsx.jsx(window.Viewer, { src: "interactive", isInteractive: true, isViewerVisible: viewerVisible, ref: interactiveRef }),
    ] }) }), jsx.jsx(window.Owner, { agentId: "bot-B", children: jsx.jsx(window.Viewer, { src: "peer-B", ref: peerRef }) })] });
  }
  try {
    await React.act(async () => root.render(jsx.jsx(App, { src: "preview-A", open: true })));
    await React.act(async () => root.render(jsx.jsx(App, { src: "preview-C", open: false })));
    assert.deepEqual([...sessions].sort(), ["interactive", "peer-B", "preview-A", "preview-C", "thumbnail-B"]);
    const interactiveNode = interactiveRef.current;
    const peerNode = peerRef.current;
    assert.ok(interactiveNode);
    await React.act(async () => setPreviewPaused(window, "bot-A", true));
    assert.deepEqual([...sessions].sort(), ["interactive", "peer-B"], "A's retained thumbnails stop while B's independent preview continues");
    assert.equal(interactiveRef.current, interactiveNode);
    assert.equal(peerRef.current, peerNode);
    await React.act(async () => root.render(jsx.jsx(App, { src: "preview-D", open: false })));
    assert.deepEqual([...sessions].sort(), ["interactive", "peer-B"]);
    await React.act(async () => setPreviewPaused(window, "bot-A", false));
    assert.deepEqual([...sessions].sort(), ["interactive", "peer-B", "preview-D", "thumbnail-B"]);
    assert.equal(interactiveRef.current, interactiveNode);
    await React.act(async () => { setPreviewPaused(window, "bot-A", true); root.render(jsx.jsx(App, { src: "preview-D", open: false, viewerVisible: false })); });
    assert.deepEqual([...sessions], ["peer-B"], "A's hidden fullscreen closes without closing B's preview");
    assert.equal(interactiveRef.current, null);
    await React.act(async () => root.render(jsx.jsx(App, { src: "preview-D", open: false, viewerVisible: true })));
    assert.deepEqual([...sessions].sort(), ["interactive", "peer-B"], "opening fullscreen for A while paused preserves B's independent preview");
    assert.ok(interactiveRef.current);
    await React.act(async () => setPreviewPaused(window, "bot-B", true));
    assert.deepEqual([...sessions], ["interactive"], "B's own pause closes B without closing A's visible fullscreen");
    assert.equal(peerRef.current, null);
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

test("late A polling and Sleep replies cannot wake A or cover B after switching Bots", async () => {
  const [stage, shapes] = await Promise.all([loadOfficialAsleepArtifacts(), loadOfficialShapeSvgs()]);
  const window = new Window();
  const states = new Map();
  let refresh;
  let delayReads = false;
  let finishRead;
  let finishSleep;
  let requestedBot;
  window.desktop = { computer: {
    getSleepState: agentId => {
      const snapshot = states.get(agentId) ?? "awake";
      return delayReads ? new Promise(resolve => { finishRead = () => resolve(snapshot); }) : Promise.resolve(snapshot);
    },
    sleep: agentId => { requestedBot = agentId; return new Promise(resolve => { finishSleep = () => { states.set(agentId, "asleep"); resolve("asleep"); }; }); },
    wake: async agentId => { states.delete(agentId); return "awake"; },
  } };
  window.setTimeout = callback => { queueMicrotask(callback); return 1; };
  window.setInterval = callback => { refresh = callback; return 1; };
  window.document.body.innerHTML = '<div class="sand-computer-preview__frame" data-preview-bot-id="bot-A"><div class="sand-box-vnc-pool"></div><button class="sand-computer-preview__open"><span><i data-icon-name="arrows-expand-simple"></i>打开</span></button></div>';
  const frame = window.document.querySelector(".sand-computer-preview__frame");
  try {
    window.eval(computerSleepOverlayRuntime(stage.html, shapes, "\uf46f"));
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await new Promise(resolve => setImmediate(resolve));
    delayReads = true;
    refresh();
    frame.dispatchEvent(new window.Event("pointerenter"));
    window.document.getElementById("rcompsleep-pill-sleep").click();
    assert.equal(requestedBot, "bot-A");
    frame.setAttribute("data-preview-bot-id", "bot-B");
    window.dispatchEvent(new window.Event("grok-node-preview-stream-mounted"));
    finishSleep();
    await new Promise(resolve => setImmediate(resolve));
    finishRead();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(window.__rCompPreviewPausedBots.has("bot-A"), true, "the old awake poll must not undo A's Sleep");
    assert.equal(window.__rCompPreviewPausedBots.has("bot-B"), false);
    assert.equal(window.document.getElementById("rcompsleep-stage"), null, "A's late Sleep reply must not cover B");
    frame.setAttribute("data-preview-bot-id", "bot-A");
    window.dispatchEvent(new window.Event("grok-node-preview-stream-mounted"));
    assert.ok(window.document.getElementById("rcompsleep-wake"));
  } finally {
    window.close();
  }
});

test("sleeping A permits B's preview, remembers A on return and does not wake B when A restores", async () => {
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
  const states = new Map();
  window.desktop = { computer: { getSleepState: async agentId => states.get(agentId) ?? "awake", sleep: async agentId => { states.set(agentId, "asleep"); return "asleep"; }, wake: async agentId => { states.delete(agentId); return "awake"; } } };
  window.S = React;
  window.p = jsx;
  window.re = (...classes) => classes.join(" ");
  window.VncSession = VncSession;
  window.setTimeout = callback => { queueMicrotask(callback); return 1; };
  let refresh;
  window.setInterval = callback => { refresh = callback; return 1; };
  const runtime = computerSleepOverlayRuntime(stage.html, shapes, "\uf46f");
  window.eval(patchComputerSleepRenderer(PREVIEW_POOL_FIXTURE, runtime) + "\nwindow.PreviewPool=dbn;window.PreviewFrame=_bn;window.Owner=bbn;");
  const { createRoot } = await import("react-dom/client");
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  function App({ src }) {
    return jsx.jsxs(React.Fragment, { children: [
      jsx.jsx(window.PreviewFrame, { agentId: src === "preview-A" ? "bot-A" : "bot-B", src }),
      jsx.jsx(window.Owner, { agentId: "bot-C", children: jsx.jsx(window.PreviewPool, { src: "interactive", isInteractive: true }) }),
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
    assert.equal(states.get("bot-A"), "asleep");
    assert.deepEqual(previewSessions(), [], "Sleep must release preview sessions, not merely hide their pixels");
    assert.equal(closed, 2);
    assert.equal(window.document.querySelector(".sand-computer-preview__frame webview"), null);
    assert.ok(sessions.has("interactive"), "full-screen sessions are outside the preview pause scope");
    await React.act(async () => root.render(jsx.jsx(App, { src: "preview-B" })));
    assert.deepEqual(previewSessions().sort(), ["preview-B", "preview-B/warm"], "B is awake and must not inherit A's pause or cached URL");
    assert.equal(window.document.getElementById("rcompsleep-stage"), null);
    await React.act(async () => {
      window.document.querySelector(".sand-computer-preview__frame").dispatchEvent(new window.Event("pointerenter"));
      window.document.getElementById("rcompsleep-pill-sleep").click();
    });
    assert.equal(states.get("bot-B"), "asleep");
    await React.act(async () => root.render(jsx.jsx(App, { src: "preview-A" })));
    assert.deepEqual(previewSessions(), [], "returning to A remembers its independent pause");
    assert.ok(window.document.getElementById("rcompsleep-wake"), "a replaced paused frame must show Restore without polling");
    await React.act(async () => window.document.getElementById("rcompsleep-wake").click());
    assert.equal(states.has("bot-A"), false);
    assert.equal(states.get("bot-B"), "asleep", "restoring A must leave B paused");
    assert.deepEqual(previewSessions().sort(), ["preview-A", "preview-A/warm"]);
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
