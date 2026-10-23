import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module, { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { generateDesktop0721Module, stageDesktop0721Resources } from "../scripts/lib/desktop-0721.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = path.resolve(process.env.DESKTOP_RUNTIME_0721_EVIDENCE_DIR ?? path.join(root, ".omo/evidence/desktop-runtime-0721"));
const require = createRequire(import.meta.url);
const record = (name, value) => writeFile(path.join(evidence, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
let api, upstream, catalogs;
let electronLoads = 0;

before(async () => {
  await mkdir(evidence, { recursive: true });
  const outfile = path.join(evidence, "runtime.cjs");
  await build({ stdin: { resolveDir: root, contents: [
    'export * from "./source/electron-main/desktop-runtime-0721.ts";',
    'export {createProductionMainRpcAdapter} from "./source/electron-main/adapters/main-rpc.ts";',
    'export {createMainEdgeHandlers} from "./source/electron-main/main-edge.ts";',
    'export {SandSettingsStore} from "./source/shared/node/settings/sand-settings-store.ts";',
  ].join("\n") }, outfile, platform: "node", format: "cjs", bundle: true, packages: "external", logLevel: "silent" });
  const load = Module._load;
  Module._load = function (id, ...args) {
    if (id === "electron") { electronLoads++; throw new Error("Unexpected Electron import"); }
    return load.call(this, id, ...args);
  };
  try { api = require(outfile); } finally { Module._load = load; }
  await generateDesktop0721Module({ outputFile: path.join(evidence, "upstream.cjs") });
  ({ createDesktop0721Upstream: upstream, desktopCatalogs: catalogs } = require(path.join(evidence, "upstream.cjs")));
});

test("main-edge and desktop runtime import without loading Electron; prepare registers scheme", async () => {
  assert.equal(electronLoads, 0);
  assert.equal(typeof api.createMainEdgeHandlers, "function");
  assert.equal(api.readDesktop0721(), undefined);
  const schemes = [];
  const prepared = api.prepareDesktop0721({ protocol: { registerSchemesAsPrivileged: (value) => schemes.push(value) } });
  assert.equal(typeof prepared.create, "function");
  assert.equal(schemes[0][0].scheme, "sand-visualization");
  assert.equal(schemes[0][0].privileges.secure, true);
  await record("electron-import-and-prepare", { electronLoads, schemes, desktopCreated: false });
});

function resolver(overrides = {}) {
  return { settingsStore: {}, agentPrefsStore: {}, boxToggleStore: {}, onboardingSeen: {}, shell: {},
    windowChrome: {}, boxRecovery: {}, attachments: {}, avatarImages: {},
    ensureTranscriptionManager: async () => ({}), fetchAvailableModels: async () => [],
    recordLocalToolApproval: async () => {}, clearLocalToolApprovals: async () => {},
    getAutomationWebhookCredential: async () => "", syncHostSettingsToBox: async () => ({}),
    broadcast() {}, platform: "darwin", ipcMain: { handle() {}, removeHandler() {} },
    getTrustedContents: () => null, ...overrides };
}

test("main RPC validates and resolves before lifecycle callback and serves afterwards", async () => {
  const trace = [];
  const store = {};
  const adapter = api.createProductionMainRpcAdapter({
    resolveDeps() { trace.push("resolve"); return resolver({ settingsStore: store, serveEdge() { trace.push("serve"); return { emit() {} }; } }); },
    beforeServe(context, deps) {
      assert.equal(deps.settingsStore, store);
      assert.equal(typeof deps.serveEdge, "function");
      assert.ok(deps.mainMethodTable);
      trace.push("beforeServe");
    },
  });
  adapter.create({});
  assert.deepEqual(trace, ["resolve", "beforeServe", "serve"]);
  const invalid = api.createProductionMainRpcAdapter({ resolveDeps: () => resolver({ ipcMain: {} }), beforeServe() { trace.push("invalid-created"); } });
  assert.throws(() => invalid.create({}), /ipcMain.handle/);
  assert.equal(trace.includes("invalid-created"), false);
  await record("validated-lifecycle", { trace, invalidRejectedBeforeCreation: true });
});

test("notification preferences survive reload and unrelated updates without enabling notifications", async () => {
  const file = path.join(evidence, "preferences-settings.json");
  const store = new api.SandSettingsStore(file);
  store.persist({ ...store.load(), desktopNotificationPreferences: undefined, notifications: { isEnabled: false } });
  const before = await readFile(file, "utf8");
  assert.equal(store.getDesktopNotificationPreferences(), undefined);
  assert.equal(await readFile(file, "utf8"), before);
  const sounds = ["ping-1-open-blip", "ping-2-tick", "ping-3-double-tick", "ping-4-chime-a", "ping-5-chime-b"];
  for (const sound of sounds) {
    store.setDesktopNotificationPreferences({ playSound: false, sound });
    store.setLanguagePreference("zh-CN");
    assert.deepEqual(new api.SandSettingsStore(file).getDesktopNotificationPreferences(), { playSound: false, sound });
    assert.deepEqual(store.load().notifications, { isEnabled: false });
  }
  assert.throws(() => store.setDesktopNotificationPreferences({ playSound: true, sound: "invalid" }));
  store.persist({ ...store.load(), desktopNotificationPreferences: { playSound: "yes", sound: sounds[0] } });
  assert.equal(new api.SandSettingsStore(file).getDesktopNotificationPreferences(), undefined);
  await record("preferences-roundtrip", { sounds, invalidWriteRejected: true, invalidPersistedIgnored: true, readDidNotWrite: true, notifications: store.load().notifications });
});

test("desktop rules use MainEdge host echo and rollback semantics", async () => {
  const store = new api.SandSettingsStore(path.join(evidence, "rules-settings.json"));
  const previous = { isEnabled: false, allowInstructions: ["previous"], blockInstructions: [] };
  const next = { isEnabled: true, allowInstructions: ["new rule"], blockInstructions: ["blocked rule"] };
  store.setAutoReviewInstructions(previous);
  const calls = [];
  let reject = true;
  const rules = api.createDesktop0721Rules({ settingsStore: store, syncHostSettingsToBox: async (value) => {
    calls.push(value); return reject ? {} : value;
  } });
  await assert.rejects(rules.setAutoReviewInstructions({ instructions: next }), /confirm/);
  assert.deepEqual(await rules.getAutoReviewInstructions(), previous);
  reject = false;
  assert.deepEqual(await rules.setAutoReviewInstructions({ instructions: next }), next);
  await record("rules-rollback", { calls, restoredAfterFailure: previous, persistedAfterEcho: store.getAutoReviewInstructions() });
});

test("real upstream roster consumes validated seeds, snapshots, upserts and activity", async () => {
  const failures = [];
  const original = upstream({ electron: {}, translate: () => "", reportFailure: (...args) => failures.push(args) });
  const roster = original.createRoster();
  const feed = api.createDesktop0721RosterFeed(() => roster);
  const agent = { id: "bot-a", name: "Bot A", updatedAt: 1, hasUnread: true, isRunning: false, isComposingMessage: false };
  feed.onAgentsRosterSeed({ agents: [agent] });
  assert.equal(roster.snapshot()[0].summary.id, "bot-a");
  feed.onAgentsEvent({ kind: "agents", event: { agents: [{ ...agent, name: "Changed" }] } });
  feed.onAgentsEvent({ kind: "agent-upserted", event: { agent: { ...agent, id: "bot-b" } } });
  feed.onAgentsEvent({ kind: "agent-activity", event: { agentId: "bot-b", live: { isRunning: true, isComposingMessage: false } } });
  const snapshot = roster.snapshot();
  assert.equal(snapshot[0].summary.name, "Changed");
  assert.equal(snapshot[1].isBusy, true);
  for (const payload of [null, { agents: [{}] }, { agents: [{ ...agent, updatedAt: NaN }] }]) feed.onAgentsRosterSeed(payload);
  feed.onAgentsEvent({ kind: "agent-upserted", event: { agent: { ...agent, isRunning: "yes" } } });
  assert.deepEqual(roster.snapshot(), snapshot);
  roster.reset();
  assert.deepEqual(roster.snapshot(), []);
  assert.deepEqual(failures, []);
  await record("validated-roster", { snapshot, resetEmpty: true, malformedIgnored: true });
});

test("pinned en and zh-CN catalogs render every tray message with exact interpolation", async () => {
  let locale = "en";
  const translate = api.createDesktop0721Translator(catalogs, () => locale);
  const output = {};
  for (locale of ["en", "zh-CN"]) {
    output[locale] = Object.fromEntries(Object.keys(catalogs[locale]).map((id) => [id, translate({ id, values: { 0: "Grok Node" } })]));
    for (const [id, label] of Object.entries(output[locale])) { assert.notEqual(label, id); assert.ok(label.length); }
  }
  assert.equal(output.en.HWAICJ, "Open Grok Node");
  assert.equal(output.en.n02Ulq, "Quit Grok Node");
  assert.equal(output.en["2hjDEV"], "New Bot");
  assert.equal(output.en["0Khkjg"], "New Team Bot");
  assert.equal(output.en.Ofh1Nm, "Disk Saver");
  assert.equal(output["zh-CN"]["4ybWti"], "最近的 Bot");
  assert.throws(() => translate({ id: "missing" }), /Missing desktop translation/);
  assert.throws(() => translate({ id: "HWAICJ" }), /interpolation/);
  await record("catalog-labels", output);
});

test("tray photo requests read the coordinator cache and reject invalid keys", async () => {
  const dataDir = path.join(evidence, "photo-data");
  const cache = path.join(dataDir, "roster-avatars");
  await mkdir(cache, { recursive: true });
  const key = "0123456789abcdef0123456789abcdef";
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDhcAAAAASUVORK5CYII=", "base64");
  await writeFile(path.join(cache, key), bytes);
  const photos = api.createDesktop0721RosterPhotos(dataDir);
  const response = await photos.serve(new Request(`sand-roster-photo://photo/${key}`));
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const invalid = await photos.serve(new Request("sand-roster-photo://photo/%2e%2e%2fsecret"));
  assert.equal(invalid.status, 400);
  const missing = await photos.serve(new Request(`sand-roster-photo://photo/${"f".repeat(32)}`));
  assert.equal(missing.status, 404);
  await record("roster-photo-cache", { key, bytes: bytes.length, status: response.status, invalidStatus: invalid.status, missingStatus: missing.status });
});

test("production desktop creates the original tray, switches a real coordinator leg, persists prefs and cleans up", async () => {
  const staged = path.join(evidence, "production");
  const mainRoot = path.join(staged, "dist/electron-main");
  await stageDesktop0721Resources({ outputDir: staged });
  await generateDesktop0721Module({ outputFile: path.join(mainRoot, "desktop-0721/upstream.cjs") });
  await build({ stdin: { resolveDir: root, contents: 'export * from "./source/electron-main/desktop-runtime-0721.ts"; export {createProductionCoordinatorAuxiliaryPorts} from "./source/electron-main/coordinator/production-root-auxiliary-provider.ts";' },
    outfile: path.join(mainRoot, "runtime.cjs"), platform: "node", format: "cjs", bundle: true, packages: "external", logLevel: "silent",
    plugins: [{ name: "unrelated-mount-and-visualization-boundaries", setup(builder) {
      builder.onLoad({ filter: /desktop-mount\/index\.ts$/ }, () => ({ contents: 'export function createDesktopMount0721(options) { options.electron.mountOptions = options; if (options.electron.failMount) throw new Error("mount failure"); return { dispose() { options.electron.trace.push("mount-disposed"); } }; }', loader: "ts" }));
      builder.onLoad({ filter: /visualization-protocol\.ts$/ }, () => ({ contents: 'export function registerVisualizationScheme(protocol) { protocol.registerSchemesAsPrivileged([]); } export function loadVisualizationDocumentStore() { return {}; } export function createVisualizationProtocol(protocol) { protocol.handle(); return { stage() {}, dispose() { protocol.unhandle(); } }; }', loader: "ts" }));
    } }],
  });
  const runtime = require(path.join(mainRoot, "runtime.cjs"));
  const trace = [], trays = [];
  class Image {
    constructor(width = 18, height = 18) { Object.assign(this, { width, height }); }
    getSize() { return { width: this.width, height: this.height }; }
    isEmpty() { return false; }
    setTemplateImage() {}
    isTemplateImage() { return false; }
    toBitmap({ scaleFactor = 1 } = {}) { return Buffer.alloc(this.width * this.height * 4 * scaleFactor * scaleFactor); }
    addRepresentation() {}
    crop({ width, height }) { return new Image(width, height); }
    resize({ width, height }) { return new Image(width, height); }
  }
  class Tray {
    constructor() { trays.push(this); }
    setIgnoreDoubleClickEvents() {}
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    setImage() {}
    setTitle() {}
    destroy() { this.destroyed = true; trace.push("tray-disposed"); }
  }
  const electron = { trace, failMount: false, Tray, BrowserWindow: class {}, Notification: class { static isSupported() { return false; } },
    Menu: { buildFromTemplate: (value) => value }, shell: { async openExternal() {} },
    app: { name: "Grok Node", quit() {}, getPreferredSystemLanguages: () => ["en"] },
    nativeImage: { createFromPath(file) { assert.ok(file.startsWith(path.join(mainRoot, "menubar-tray/assets"))); return new Image(); },
      createFromDataURL: () => new Image(), createFromBuffer: () => new Image(), createEmpty: () => new Image() },
    protocol: { registerSchemesAsPrivileged() { trace.push("scheme"); }, handle() { trace.push("protocol"); }, unhandle() { trace.push("protocol-disposed"); } },
  };
  const store = new api.SandSettingsStore(path.join(evidence, "production-settings.json"));
  store.setLanguagePreference("en");
  const calls = [], events = [], failures = [], notificationFeeds = [], promptSideEffects = [];
  const context = {
    resources: { preloadPath: path.join(staged, "dist/electron-preload/primary.cjs") },
    attachments: { stageBytes() {}, commitStaged() { promptSideEffects.push("commit"); }, discardStaged() { promptSideEffects.push("discard"); } },
    settings: { settingsStore: store },
    getMainWindow: () => ({ isMinimized: () => false, show() { trace.push("show"); }, focus() { trace.push("focus"); } }),
    coordinatorLegs: { legs: { async openAgent(args) { calls.push(args); }, async sendPrompt() { promptSideEffects.push("send"); } } },
    requireMainEdge: () => ({ emit: (...args) => events.push(args) }),
    requireNotifications: () => ({ onAgentsEvent: (payload) => notificationFeeds.push(payload), onAgentsRosterSeed: (payload) => notificationFeeds.push(payload) }),
    hostSettingsFields: { setBoxStreamLive: (value) => trace.push(["box-stream", value]) },
    reportFailure: (...args) => failures.push(args),
  };
  const prepared = runtime.prepareDesktop0721(electron);
  assert.deepEqual(trace, ["scheme"]);
  const connected = prepared.create(context, { settingsStore: store, syncHostSettingsToBox: async (value) => value });
  const desktop = runtime.readDesktop0721();
  assert.ok(desktop.trayAvailable);
  await electron.mountOptions.onPromptSubmitted({ agentId: "selected-bot", prompt: "renderer owns this", attachments: [{ path: "staged.png", name: "staged.png" }] });
  assert.deepEqual(promptSideEffects, []);
  const failure = new Error("renderer-owned submission");
  electron.mountOptions.onPromptSubmissionError(failure);
  assert.deepEqual(failures.splice(0), [["desktop-mount", "send", failure]]);
  assert.deepEqual(events, []);
  const auxiliary = runtime.createProductionCoordinatorAuxiliaryPorts(context, {});
  const feed = auxiliary.events;
  feed.onAgentsRosterSeed({ agents: [{ id: "selected-bot", name: "Selected Bot", updatedAt: 1, hasUnread: true, isRunning: false, isComposingMessage: false }] });
  trays[0].menu.find((item) => item.accelerator === "CommandOrControl+Shift+1").click();
  await new Promise(setImmediate);
  assert.deepEqual(calls, [{ id: "selected-bot" }]);
  assert.deepEqual(events[0], ["focus-agent", { id: "selected-bot" }]);
  trays[0].menu.find((item) => item.label === "Settings…").click();
  assert.deepEqual(events[1], ["open-settings", {}]);
  assert.equal(notificationFeeds.length, 1);
  auxiliary.resync.onHostSettingsTransportDown();
  assert.deepEqual(desktop.roster.snapshot(), []);
  const preferences = { playSound: false, sound: "ping-4-chime-a" };
  await desktop.setDesktopNotificationPreferences({ preferences });
  assert.deepEqual(new api.SandSettingsStore(store.settingsPath).getDesktopNotificationPreferences(), preferences);
  connected.dispose();
  connected.dispose();
  assert.equal(runtime.readDesktop0721(), undefined);
  assert.equal(trays[0].destroyed, true);
  electron.failMount = true;
  assert.throws(() => prepared.create(context, { settingsStore: store }), /mount failure/);
  assert.equal(runtime.readDesktop0721(), undefined);
  assert.equal(trays[1].destroyed, true);
  assert.equal(trace.filter((entry) => entry === "protocol-disposed").length, 2);
  assert.deepEqual(failures, []);
  await record("production-wiring", { trace, calls, events, preferences, notificationFeeds, promptSideEffects, submissionErrorReportedOnly: true, transportDownClearedRoster: true, startupFailureCleaned: true,
    substitutedBoundaries: ["Electron native API", "desktop mount", "visualization protocol"], originalTrayAndCatalogs: true });
});
