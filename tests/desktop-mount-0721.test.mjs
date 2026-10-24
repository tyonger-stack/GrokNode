import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, open, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { z } from "zod";
import { stageDesktopMount0721 } from "../scripts/lib/desktop-mount-0721.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = path.resolve(process.env.DESKTOP_MOUNT_EVIDENCE ?? path.join(root, ".omo/evidence/desktop-mount-0721"));
const asarSkip = !existsSync(path.resolve(root, "../rea-grokbot-0755/asar/app.asar"))
  && "0.75.5 snapshot is absent";
const options = { skip: asarSkip };
await mkdir(evidence, { recursive: true });
let staged, generated, createDesktopMount0721, createDesktopMountStagingPort, createAttachmentEdgePort;
const require = createRequire(import.meta.url);
if (!asarSkip) {
  staged = await stageDesktopMount0721({ distRoot: path.join(evidence, "dist") });
  generated = require(staged.generatedPath);
  const adapterPath = path.join(evidence, "adapter.cjs");
  await build({ entryPoints: [path.join(root, "source/electron-main/desktop-mount/index.ts")],
    outfile: adapterPath, bundle: true, platform: "node", format: "cjs", logLevel: "error" });
  ({ createDesktopMount0721, createDesktopMountStagingPort } = require(adapterPath));
  const attachmentsPath = path.join(evidence, "attachments.cjs");
  await build({ entryPoints: [path.join(root, "source/electron-main/attachments/attachments.ts")],
    outfile: attachmentsPath, bundle: true, platform: "node", format: "cjs", logLevel: "error" });
  ({ createAttachmentEdgePort } = require(attachmentsPath));
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const target = { agentId: "agent-fixture", name: "Fixture", shape: "blob",
  ink: { light: "#000000", dark: "#ffffff" }, markSvgDataUrl: "data:image/svg+xml,<svg/>" };
const channel = (method, edge = "desktop-mount") => `dune-rpc:${edge}:m:${method}`;
async function record(name, observed) {
  await writeFile(path.join(evidence, `${name}.json`), JSON.stringify({
    scenario: name, invocation: "node --test tests/desktop-mount-0721.test.mjs", passed: true, observed,
  }, null, 2) + "\n");
}

function electronFixture() {
  const windows = [];
  const handlers = new Map();
  const events = [];
  class Window extends EventEmitter {
    constructor(options = {}) {
      super(); this.options = options; this.id = windows.length + 1; this.destroyed = false;
      this.bounds = { x: 0, y: 0, width: 320, height: 176, ...options };
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: "file:///main.html", isDestroyed: () => false };
      this.webContents.setWindowOpenHandler = (fn) => { this.openHandler = fn; };
      this.webContents.send = (name, value) => events.push({ name, value, window: this.id });
      windows.push(this);
    }
    static getAllWindows() { return windows.filter((window) => !window.destroyed); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return !this.destroyed; }
    isFocused() { return this.focused === true; }
    focus() { for (const window of windows) window.focused = false; this.focused = true; }
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    showInactive() {}
    show() { this.focus(); }
    getMediaSourceId() { return `window:${this.id}:0`; }
    destroy() { this.destroyed = true; this.emit("closed"); }
    async loadFile(file) { this.webContents.mainFrame.url = pathToFileURL(file).href; }
    async loadURL(url) { this.webContents.mainFrame.url = url; }
  }
  const screen = new EventEmitter();
  const display = { bounds: { x: -1000, y: 0, width: 1000, height: 800 }, workArea: { x: -1000, y: 0, width: 1000, height: 760 } };
  screen.getPrimaryDisplay = () => display;
  screen.getAllDisplays = () => [display];
  screen.getCursorScreenPoint = () => ({ x: -900, y: 100 });
  const shortcuts = new Map();
  const electron = { BrowserWindow: Window, screen,
    ipcMain: { handle(name, fn) { assert.equal(handlers.has(name), false); handlers.set(name, fn); }, removeHandler: (name) => handlers.delete(name) },
    app: { getPath: () => evidence, getAppPath: () => root }, shell: { openExternal: async () => {} },
    systemPreferences: { getAccentColor: () => "007affff" },
    globalShortcut: { register(name, fn) { shortcuts.set(name, fn); return true; }, unregister: (name) => shortcuts.delete(name) },
  };
  const main = new Window();
  async function invoke(window, method, args = {}, edge = "desktop-mount", senderFrame = window.webContents.mainFrame) {
    const handler = handlers.get(channel(method, edge));
    assert.equal(typeof handler, "function", channel(method, edge));
    return handler({ sender: window.webContents, senderFrame }, args);
  }
  return { electron, main, windows, handlers, events, shortcuts, invoke };
}

