import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { COMPUTER_SLEEP_0712_LAYOUT, computerSleepOverlayRuntime, computerSleepStyles, loadOfficialAsleepArtifacts, loadOfficialOpenPill, loadOfficialShapeSvgs } from "../scripts/lib/computer-sleep-renderer-components.mjs";

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
  await handlers.sleepComputer({ agentId: "bot-A" });
  assert.deepEqual(await handlers.getHostPinnedAgents({}), ["qa-agent"]);
  assert.equal(await handlers.getComputerSleepState({ agentId: "bot-A" }), "asleep");
  assert.equal(await handlers.getComputerSleepState({ agentId: "bot-B" }), "awake");
  await assert.rejects(() => handlers.sleepComputer({}), /Bot ID/);
  await handlers.wakeComputer({ agentId: "bot-A" });
  assert.equal(await handlers.getComputerSleepState({ agentId: "bot-A" }), "awake");
  assert.equal(hostReads, 1);
});

test("the actual preload computer facade transports the requested Bot ID for all three operations", async () => {
  const { createDesktopPreloadBridge } = await loadModule("source/electron-preload/preload.ts");
  const calls = [];
  const mainEdge = new Proxy({ subscribe: () => () => {} }, {
    get(target, method) { return target[method] ?? (async (...args) => { calls.push({ method, args }); return "awake"; }); },
  });
  const desktop = createDesktopPreloadBridge({ ipc: { invoke: async () => ({}), on: () => {}, off: () => {} }, webFrame: {}, mainEdge, env: {}, devRestartEnabled: false, initialState: {} });
  await desktop.computer.getSleepState("bot-A");
  await desktop.computer.sleep("bot-B");
  await desktop.computer.wake("bot-A");
  assert.deepEqual(calls, [
    { method: "getComputerSleepState", args: [{ agentId: "bot-A" }] },
    { method: "sleepComputer", args: [{ agentId: "bot-B" }] },
    { method: "wakeComputer", args: [{ agentId: "bot-A" }] },
  ]);
});

