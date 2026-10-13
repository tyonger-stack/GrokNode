import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { computerSleepOverlayRuntime, computerSleepStyles, loadOfficialAsleepArtifacts, loadOfficialOpenPill, loadOfficialShapeSvgs } from "../scripts/lib/computer-sleep-renderer-components.mjs";

const root = path.resolve(import.meta.dirname, "..");

async function loadModule(relativePath) {
  const cache = path.join(root, "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(path.join(cache, "computer-preview-"));
  const outfile = path.join(dir, "module.mjs");
  try {
    await build({ entryPoints: [path.join(root, relativePath)], bundle: true, platform: "node", format: "esm", outfile, packages: "external", logLevel: "silent" });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("preview sleep and wake avoid external dependencies and keep host reads available", async () => {
  const { createMainEdgeHandlers } = await loadModule("source/electron-main/main-edge.ts");
  let hostReads = 0;
  const handlers = createMainEdgeHandlers(new Proxy({
    readHostSettingsFromBox: async () => {
      hostReads += 1;
      return { pinnedAgentIds: ["qa-agent"] };
    },
  }, {
    get(target, key) {
      if (key === "computerPreview") return undefined;
      if (key === "readHostSettingsFromBox") return target.readHostSettingsFromBox;
      throw new Error(`preview state accessed an external dependency: ${String(key)}`);
    },
  }));
  await handlers.sleepComputer({});
  assert.deepEqual(await handlers.getHostPinnedAgents({}), ["qa-agent"]);
  assert.equal(await handlers.getComputerSleepState({}), "asleep");
  await handlers.wakeComputer({});
  assert.equal(await handlers.getComputerSleepState({}), "awake");
  assert.equal(hostReads, 1);
});

test("preview controls hide and restore content without opening the computer", async () => {
  const [{ createComputerPreviewController }, stage, pill, shapes] = await Promise.all([
    loadModule("source/electron-main/computer-sleep.ts"), loadOfficialAsleepArtifacts(), loadOfficialOpenPill(), loadOfficialShapeSvgs(),
  ]);
  const preview = createComputerPreviewController();
  const window = new Window();
  let refresh;
  let opened = 0;
  window.desktop = { computer: { getSleepState: async () => preview.getState(), sleep: async () => preview.sleep(), wake: async () => preview.wake() } };
  window.setTimeout = (callback) => { queueMicrotask(callback); return 1; };
  window.setInterval = (callback) => { refresh = callback; return 1; };
  window.document.body.innerHTML = '<div id="preview-frame" class="sand-computer-preview__frame"><div class="sand-box-vnc-pool"><canvas id="preview-stream"></canvas></div><button id="open-computer" class="sand-computer-preview__open">Open computer</button></div>';
  const css = window.document.createElement("style");
  css.textContent = '.sand-box-vnc-pool { position:absolute;inset:0; } .sand-box-vnc-pool > canvas,.sand-computer-preview__open { visibility:visible; }' + computerSleepStyles(stage.css + pill.css);
  window.document.head.append(css);
  window.document.getElementById("open-computer").addEventListener("click", () => { opened += 1; });
  try {
    window.eval(computerSleepOverlayRuntime(stage.html, shapes, pill.html));
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await new Promise(resolve => setImmediate(resolve));
    const host = window.document.querySelector(".sand-box-vnc-pool");
    const canvas = window.document.getElementById("preview-stream");
    assert.equal(window.getComputedStyle(host).position, "absolute", "preserve the original full-frame preview geometry");
    window.document.getElementById("preview-frame").dispatchEvent(new window.Event("pointerenter"));
    const sleep = window.document.getElementById("rcompsleep-pill-sleep");
    assert.ok(sleep);
    const open = window.document.querySelector("#rcompsleep-pill button");
    assert.ok(open);
    assert.equal(window.getComputedStyle(open).position, "static", "the open control must not cover the sleep target");
    open.click();
    assert.equal(opened, 1, "the open control must invoke the original opener");
    opened = 0;
    sleep.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(host.getAttribute("data-preview-asleep"), "true");
    assert.equal(window.getComputedStyle(canvas).visibility, "hidden");
    assert.equal(window.getComputedStyle(window.document.getElementById("open-computer")).visibility, "hidden");
    assert.equal(opened, 0, "sleep must not bubble into the computer opener");
    const wake = window.document.getElementById("rcompsleep-wake");
    assert.ok(wake);
    wake.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(host.hasAttribute("data-preview-asleep"), false);
    assert.equal(window.getComputedStyle(canvas).visibility, "visible");
    assert.equal(window.getComputedStyle(window.document.getElementById("open-computer")).visibility, "visible");
    assert.equal(opened, 0, "restore must not open a second surface");
    await refresh();
    assert.equal(window.document.getElementById("rcompsleep-stage"), null);
  } finally {
    window.close();
  }
});

test("exported preview styles cannot override the application header layout", async () => {
  const [stage, pill] = await Promise.all([loadOfficialAsleepArtifacts(), loadOfficialOpenPill()]);
  const window = new Window();
  try {
    window.document.body.innerHTML = '<div id="chat-header" class="sand-78zum5"></div>';
    const css = window.document.createElement("style");
    css.textContent = '.sand-78zum5 { display:grid; }' + computerSleepStyles(stage.css + pill.css);
    window.document.head.append(css);
    assert.equal(window.getComputedStyle(window.document.getElementById("chat-header")).display, "grid");
  } finally {
    window.close();
  }
});

test("preview CSS keeps pseudo-elements outside functional selectors", () => {
  const css = computerSleepStyles('.mascot:before { content:"z"; } .icon::after { content:"x"; }');
  assert.match(css, /:is\(\.mascot\):before/);
  assert.match(css, /:is\(\.icon\)::after/);
  assert.doesNotMatch(css, /:is\([^)]*:{1,2}(?:before|after)\)/);
});
