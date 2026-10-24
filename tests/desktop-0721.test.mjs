import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as compilerRuntime from "react/compiler-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { generateDesktop0721Module, generateDesktop0721RulesModule, stageDesktop0721Resources, notificationNativePin } from "../scripts/lib/desktop-0721.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = path.resolve(process.env.DESKTOP_0721_EVIDENCE_DIR ?? path.join(root, ".omo/evidence/desktop-0721"));
const require = createRequire(import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const record = async (name, value) => writeFile(path.join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);
const asarSkip = !existsSync(path.resolve(root, "../rea-grokbot-0755/asar/app.asar"))
  && "0.75.5 snapshot is absent";
const options = { skip: asarSkip };
let createDesktop0721;
let transplant;
let upstream;
let generated;
let resources;
let ruleModule;

before(async () => {
  if (asarSkip) return;
  await mkdir(evidence, { recursive: true });
  let helpers = new URL("../scripts/lib/upstream-0755.mjs", import.meta.url);
  try { await readFile(helpers); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    helpers = new URL("../../grok-node-port-0721/scripts/lib/upstream-0721.mjs", import.meta.url);
  }
  const { openUpstream0755 } = await import(helpers);
  upstream = await openUpstream0755();
  generated = await generateDesktop0721Module({ upstream, outputFile: path.join(evidence, "upstream.cjs") });
  resources = await stageDesktop0721Resources({ upstream, outputDir: path.join(evidence, "staged"),
    notificationNativePath: path.resolve(root, "../rea-grokbot-0755/asar/app.asar.unpacked", notificationNativePin.path) });
  await generateDesktop0721RulesModule({ upstream, outputFile: path.join(evidence, "rules.mjs") });
  ruleModule = await import(pathToFileURL(path.join(evidence, "rules.mjs")));
  await build({ entryPoints: [path.join(root, "source/electron-main/desktop-0721/index.ts")], bundle: true,
    platform: "node", format: "cjs", outfile: path.join(evidence, "adapter.cjs"), logLevel: "silent" });
  ({ createDesktop0721 } = require(path.join(evidence, "adapter.cjs")));
  ({ createDesktop0721Upstream: transplant } = require(path.join(evidence, "upstream.cjs")));
});

function makePorts({ settings = [{ platform: "darwin", setting: "authorized" }], platform = "darwin", nativeError, storage, autoClock = false, missingAssets = false } = {}) {
  const trace = [];
  const errors = [];
  const timers = new Map();
  let counter = 0;
  let readingIndex = 0;
  class Image {
    constructor(width = 18, height = 18, name = "image", empty = false) { Object.assign(this, { width, height, name, empty, template: false }); }
    getSize() { return { width: this.width, height: this.height }; }
    isEmpty() { return this.empty; }
    setTemplateImage(value) { this.template = value; }
    isTemplateImage() { return this.template; }
    toBitmap({ scaleFactor = 1 } = {}) { return Buffer.alloc(this.width * this.height * 4 * scaleFactor * scaleFactor); }
    addRepresentation(value) { this.width = value.width / value.scaleFactor; this.height = value.height / value.scaleFactor; }
    crop({ width, height }) { return new Image(width, height, `${this.name}:crop`); }
    resize({ width, height }) { return new Image(width, height, `${this.name}:resize`); }
  }
  const trays = [];
  class Tray {
    constructor(image) { this.image = image; this.destroyed = false; trays.push(this); trace.push(["tray-created", image.name]); }
    setIgnoreDoubleClickEvents(value) { trace.push(["ignore-double-click", value]); }
    setToolTip(value) { trace.push(["tooltip", value]); }
    setContextMenu(menu) { assert.equal(this.destroyed, false); this.menu = menu; trace.push(["menu", menu.map(({ label, accelerator }) => ({ label, accelerator }))]); }
    setTitle(value) { assert.equal(this.destroyed, false); this.title = value; trace.push(["title", value]); }
    setImage(value) { assert.equal(this.destroyed, false); this.image = value; trace.push(["image", value.name]); }
    destroy() { assert.equal(this.destroyed, false); this.destroyed = true; trace.push(["destroy"]); }
  }
  class Notification {
    static isSupported() { return true; }
    constructor(options) { this.options = options; trace.push(["notification-created", options]); }
    once(event, callback) { this.close = callback; return this; }
    show() { trace.push(["notification-shown", this.options]); this.close?.(); }
  }
  const clock = {
    now: () => 0, monotonicNow: () => 0,
    schedule(ms, callback) {
      const id = ++counter;
      timers.set(id, callback);
      trace.push(["schedule", ms]);
      if (autoClock) queueMicrotask(() => { if (timers.delete(id)) callback(); });
      return { dispose() { timers.delete(id); trace.push(["cancel", id]); } };
    },
  };
  const options = {
    transplant, platform, clock,
    electron: { Tray, Notification, Menu: { buildFromTemplate: (template) => template },
      nativeImage: {
        createFromPath(file) {
          if (missingAssets) return new Image(0, 0, file, true);
          const bytes = readFileSync(file);
          assert.equal(bytes.subarray(1, 4).toString(), "PNG");
          return new Image(bytes.readUInt32BE(16), bytes.readUInt32BE(20), path.basename(file));
        },
        createFromDataURL: () => new Image(), createFromBuffer: () => new Image(), createEmpty: () => new Image(),
      }, shell: { async openExternal(url) { trace.push(["open-settings", url]); } },
      app: { name: "Grok Node", quit() { trace.push(["quit"]); }, getAppPath: () => root },
    },
    translate: ({ id }) => id,
    reportFailure: (...args) => { errors.push(args.map((arg) => arg instanceof Error ? arg.message : arg)); },
    loadNotificationNative() {
      if (nativeError) throw nativeError;
      return { async notification_settings_async() {
        const value = settings[Math.min(readingIndex++, settings.length - 1)];
        trace.push(["read-permission", value]);
        if (value instanceof Error) throw value;
        return value;
      } };
    },
    rosterPhotoUrl: (key) => `https://roster.invalid/${key}`,
    rosterPhotos: { async serve(request) { trace.push(["photo", request.url]); return new Response(null, { status: 404 }); } },
    assetsDir: path.join(evidence, "staged/dist/electron-main/menubar-tray/assets"),
    storage: storage ?? { read: async () => undefined, write: async () => { throw new Error("No storage configured in this scenario"); } },
    showApp: () => trace.push(["show-app"]), onSelectBot: (id) => trace.push(["select-bot", id]), openSettings: () => trace.push(["app-settings"]),
    rules: { async getAutoReviewInstructions() { trace.push(["get-existing-rules"]); return { isEnabled: true, allowInstructions: [], blockInstructions: [] }; },
      async setAutoReviewInstructions(args) { trace.push(["set-existing-rules", args]); return args.instructions; } },
  };
  return { options, trace, errors, trays, timers };
}

const agent = (id, updatedAt, extras = {}) => ({ id, name: `Bot ${id}`, updatedAt, hasUnread: true,
  isRunning: false, isComposingMessage: false, avatarShape: "blob", avatarColor: "black", ...extras });

test("hash-verified generated closure and exact staged resource bytes", options, async () => {
  assert.equal(process.version, "v26.5.1");
  assert.equal(hash(await readFile(generated.outputFile)), generated.manifest.outputSha256);
  for (const source of generated.manifest.sources) {
    const code = upstream.read(source.path).toString("utf8");
    assert.equal(hash(code), source.inputSha256);
    for (const unit of [...source.provenance, ...source.initializers]) assert.equal(hash(code.slice(unit.start, unit.end)), unit.sha256);
  }
  const verified = [];
  for (const file of resources.files) {
    const bytes = await readFile(path.join(evidence, "staged", file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(hash(bytes), file.sha256);
    if (file.path !== notificationNativePin.path) assert.deepEqual(bytes, upstream.read(file.path));
    verified.push({ path: file.path, bytes: bytes.length, sha256: hash(bytes) });
  }
  const badNative = path.join(evidence, "invalid-native.node");
  await writeFile(badNative, "invalid native input");
  await assert.rejects(stageDesktop0721Resources({ upstream, outputDir: path.join(evidence, "rejected-native"), notificationNativePath: badNative }), /checksum mismatch/);
  await record("resource-verification.json", { node: process.version, generatedSha256: generated.manifest.outputSha256, verified, invalidNativeRejected: true });
});

test("original tray consumes roster events, shows recent five eligible bots, unread, busy, reset and dispose", options, async () => {
  const p = makePorts();
  const desktop = createDesktop0721(p.options);
  const tray = p.trays[0];
  const agents = [agent("old", 1), ...Array.from({ length: 5 }, (_, i) => agent(String(i), i + 2)),
    agent("group", 100, { isGroup: true }), agent("hidden", 101, { isHiddenFromSidebar: true }),
    agent("team", 7, { isHiddenFromSidebar: true, viewerIsOwner: false, isTeamDefault: true })];
  desktop.roster.handleAgentsEvent({ agents });
  const entries = tray.menu.filter((item) => item.accelerator?.startsWith("CommandOrControl"));
  assert.deepEqual(entries.map((item) => item.label), ["● Bot team", "● Bot 4", "● Bot 3", "● Bot 2", "● Bot 1"]);
  assert.equal(tray.title, "7");
  entries[0].click();
  assert.deepEqual(p.trace.slice(-2), [["show-app"], ["select-bot", "team"]]);
  tray.menu.find((item) => item.accelerator === "CmdOrCtrl+,").click();
  assert.deepEqual(p.trace.slice(-2), [["show-app"], ["app-settings"]]);
  tray.menu.at(-1).click();
  assert.deepEqual(p.trace.at(-1), ["quit"]);
  desktop.roster.handleAgentActivity({ agentId: "team", live: { isRunning: true, isComposingMessage: false } });
  assert.equal(desktop.roster.snapshot().find(({ summary }) => summary.id === "team").isBusy, true);
  assert.ok(p.timers.size > 0);
  const tick = p.timers.entries().next().value;
  p.timers.delete(tick[0]); tick[1]();
  assert.ok(p.trace.filter(([event]) => event === "image").length >= 2);
  desktop.roster.handleAgentActivity({ agentId: "team", live: null });
  assert.equal(p.timers.size, 0);
  assert.equal(tray.image.name, "brand.png");
  desktop.roster.handleAgentUpsertedEvent({ agent: agent("team", 9, { hasUnread: false }) });
  assert.equal(tray.title, "6");
  desktop.reset();
  assert.equal(tray.title, "");
  assert.equal(tray.menu.filter((item) => item.accelerator?.startsWith("CommandOrControl")).length, 0);
  desktop.roster.seedRoster([agent("busy", 10, { isRunning: true })]);
  desktop.dispose(); desktop.dispose();
  assert.equal(p.timers.size, 0);
  const count = p.trace.length;
  desktop.roster.handleAgentsEvent({ agents });
  assert.equal(p.trace.length, count);
  assert.equal(tray.destroyed, true);
  assert.deepEqual(p.errors, []);
  assert.equal(p.trace.some(([event]) => event === "notification-created"), false);
  await record("tray-events.json", { agents, trace: p.trace, errors: p.errors, timersRemaining: p.timers.size });
});

test("original roster rejects stale generations and snapshots across reset", options, async () => {
  const p = makePorts();
  const u = transplant(p.options);
  const roster = u.createRoster();
  roster.seedRoster([agent("local", 1, { snapshotEpoch: "a", snapshotSeq: 3 })]);
  roster.handleAgentUpsertedEvent({ agent: agent("local", 0, { snapshotEpoch: "a", snapshotSeq: 2 }) });
  assert.equal(roster.snapshot()[0].summary.updatedAt, 1);
  const old = roster.beginServerRosterRead();
  roster.reset();
  roster.installServerRoster({ status: "ready", agents: [agent("stale", 10)] }, old);
  assert.deepEqual(roster.snapshot(), []);
  const next = roster.beginServerRosterRead();
  roster.installServerRoster({ status: "ready", agents: [agent("current", 11)] }, next);
  assert.equal(roster.snapshot()[0].summary.id, "current");
  await record("roster-generations.json", { old, next, snapshot: roster.snapshot() });
});

test("permission mappings preserve unavailable, undetermined, denied, granted and native diagnostics", options, async () => {
  const cases = [
    { settings: [{ platform: "darwin", setting: "notDetermined" }], expected: "undetermined" },
    ...["authorized", "provisional", "ephemeral"].map((setting) => ({ settings: [{ platform: "darwin", setting, alertSetting: "disabled" }], expected: "granted" })),
    { settings: [{ platform: "darwin", setting: "denied" }], expected: "denied" },
    { settings: [null], expected: "unavailable" },
    { settings: [{ platform: "win32", setting: "enabled" }], expected: "unavailable" },
    { settings: [{ platform: "darwin", setting: "surprise" }], expected: "unavailable" },
    { settings: [new Error("native read failed")], expected: "unavailable" },
    { nativeError: new Error("missing native module"), expected: "unavailable" },
    { platform: "linux", expected: "unavailable" },
    { platform: "win32", settings: [{ platform: "win32", setting: "policyDisabled" }], expected: "denied" },
    { platform: "win32", settings: [{ platform: "win32", setting: "enabled" }], expected: "granted" },
  ];
  const results = [];
  for (const scenario of cases) {
    const p = makePorts(scenario);
    const desktop = createDesktop0721(p.options);
    const result = await desktop.getDesktopNotificationPermission();
    assert.equal(result.status, scenario.expected);
    assert.equal(result.canOpenSettings, scenario.platform !== "linux");
    assert.equal(p.trace.some(([event]) => event.startsWith("notification") || event === "open-settings"), false);
    results.push({ scenario, result });
    desktop.dispose();
  }
  await record("permission-readings.json", results);
});

test("staged native package loads through original CC without querying or sending notifications", options, async () => {
  const p = makePorts();
  const filename = path.join(evidence, "staged/dist/deps/sand-notification-settings/index.js");
  p.options.loadNotificationNative = () => require(filename);
  const u = transplant(p.options);
  const loaded = u.loadNative();
  assert.equal(loaded.kind, "loaded");
  assert.equal(typeof loaded.native.notification_settings_async, "function");
  const invalid = transplant({ ...p.options, loadNotificationNative: () => ({}) }).loadNative();
  assert.deepEqual(invalid, { kind: "unavailable", loadError: "MissingExport" });
  assert.equal(p.trace.length, 0);
  await record("native-load.json", { filename, node: process.version, kind: loaded.kind,
    exports: Object.keys(loaded.native), invalid, permissionReadInvoked: false, notificationSent: false });
});

test("only explicit permission request probes, polling settles and OS settings uses original URLs", options, async () => {
  const p = makePorts({ settings: [{ platform: "darwin", setting: "notDetermined" }, { platform: "darwin", setting: "notDetermined" },
    { platform: "darwin", setting: "authorized" }], autoClock: true });
  const desktop = createDesktop0721(p.options);
  assert.equal(p.trace.some(([event]) => event.startsWith("notification")), false);
  assert.equal((await desktop.requestDesktopNotificationPermission()).status, "granted");
  assert.equal(p.trace.filter(([event]) => event === "notification-shown").length, 1);
  assert.equal(p.trace.find(([event]) => event === "notification-shown")[1].silent, true);
  assert.equal(await desktop.openDesktopNotificationSettings(), true);
  assert.deepEqual(p.trace.at(-1), ["open-settings", "x-apple.systempreferences:com.apple.Notifications-Settings.extension"]);
  await desktop.requestDesktopNotificationPermission();
  assert.equal(p.trace.filter(([event]) => event === "notification-shown").length, 1);
  desktop.dispose();
  const denied = makePorts({ settings: [{ platform: "darwin", setting: "denied" }] });
  const other = createDesktop0721(denied.options);
  assert.equal((await other.requestDesktopNotificationPermission()).status, "denied");
  const originalComposition = transplant(denied.options).composePermission({ notificationCtor: denied.options.electron.Notification });
  assert.equal((await originalComposition.get()).status, "denied");
  assert.equal((await originalComposition.request()).status, "denied");
  assert.equal(denied.trace.some(([event]) => event.startsWith("notification")), false);
  other.dispose();
  const pending = makePorts({ settings: [{ platform: "darwin", setting: "notDetermined" }], autoClock: true });
  const stillPending = createDesktop0721(pending.options);
  assert.equal((await stillPending.requestDesktopNotificationPermission()).status, "undetermined");
  assert.equal(pending.trace.filter(([event]) => event === "schedule").length, 119);
  stillPending.dispose();
  const linux = makePorts({ platform: "linux" });
  const unavailable = createDesktop0721(linux.options);
  assert.equal(await unavailable.openDesktopNotificationSettings(), false);
  unavailable.dispose();
  await record("permission-actions.json", { granted: p.trace, denied: denied.trace, pending: pending.trace, unsupported: linux.trace });
});

test("concurrent permission calls retain each reading and permission failures propagate", options, async () => {
  const p = makePorts({ settings: [{ platform: "darwin", setting: "denied" }, { platform: "darwin", setting: "authorized" }] });
  const desktop = createDesktop0721(p.options);
  const values = await Promise.all([desktop.getDesktopNotificationPermission(), desktop.getDesktopNotificationPermission()]);
  assert.deepEqual(values.map(({ status }) => status), ["denied", "granted"]);
  assert.deepEqual(values.map(({ reading }) => reading.osSetting), ["denied", "authorized"]);
  p.options.electron.shell.openExternal = async () => { throw new Error("OS settings refused"); };
  await assert.rejects(desktop.openDesktopNotificationSettings(), /OS settings refused/);
  desktop.dispose();
  await assert.rejects(desktop.requestDesktopNotificationPermission(), /disposed/);
  await record("permission-concurrency.json", { values, trace: p.trace, settingsFailurePropagated: true, disposedRequestRejected: true });
});

test("preferences persist through reconstruction, serialize writes, and propagate storage failures", options, async () => {
  const filename = path.join(evidence, "preferences.json");
  const writes = [];
  let failWrite = false;
  const storage = {
    async read() { try { return JSON.parse(await readFile(filename, "utf8")); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } },
    async write(value) { if (failWrite) throw new Error("disk refused write"); await writeFile(`${filename}.tmp`, JSON.stringify(value)); await rename(`${filename}.tmp`, filename); writes.push(value); },
  };
  const defaults = { playSound: true, sound: "ping-1-open-blip" };
  await storage.write(defaults);
  const p = makePorts({ storage });
  let desktop = createDesktop0721(p.options);
  assert.deepEqual(await desktop.getDesktopNotificationPreferences(), defaults);
  const values = [{ playSound: false, sound: "ping-4-chime-a" }, { playSound: true, sound: "ping-5-chime-b" }];
  assert.deepEqual(await Promise.all(values.map((preferences) => desktop.setDesktopNotificationPreferences({ preferences }))), values);
  desktop.dispose();
  desktop = createDesktop0721(p.options);
  assert.deepEqual(await desktop.getDesktopNotificationPreferences(), values[1]);
  await assert.rejects(desktop.setDesktopNotificationPreferences({ preferences: { playSound: "yes", sound: "invented" } }), /Invalid/);
  failWrite = true;
  await assert.rejects(desktop.setDesktopNotificationPreferences({ preferences: values[0] }), /disk refused/);
  assert.deepEqual(await desktop.getDesktopNotificationPreferences(), values[1]);
  assert.deepEqual(writes, [defaults, ...values]);
  assert.equal(p.trace.some(([event]) => event.startsWith("notification")), false);
  await writeFile(filename, "invalid json");
  await assert.rejects(desktop.getDesktopNotificationPreferences(), SyntaxError);
  await writeFile(filename, JSON.stringify(values[1]));
  desktop.dispose();
  await record("preference-actions.json", { filename, writes, trace: p.trace, persisted: JSON.parse(await readFile(filename, "utf8")) });
});

test("personal rules delegate to existing storage and execute original edit/delete/cap operations", options, async () => {
  const p = makePorts();
  const desktop = createDesktop0721(p.options);
  const original = await desktop.getAutoReviewInstructions();
  const rules = ruleModule.operations;
  const next = rules.editRule({ instructions: original, text: "Ask before external upload", behavior: "ask", editing: null });
  assert.deepEqual(next.blockInstructions, ["Ask before external upload"]);
  assert.deepEqual(await desktop.setAutoReviewInstructions({ instructions: next }), next);
  p.options.rules.setAutoReviewInstructions = async () => { throw new Error("existing rules rollback"); };
  await assert.rejects(desktop.setAutoReviewInstructions({ instructions: next }), /existing rules rollback/);
  assert.equal(rules.editRule({ instructions: next, text: next.blockInstructions[0], behavior: "ask", editing: null }), null);
  const grouped = rules.groupRules(next);
  assert.deepEqual(rules.deleteRule(next, grouped.ask[0]), original);
  const full = { ...original, allowInstructions: Array.from({ length: 20 }, (_, i) => `Rule ${i}`) };
  assert.equal(rules.editRule({ instructions: full, text: "21st", behavior: "allow", editing: null }), null);
  const edited = rules.editRule({ instructions: full, text: "Replacement", behavior: "allow", editing: rules.groupRules(full).allow[0] });
  assert.equal(edited.allowInstructions.length, 20);
  assert.equal(edited.allowInstructions[0], "Replacement");
  const translate = ({ id }) => id;
  const Button = ({ children, disabled, onClick, "aria-label": label }) => jsxRuntime.jsx("button", { disabled, onClick, "aria-label": label, children });
  const RulesEditor = ruleModule.createPersonalRulesEditor({ React, jsxRuntime, compilerRuntime,
    useLingui: () => ({ i18n: { _: translate }, _: translate }), Trans: ({ id }) => id,
    Button, IconButton: Button, Text: ({ as: tag = "span", children, id }) => React.createElement(tag, { id }, children),
    Tooltip: ({ children }) => children, Icon: () => null, styles: () => ({}), controlStyles: { controlRing: {} } });
  const html = renderToStaticMarkup(jsxRuntime.jsx(RulesEditor, { instructions: next, disabled: false, onChange() {} }));
  assert.match(html, /Ask before external upload/);
  assert.match(html, /sand-permissions-ask-heading/);
  assert.match(html, /sand-permissions-allow-heading/);
  await writeFile(path.join(evidence, "personal-rules.html"), html);
  await record("personal-rules.json", { next, edited, trace: p.trace });
  desktop.dispose();
});

test("missing tray resources return unavailable without pretending to construct a tray", options, async () => {
  const p = makePorts({ missingAssets: true });
  const desktop = createDesktop0721(p.options);
  assert.equal(desktop.trayAvailable, false);
  assert.equal(p.trays.length, 0);
  assert.deepEqual(await desktop.getDesktopNotificationPreferences(), { playSound: true, sound: "ping-1-open-blip" });
  desktop.dispose();
  await record("missing-assets.json", { trayAvailable: desktop.trayAvailable, trace: p.trace });
});