function factories(fixture, overrides = {}) {
  return generated.createUpstream({ ...staged, electron: fixture.electron, zod: z,
    panelDocument: path.join(staged.rendererRoot, "src/electron-renderer/desktop-mount/panel/panel.html"),
    overlayDocument: path.join(staged.rendererRoot, "src/electron-renderer/desktop-mount/capture-overlay/capture-overlay.html"),
    nativeRequire: () => require(path.join(staged.nativeRoot, "index.js")),
    reportWarning: () => {}, onPromptSubmitted: () => {}, ...overrides });
}

function attachmentPort(name, uploaded = []) {
  const dir = path.join(evidence, name);
  return createAttachmentEdgePort({ getStagingDir: () => dir,
    byteLimitForName: () => 25 * 1024 * 1024,
    isWithinStagingDir: (file) => path.dirname(file) === dir,
    onEdgeFailure: (failure) => { throw new Error(JSON.stringify(failure)); },
    legs: { uploadAttachment: async (request) => { uploaded.push(request); return { path: `/remote/${request.filename}` }; } },
  });
}

test("verified build retains raw preloads, renderer closure and native bytes", options, async () => {
  const provenance = JSON.parse(await readFile(staged.provenancePath, "utf8"));
  for (const output of provenance.outputs) {
    const bytes = await readFile(path.join(evidence, "dist", output.path));
    assert.equal(hash(bytes), output.sha256);
    assert.ok(bytes.length > 0);
  }
  for (const name of ["panel", "capture-overlay"]) {
    const relative = `dist/electron-preload/preload-desktop-mount-${name}.cjs`;
    const source = provenance.inputs.find((entry) => entry.path === relative);
    assert.equal(hash(await readFile(path.join(staged.preloadRoot, path.basename(relative)))), source.sha256);
  }
  const native = require(path.join(staged.nativeRoot, "index.js"));
  const names = ["screen_capture_access_sync", "request_screen_capture_access_sync", "list_windows_sync", "capture_window_async", "capture_rect_async"];
  for (const name of names) assert.equal(typeof native[name], "function");
  assert.ok(provenance.outputs.some((output) => /chunk-prompt-editor-[^/]+\.js$/u.test(output.path)));
  await record("build-and-native-load", { verifiedOutputs: provenance.outputs.length, nativeExports: names, provenancePath: staged.provenancePath });
});