test("preview controls hide and restore content without opening the computer", async () => {
  const [{ createComputerPreviewController }, stage, pill, shapes] = await Promise.all([
    loadModule("source/electron-main/computer-sleep.ts"), loadOfficialAsleepArtifacts(), loadOfficialOpenPill(), loadOfficialShapeSvgs(),
  ]);
  const preview = createComputerPreviewController();
  const window = new Window();
  let refresh;
  let opened = 0;
  window.desktop = { computer: { getSleepState: async agentId => preview.getState(agentId), sleep: async agentId => preview.sleep(agentId), wake: async agentId => preview.wake(agentId) } };
  window.setTimeout = (callback) => { queueMicrotask(callback); return 1; };
  window.setInterval = (callback) => { refresh = callback; return 1; };
  window.document.body.innerHTML = '<div id="preview-frame" data-preview-bot-id="bot-A" class="sand-computer-preview__frame"><div class="sand-box-vnc-pool"><canvas id="preview-stream"></canvas></div><button id="open-computer" class="sand-computer-preview__open native-open-control"><span class="native-open-pill"><i class="ui-icon native-icon" data-icon-name="arrows-expand-simple" data-size="sm" aria-hidden="true"></i>Open computer</span></button></div>';
  const css = window.document.createElement("style");
  css.textContent = '.sand-box-vnc-pool { position:absolute;inset:0; } .sand-box-vnc-pool > canvas,.sand-computer-preview__open { visibility:visible; }' + computerSleepStyles(stage.css + pill.css);
  window.document.head.append(css);
  window.document.getElementById("open-computer").addEventListener("click", () => { opened += 1; });
  try {
    window.eval(computerSleepOverlayRuntime(stage.html, shapes, "\uf46f"));
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await new Promise(resolve => setImmediate(resolve));
    const host = window.document.querySelector(".sand-box-vnc-pool");
    const canvas = window.document.getElementById("preview-stream");
    assert.equal(window.getComputedStyle(host).position, "absolute", "preserve the original full-frame preview geometry");
    window.document.getElementById("preview-frame").dispatchEvent(new window.Event("pointerenter"));
    const sleep = window.document.getElementById("rcompsleep-pill-sleep");
    assert.ok(sleep);
    const open = window.document.getElementById("open-computer");
    assert.ok(open);
    assert.equal(window.document.querySelectorAll("#preview-frame button").length, 2, "reuse the original opener without a duplicate Open button");
    assert.ok(sleep.classList.contains("native-open-control"));
    assert.equal(sleep.firstElementChild.className, open.firstElementChild.className, "both actions use the native pill style");
    assert.equal(open.style.getPropertyValue("--sand-computer-open-reveal"), "1");
    assert.equal(sleep.style.getPropertyValue("--sand-computer-open-reveal"), "1");
    assert.equal(sleep.style.backgroundColor, "", "the native pill supplies the background");
    const sleepIcon = sleep.querySelector('[data-icon-name="moon-z"]');
    assert.ok(sleepIcon, "sleep uses the native moon-z icon");
    assert.equal(sleepIcon.className, open.querySelector("i").className);
    assert.equal(sleepIcon.getAttribute("data-size"), "sm");
    assert.equal(sleepIcon.style.getPropertyValue("--cursor-icon-content"), '"\uf46f"');
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
    window.document.getElementById("preview-frame").dispatchEvent(new window.Event("pointerenter"));
    assert.ok(window.document.getElementById("rcompsleep-pill-sleep"));
    window.document.getElementById("preview-frame").dispatchEvent(new window.Event("pointerleave"));
    assert.equal(window.document.getElementById("rcompsleep-pill-sleep"), null);
    assert.equal(open.style.getPropertyValue("--sand-computer-open-reveal"), "");
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

test("0.71.2 layout classes reach the stage descendants, not only the stage root", () => {
  assert.deepEqual(COMPUTER_SLEEP_0712_LAYOUT.avatar, { top: "calc(50% - 28px)", insetInlineStart: "50%", marginInlineStart: "-16px" });
  assert.deepEqual(COMPUTER_SLEEP_0712_LAYOUT.words, { top: "calc(50% + 10px)" });
});

function mountPreview(html, phase) {
  const window = new Window();
  let refresh;
  window.desktop = { computer: { getSleepState: async () => "awake" } };
  Object.defineProperty(window.navigator, "language", { value: "zh-CN", configurable: true });
  window.setTimeout = () => 1;
  window.setInterval = callback => { refresh = callback; return 1; };
  window.document.body.innerHTML = '<div class="sand-computer-preview" data-phase="' + phase + '">' + html + "</div>";
  return { window, refresh: () => refresh() };
}

const IDLE_PREVIEW = '<div id="preview-frame" data-preview-bot-id="bot-A" class="sand-computer-preview__frame"><div class="sand-box-vnc-pool"></div><button id="open-computer" class="sand-computer-preview__open" aria-label="打开电脑" title="打开电脑"><span class="native-open-pill">Open</span></button></div>';
const RUNNING_PREVIEW = '<div id="preview-frame" data-preview-bot-id="bot-A" class="sand-computer-preview__frame"><div class="sand-box-vnc-pool"><webview id="stream"></webview></div><button id="open-computer" class="sand-computer-preview__open"><span>Open</span></button></div>';

test("a computer that has not started renders the official 电脑正在休眠 card", async () => {
  const [stage, shapes] = await Promise.all([loadOfficialAsleepArtifacts(), loadOfficialShapeSvgs()]);
  const { window, refresh } = mountPreview(IDLE_PREVIEW, "idle");
  try {
    const css = window.document.createElement("style");
    css.textContent = computerSleepStyles(stage.css);
    window.document.head.append(css);
    let opened = 0;
    window.document.getElementById("open-computer").addEventListener("click", () => {
      opened += 1;
      window.document.querySelector(".sand-computer-preview").setAttribute("data-phase", "loading");
    });
    window.eval(computerSleepOverlayRuntime(stage.html, shapes, "\uf46f"));
    await refresh();
    await new Promise(resolve => setImmediate(resolve));
    const asleep = window.document.getElementById("rcompsleep-stage");
    assert.ok(asleep, "the not-started computer shows the asleep stage");
    assert.equal(asleep.getAttribute("data-stage"), "asleep");
    assert.equal(asleep.textContent.includes("电脑正在休眠"), true, "official 0.71.2 title");
    assert.equal(window.document.getElementById("rcompsleep-wake"), null, "the official asleep stage has no in-stage button");
    const card = window.document.getElementById("rcompsleep-stage");
    const avatar = card.querySelector("[data-stage-avatar]");
    const words = card.querySelector("[data-stage-words]").parentElement;
    assert.equal(avatar.style.top, "calc(50% - 28px)", "official 0.71.2 avatar offset");
    assert.equal(avatar.style.insetInlineStart, "50%");
    assert.equal(avatar.style.marginInlineStart, "-16px");
    assert.equal(words.style.top, "calc(50% + 10px)", "official 0.71.2 caption offset");
    assert.equal(window.document.querySelectorAll("#preview-frame button").length, 1, "only the native opener remains");
    const open = window.document.getElementById("open-computer");
    assert.equal(open.classList.contains("sand-oegz02"), true, "official openOverStage keeps the wake action visible");
    assert.equal(open.getAttribute("aria-label"), "唤醒电脑");
    assert.equal(open.hasAttribute("title"), false);
    assert.equal(window.getComputedStyle(open).visibility, "visible", "the native wake action must remain reachable over the asleep stage");
    assert.ok(Number(window.getComputedStyle(open).zIndex) > Number(window.getComputedStyle(asleep).zIndex), "the native wake action must receive clicks above the stage");
    open.click();
    await refresh();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(opened, 1, "wake uses the original computer opener");
    // 官方 Us(starting): 留台、头像 waking、标题 shimmer — 不是拆台露出 StagePlaceholder 进度条。
    const waking = window.document.getElementById("rcompsleep-stage");
    assert.ok(waking, "busy wake keeps the official starting stage");
    assert.equal(waking.getAttribute("data-stage"), "starting");
    assert.equal(waking.querySelector(".sand-grok-bot-mark").getAttribute("data-grok-state"), "waking");
    assert.equal(waking.textContent.includes("正在唤醒"), true, "official pwcnuW title");
    const title = waking.querySelector("[data-stage-words]>span");
    assert.ok(title.className.includes("rcompsleep-shimmer"), "title runs official shimmer animation");
    assert.equal(waking.querySelector("[data-stage-avatar]>span").classList.contains("sand-1aquc0h"), false, "avatar pulse unlocked while waking");
    assert.equal(open.classList.contains("sand-oegz02"), false);
    assert.equal(open.getAttribute("aria-label"), "打开电脑");
    assert.equal(open.getAttribute("title"), "打开电脑");
    assert.equal(open.firstElementChild.style.display, "");
  } finally {
    window.close();
  }
});

test("busy phases without VNC keep the official waking stage; error does not", async () => {
  for (const phase of ["loading", "starting", "pulling"]) {
    const [stage, shapes] = await Promise.all([loadOfficialAsleepArtifacts(), loadOfficialShapeSvgs()]);
    const { window, refresh } = mountPreview(IDLE_PREVIEW, phase);
    window.eval(computerSleepOverlayRuntime(stage.html, shapes, "\uf46f"));
    await refresh();
    await new Promise(resolve => setImmediate(resolve));
    const card = window.document.getElementById("rcompsleep-stage");
    assert.ok(card, "phase " + phase + " must keep Us starting");
    assert.equal(card.getAttribute("data-stage"), "starting");
    assert.equal(card.querySelector(".sand-grok-bot-mark").getAttribute("data-grok-state"), "waking");
    assert.equal(card.textContent.includes("正在唤醒"), true);
    assert.equal(window.document.getElementById("open-computer").classList.contains("sand-oegz02"), false);
    window.close();
  }
  {
    const [stage, shapes] = await Promise.all([loadOfficialAsleepArtifacts(), loadOfficialShapeSvgs()]);
    const { window, refresh } = mountPreview(IDLE_PREVIEW, "error");
    window.eval(computerSleepOverlayRuntime(stage.html, shapes, "\uf46f"));
    await refresh();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(window.document.getElementById("rcompsleep-stage"), null, "error phase is not Us starting");
    window.close();
  }
});

test("styles ship the official title shimmer keyframes", async () => {
  const stage = await loadOfficialAsleepArtifacts();
  const css = computerSleepStyles(stage.css);
  assert.match(css, /@keyframes sand-1ofn8cw-B/);
  assert.match(css, /#rcompsleep-stage \.rcompsleep-shimmer/);
  assert.match(css, /animation:sand-1ofn8cw-B 2\.2s steps\(60\) infinite/);
});

test("a running computer keeps the live preview and shows no asleep card", async () => {
  const [stage, shapes] = await Promise.all([loadOfficialAsleepArtifacts(), loadOfficialShapeSvgs()]);
  const { window, refresh } = mountPreview(RUNNING_PREVIEW, "remote");
  window.eval(computerSleepOverlayRuntime(stage.html, shapes, "\uf46f"));
  await refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.document.getElementById("rcompsleep-stage"), null);
  assert.equal(window.document.getElementById("stream") != null, true);
  window.close();
});

test("waking stage starts the official live avatar engine, not a static SVG", async () => {
  const [{ html }, shapes] = await Promise.all([loadOfficialAsleepArtifacts(), loadOfficialShapeSvgs()]);
  const runtime = computerSleepOverlayRuntime(html, shapes, "\uf46f");
  assert.match(runtime, /createOfficialAvatarEngine\(S,p\)/, "reuse the shape-picker engine already in the chunk");
  assert.match(runtime, /engine\.state\(puppet,'waking'/, "official Ie.starting → waking");
  assert.match(runtime, /requestAnimationFrame\(tick\)/, "eyes animate on rAF like Us Mark");
  assert.match(runtime, /data-live-avatar/, "live host is marked for assertions");
  const applyBody = runtime.split("function applyStageMode")[1].split("function mountOverlay")[0];
  assert.equal(applyBody.includes("startLiveAvatar(stage)"), true);
  assert.equal(/swapMascotShape\(stage,waking\?'waking'/.test(applyBody), false, "waking must not stay on the static SVG swap");
});

test("with the official engine in scope, waking SVG frames actually change", async () => {
  const { createOfficialAvatarEngine } = await import("../scripts/lib/computer-sleep-official/avatar-engine.mjs");
  const [stage, shapes] = await Promise.all([loadOfficialAsleepArtifacts(), loadOfficialShapeSvgs()]);
  const { window, refresh } = mountPreview(IDLE_PREVIEW, "idle");
  window.S = {
    forwardRef: (fn) => fn,
    useId: () => ":r0:",
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useImperativeHandle: () => {},
  };
  window.p = { jsx: () => null, jsxs: () => null };
  window.createOfficialAvatarEngine = createOfficialAvatarEngine;
  window.requestAnimationFrame = (cb) => { window.__raf = cb; return 1; };
  window.cancelAnimationFrame = () => {};
  try {
    const runtime = computerSleepOverlayRuntime(stage.html, shapes, "\uf46f");
    const body = runtime.replace(/^\/\*[\s\S]*?\*\/\n/, "");
    window.eval("var S=window.S,p=window.p,createOfficialAvatarEngine=window.createOfficialAvatarEngine;" + body);
    await refresh();
    await new Promise((resolve) => setImmediate(resolve));
    const open = window.document.getElementById("open-computer");
    window.document.querySelector(".sand-computer-preview").setAttribute("data-phase", "loading");
    open.click();
    await refresh();
    await new Promise((resolve) => setImmediate(resolve));
    const live = window.document.querySelector("[data-live-avatar='waking']");
    assert.ok(live, "live avatar host mounted");
    const first = live.innerHTML;
    assert.ok(first.includes("<svg"), "first frame is SVG");
    const start = 1000;
    for (let i = 1; i <= 20; i++) window.__raf?.(start + i * 32);
    const second = live.innerHTML;
    assert.notEqual(second, first, "waking eyes must move across frames");
  } finally {
    window.close();
  }
});