test("complete wet factory enforces sender, args, ownership and sends through existing commit", options, async () => {
  const f = electronFixture();
  const uploaded = [], submitted = [], errors = [];
  const port = attachmentPort("staging", uploaded);
  const cleanup = [];
  const attachments = { ...port, discardStaged(file) {
    const work = port.discardStaged(file);
    cleanup.push(work);
    return work;
  } };
  let enabled = true;
  const runtime = createDesktopMount0721({ ...staged, electron: f.electron,
    getMainWindow: () => f.main, isEnabled: () => enabled, readAccountSlot: () => null, systemVersion: "26.0",
    attachments, reportWarning: (message) => errors.push(message),
    onPromptSubmissionError: (error) => errors.push(String(error)),
    async onPromptSubmitted(prompt) {
      const committed = await attachments.commitStaged(prompt.attachments.map((a) => a.path), prompt.attachments.map((a) => a.name));
      submitted.push({ ...prompt, committed });
    },
  });
  try {
    const badId = await f.invoke(f.main, "mount", { ...target, agentId: "../bad" });
    assert.equal(badId.failure.code, "edge/invalid-args");
    const subframe = await f.invoke(f.main, "mount", target, "desktop-mount", { ...f.main.webContents.mainFrame });
    assert.equal(subframe.failure.code, "edge/untrusted-sender");
    enabled = false;
    const gated = await f.invoke(f.main, "mount", target);
    assert.equal(gated.failure.code, "desktop-mount/gate-off");
    enabled = true;
    const mounted = await f.invoke(f.main, "mount", target);
    assert.deepEqual(mounted, { ok: true, value: { mount: target } });
    const panel = f.windows.at(-1);
    assert.equal(panel.options.webPreferences.sandbox, true);
    assert.equal((await f.invoke(f.main, "read")).failure.code, "edge/untrusted-sender");
    assert.equal((await f.invoke(panel, "mount", target)).failure.code, "edge/untrusted-sender");
    const originalUrl = panel.webContents.mainFrame.url;
    panel.webContents.mainFrame.url = "file:///unexpected.html";
    const navigated = await f.invoke(panel, "read");
    assert.equal(navigated.failure.code, "edge/untrusted-sender");
    panel.webContents.mainFrame.url = originalUrl;
    assert.equal((await f.invoke(panel, "movePanel", { dx: 20000, dy: 0 })).failure.code, "edge/invalid-args");
    const foreign = await f.invoke(panel, "submitPrompt", { prompt: "hello", attachments: [{ path: "/foreign", name: "x", size: 1 }] });
    assert.equal(foreign.failure.code, "desktop-mount/unknown-attachment");
    const stagedBytes = await f.invoke(panel, "stageAttachmentBytes", { filename: "capture.png", bytes: new Uint8Array([1, 2, 3]) });
    assert.equal(stagedBytes.value.ok, true);
    const submission = await f.invoke(panel, "submitPrompt", { prompt: " ", attachments: [{ path: stagedBytes.value.path, name: "capture.png", size: 3 }] });
    assert.equal(submission.ok, true);
    await runtime.whenIdle();
    assert.equal(submitted.length, 1);
    assert.deepEqual(submitted[0].committed, ["/remote/capture.png"]);
    assert.equal(uploaded[0].bytesBase64, "AQID");
    const reused = await f.invoke(panel, "submitPrompt", { prompt: "again", attachments: [{ path: stagedBytes.value.path, name: "capture.png", size: 3 }] });
    assert.equal(reused.failure.code, "desktop-mount/unknown-attachment");
    const orphan = await f.invoke(panel, "stageAttachmentBytes", { filename: "orphan.png", bytes: new Uint8Array([9]) });
    await f.invoke(f.main, "unmount");
    await Promise.all(cleanup);
    await assert.rejects(stat(orphan.value.path), { code: "ENOENT" });
    assert.equal(panel.isDestroyed(), true);
    assert.equal(f.shortcuts.size, 0);
    assert.deepEqual(errors, []);
    await record("mount-rpc-and-send", { mounted, badId, subframe, gated, navigated, foreign, reused, submitted, uploaded });
  } finally { runtime.dispose(); }
  assert.equal(f.handlers.size, 0);
  await record("dispose", { remainingHandlers: f.handlers.size, remainingShortcuts: f.shortcuts.size });
});

test("stagePath validates actual file size and reuses current staging ownership", options, async () => {
  const staging = createDesktopMountStagingPort(attachmentPort("path-staging"));
  const sourcePath = path.join(evidence, "source-file.txt");
  await writeFile(sourcePath, "real bytes");
  const good = await staging.stagePath({ filename: "copy.txt", sourcePath });
  assert.equal(good.ok, true);
  assert.equal(await readFile(good.path, "utf8"), "real bytes");
  const invalid = await staging.stagePath({ filename: "../copy.txt", sourcePath });
  assert.equal(invalid.ok, false);
  assert.equal((await staging.stagePath({ filename: "x.txt", sourcePath: "relative.txt" })).ok, false);
  assert.equal((await staging.stagePath({ filename: "x.txt", sourcePath: evidence })).ok, false);
  const largePath = path.join(evidence, "oversize.txt");
  const file = await open(largePath, "w");
  await file.truncate(25 * 1024 * 1024 + 1); await file.close();
  const oversized = await staging.stagePath({ filename: "x.txt", sourcePath: largePath });
  assert.deepEqual(oversized, { ok: false, reason: "too-large" });
  await record("stage-path", { good, invalid, oversized, sourceSha256: hash(await readFile(sourcePath)) });
});

test("exact picker rejects foreign frames and cancels without residual overlays", options, async () => {
  const f = electronFixture();
  const upstream = factories(f);
  const picker = upstream.createPicker({ listTargets: () => [], tint: () => "#007aff" });
  try {
    const result = picker.open();
    assert.equal(picker.open(), result);
    const overlay = f.windows.at(-1);
    const edge = "desktop-mount-capture-overlay";
    const foreign = await f.invoke(f.main, "cancel", {}, edge);
    assert.equal(foreign.failure.code, "edge/untrusted-sender");
    const subframe = await f.invoke(overlay, "cancel", {}, edge, { ...overlay.webContents.mainFrame });
    assert.equal(subframe.failure.code, "edge/untrusted-sender");
    const invalid = await f.invoke(overlay, "pickRegion", { x: Infinity, y: 0, width: 20, height: 20 }, edge);
    assert.equal(invalid.failure.code, "edge/invalid-args");
    assert.equal((await f.invoke(overlay, "cancel", {}, edge)).ok, true);
    const cancelled = await result;
    assert.deepEqual(cancelled, { kind: "cancelled", reason: "escape" });
    assert.equal(picker.isOpen(), false);
    assert.equal(overlay.isDestroyed(), true);
    const blur = picker.open();
    const second = f.windows.at(-1);
    second.focused = false;
    second.emit("blur");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(await blur, { kind: "cancelled", reason: "blur" });
    const changed = picker.open();
    f.electron.screen.emit("display-metrics-changed");
    assert.deepEqual(await changed, { kind: "cancelled", reason: "displays-changed" });
    await record("picker-cancellation", { foreign, subframe, invalid, cancelled, remainingOverlays: picker.overlayWindows().length });
  } finally { picker.dispose(); }
  assert.equal(f.handlers.size, 0);
});

test("native service preserves denied permission and captured bytes contracts", options, async () => {
  const f = electronFixture();
  const upstream = factories(f);
  let requested = 0, opened = 0;
  const denied = upstream.createCaptureService({ platform: "darwin", ownWindowIds: () => [],
    native: { kind: "loaded", native: { screen_capture_access_sync: () => "denied", request_screen_capture_access_sync: () => { requested++; return false; } } },
    openExternal: async () => { opened++; },
  });
  assert.equal(await denied.ensureAccess(), "denied");
  assert.equal(await denied.ensureAccess(), "denied");
  assert.equal(requested, 1); assert.equal(opened, 1);
  let rectArgs;
  const service = upstream.createCaptureService({ platform: "darwin", ownWindowIds: () => [7], openExternal: async () => {},
    native: { kind: "loaded", native: { screen_capture_access_sync: () => "granted",
      capture_rect_async: async (...args) => { rectArgs = args; return { kind: "captured", png: new Uint8Array([1, 2]), pixelWidth: 20, pixelHeight: 20, scale: 2 }; },
    } },
  });
  const result = await service.capture({ kind: "rect", rect: { x: -10, y: 5, width: 10, height: 10 } });
  assert.equal(result.kind, "captured");
  assert.deepEqual(rectArgs, [-10, 5, 10, 10, [7]]);
  assert.deepEqual(Array.from(result.image.bytes), [1, 2]);
  await record("capture-service", { requested, opened, rectArgs, result });
});

