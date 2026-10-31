import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const snapshotSkip = existsSync(path.resolve(root, "..", "rea-grokbot-0781/asar/app.asar"))
  ? false
  : "rea-grokbot-0781 snapshot is not present on this machine";

// A minimal fake settings chunk carrying the hardware-acceleration patch output
// (its slot rewrite is the notification-sound pass's anchor; the marker identifies it).
function fakeSettingsChunk() {
  return [
    "function RHwAccelSection(){}",
    "function Sa(){var r=a.jsxs(a.Fragment,{children:[a.jsx(RLangSection,{}),a.jsx(RHwAccelSection,{})]});return r}",
  ].join("\n");
}

test("notification-sound patch appends the section after the HW slot and is order-stable", async () => {
  const { patchNotificationSoundSettings0781 } = await import("../scripts/lib/notification-sound-settings-0781-patch.mjs");
  const { patchScheduleSettings0781 } = await import("../scripts/lib/schedule-settings-0781-patch.mjs");
  const first = patchNotificationSoundSettings0781(fakeSettingsChunk());
  assert.equal(first.applied, true);
  assert.match(first.text, /children:\[a\.jsx\(RLangSection,\{\}\),a\.jsx\(RHwAccelSection,\{\}\),a\.jsx\(RNotificationSoundSection,\{\}\)\]/);
  const second = patchScheduleSettings0781(first.text);
  assert.equal(second.applied, true);
  assert.match(second.text, /RNotificationSoundSection,\{\}\),a\.jsx\(RScheduleTimezoneSection,\{\}\),a\.jsx\(RSpellCheckSection,\{\}\)/);
  // Section component bodies are appended exactly once and the file parses (acorn inside the patch).
  assert.equal(second.text.split("function RNotificationSoundSection()").length - 1, 1);
  assert.equal(second.text.split("function RScheduleTimezoneSection()").length - 1, 1);
  assert.equal(second.text.split("function RSpellCheckSection()").length - 1, 1);
  // Idempotence and failure modes.
  assert.equal(patchNotificationSoundSettings0781(second.text).reason, "already-present");
  assert.equal(patchScheduleSettings0781(second.text).reason, "already-present");
  assert.equal(patchNotificationSoundSettings0781("function RHwAccelSection(){}").reason, "anchor-missing");
  assert.equal(patchScheduleSettings0781("function RNotificationSoundSection(){}").reason, "anchor-missing");
  const ambiguous = fakeSettingsChunk() + "\n" + fakeSettingsChunk().split("\n")[1];
  assert.match(patchNotificationSoundSettings0781(ambiguous).reason, /^anchor-ambiguous:/);
  assert.equal(patchNotificationSoundSettings0781("var unrelated=1;").reason, "not-settings-chunk");
});

test("sound rows carry the official zh labels and the bridge the 0.72.1 port staged", async () => {
  const patchSource = await readFile(path.join(root, "scripts/lib/notification-sound-settings-0781-patch.mjs"), "utf8");
  const { NOTIFICATION_SOUNDS_0781 } = await import("../scripts/lib/notification-sounds-0781.mjs");
  for (const zh of ["为通知播放声音", "开启或关闭 Grok Bot 给你发消息时播放的声音", "通知声音", "选择 Grok Bot 给你发消息时播放的声音"]) {
    assert.ok(patchSource.includes(zh), `official zh label present: ${zh}`);
  }
  // The five option labels are data in the sounds module; the patch renders s.zh per locale.
  for (const sound of NOTIFICATION_SOUNDS_0781) {
    assert.ok(sound.zh.length > 0, `zh option label present: ${sound.id}`);
  }
  assert.match(patchSource, /label:loc==="zh-CN"\?s\.zh:s\.en/);
  // Option ids must equal the desktop-0721 sound enum (source/shared/desktop-0721.ts).
  const desktop0721 = await readFile(path.join(root, "source/shared/desktop-0721.ts"), "utf8");
  const enumIds = [...desktop0721.matchAll(/"(ping-\d-[a-z-]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(enumIds, ["ping-1-open-blip", "ping-2-tick", "ping-3-double-tick", "ping-4-chime-a", "ping-5-chime-b"]);
  assert.deepEqual(NOTIFICATION_SOUNDS_0781.map((s) => s.id), enumIds);
  // The settings section talks to the staged desktop0721 bridge and the playback event.
  assert.match(patchSource, /getDesktopNotificationPreferences/);
  assert.match(patchSource, /setDesktopNotificationPreferences/);
  assert.match(patchSource, /onNotificationSound/);
  assert.match(patchSource, /new URL\(entry\.file,import\.meta\.url\)/);
  // Timezone row writes through the existing timeZone bridge with the official auto semantics.
  const scheduleSource = await readFile(path.join(root, "scripts/lib/schedule-settings-0781-patch.mjs"), "utf8");
  assert.match(scheduleSource, /setOverride\(next===RScheduleTimezoneAuto\?null:next\)/);
  assert.match(scheduleSource, /Intl\.supportedValuesOf\("timeZone"\)/);
  for (const zh of ["时区", "设置 Grok Bot 用于日程和提醒的时区", "自动检测", "输入时检查拼写", "输入时为拼写错误的单词加下划线"]) {
    assert.ok(scheduleSource.includes(zh), `official zh label present: ${zh}`);
  }
});

test("staged notification sounds are byte-identical to the pinned 0.78.1 extraction", { skip: snapshotSkip }, async () => {
  const { stageNotificationSounds0781, verifyStagedNotificationSounds0781, NOTIFICATION_SOUNDS_0781 } = await import("../scripts/lib/notification-sounds-0781.mjs");
  const { openUpstream0781 } = await import("../scripts/lib/upstream-0781.mjs");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "notif-sounds-"));
  try {
    const archive = await openUpstream0781();
    const outcome = await stageNotificationSounds0781({ stageRoot: temporary, archive });
    assert.equal(outcome.files.length, 5);
    await verifyStagedNotificationSounds0781({ stageRoot: temporary, archive });
    for (const sound of NOTIFICATION_SOUNDS_0781) {
      const bytes = await readFile(path.join(temporary, "dist/renderer/assets", sound.file));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), sound.sha256);
    }
    // The zh/en labels equal the official catalogs: the eager-app option table maps
    // each ping id to a label id (BnX6kI…), and the zh pack resolves label id → zh.
    const eagerApp = archive.read("dist/renderer/assets/index.eager-app-D1juOWZp.js").toString("utf8");
    const zhPack = archive.read("dist/renderer/assets/chunk-settings-BbrFWJId.js").toString("utf8");
    const officialZh = (id) => {
      const at = zhPack.indexOf(`"${id}":[`);
      assert.ok(at >= 0, `official zh id present: ${id}`);
      return JSON.parse(zhPack.slice(at + id.length + 3, zhPack.indexOf("]", at) + 1))[0];
    };
    for (const sound of NOTIFICATION_SOUNDS_0781) {
      const at = eagerApp.indexOf(`id:\`${sound.id}\`,label:{id:\``);
      assert.ok(at >= 0, `official option table entry present: ${sound.id}`);
      const labelId = eagerApp.slice(at + `id:\`${sound.id}\`,label:{id:\``.length).match(/^[^`]+/)?.[0];
      assert.ok(labelId, `label id resolvable for ${sound.id}`);
      assert.equal(officialZh(labelId), sound.zh, `official zh label for ${sound.id}`);
    }
    for (const [id, zh] of [["6EhUT7", "为通知播放声音"], ["0+TImd", "开启或关闭 Grok Bot 给你发消息时播放的声音"], ["wm7RV4", "通知声音"], ["KXGrZy", "选择 Grok Bot 给你发消息时播放的声音"]]) {
      assert.equal(officialZh(id), zh);
    }
    // A corrupted staged file fails the packaging guard.
    await writeFile(path.join(temporary, "dist/renderer/assets", NOTIFICATION_SOUNDS_0781[0].file), "corrupted");
    await assert.rejects(() => verifyStagedNotificationSounds0781({ stageRoot: temporary, archive }), /differs from the pinned upstream extraction/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

async function loadNotificationManager() {
  const output = path.join(root, "node_modules/.cache/os-notification-sound.cjs");
  await build({
    stdin: { contents: 'export { SandOsNotificationManager } from "./source/electron-main/notifications/os-notification-manager.ts";', resolveDir: root, loader: "ts" },
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    logLevel: "error",
  });
  return createRequire(import.meta.url)(output);
}

function fakeWindow(focused) {
  return { isFocused: () => focused, isMinimized: () => false, restore: () => {}, show: () => {}, focus: () => {} };
}

test("notification sound hook: enabled plays through the event and silences the OS notification", async () => {
  const { SandOsNotificationManager } = await loadNotificationManager();
  const plays = [];
  const creations = [];
  let played = false;
  const manager = new SandOsNotificationManager({
    getWindow: () => fakeWindow(false),
    isSupported: () => true,
    createNotification: (options) => {
      creations.push({ silent: options.silent });
      return { on() {}, once() {}, show() {}, close() {} };
    },
    openAgent: () => {},
    notificationSound: { isEnabled: () => true, play: () => { played = true; plays.push("event"); } },
    now: () => Date.now(),
  });
  const agent = { id: "a1", name: "Synthetic", notifyOnUpdatesEnabled: true, isHiddenFromSidebar: false, lastMessagePreview: "hello" };
  manager.handleAgentsEvent({ agents: [{ ...agent, isRunning: true, lastMessageId: "m1" }] });
  manager.handleAgentUpsertedEvent({ agent: { ...agent, isRunning: false, lastMessageId: "m2" } });
  assert.equal(played, true);
  assert.deepEqual(plays, ["event"]);
  assert.equal(creations[creations.length - 1].silent, true, "own sound plays, so the OS notification is silent");
});

test("notification sound hook: disabled keeps today's exact silent semantics", async () => {
  const { SandOsNotificationManager } = await loadNotificationManager();
  const creations = [];
  let played = false;
  const manager = new SandOsNotificationManager({
    getWindow: () => fakeWindow(false),
    isSupported: () => true,
    createNotification: (options) => {
      creations.push({ silent: options.silent, urgency: options.urgency });
      return { on() {}, once() {}, show() {}, close() {} };
    },
    openAgent: () => {},
    notificationSound: { isEnabled: () => false, play: () => { played = true; } },
    now: () => Date.now(),
  });
  const base = { name: "Synthetic", notifyOnUpdatesEnabled: true, isHiddenFromSidebar: false, lastMessagePreview: "hello" };
  manager.handleAgentsEvent({ agents: [
    { id: "a1", isRunning: true, awaitingUserResponse: null, lastMessageId: "m1", ...base },
    { id: "a2", isRunning: true, awaitingUserResponse: null, lastMessageId: "m3", ...base, name: "S2" },
  ] });
  manager.handleAgentUpsertedEvent({ agent: { id: "a1", isRunning: false, awaitingUserResponse: null, lastMessageId: "m2", ...base } });
  manager.handleAgentUpsertedEvent({ agent: { id: "a2", isRunning: true, awaitingUserResponse: { reason: "approval" }, lastMessageId: "m4", ...base, name: "S2" } });
  assert.equal(played, false);
  assert.equal(creations.length, 2);
  assert.equal(creations[0].silent, true, "agent-done stays silent");
  assert.equal(creations[1].silent, false, "needs-input keeps the OS default sound");
  assert.equal(creations[1].urgency, "critical");
});

test("spell-check setting round-trips with the Chromium default enabled", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "spell-check-"));
  try {
    const esbuild = await import("esbuild");
    const outfile = path.join(root, "node_modules/.cache/spell-check-store.cjs");
    await esbuild.build({
      stdin: { contents: 'export { SandSettingsStore } from "./source/shared/node/settings/sand-settings-store.ts";', resolveDir: root, loader: "ts" },
      outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "error",
    });
    const { SandSettingsStore: Store } = createRequire(import.meta.url)(outfile);
    const settingsPath = path.join(temporary, "settings.json");
    const store = new Store(settingsPath);
    assert.equal(store.getSpellCheckEnabled(), true, "unset follows the Chromium default (enabled)");
    store.setSpellCheckEnabled(false);
    assert.equal(store.getSpellCheckEnabled(), false);
    assert.equal(new Store(settingsPath).getSpellCheckEnabled(), false, "persists across a reload (parse whitelist reads the field)");
    store.setSpellCheckEnabled(true);
    assert.equal(new Store(settingsPath).getSpellCheckEnabled(), true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("local cron scheduler honors the user timezone override when deciding due", async () => {
  const esbuild = await import("esbuild");
  const outfile = path.join(root, "node_modules/.cache/local-cron-scheduler.cjs");
  await esbuild.build({
    stdin: { contents: 'export { LocalCronScheduler } from "./source/host/extensions/automations/sand-automation-cloud-sync.ts";', resolveDir: root, loader: "ts" },
    outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "error",
  });
  const { LocalCronScheduler } = createRequire(import.meta.url)(outfile);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "local-cron-tz-"));
  try {
    // 09:00 daily, created 2026-06-01T00:00Z, now 2026-06-01T12:00Z:
    //   UTC view        → today's 09:00Z already passed  → due.
    //   Kiritimati view → 09:00 KIT = 19:00Z (after now) → not due yet.
    const createdAt = Date.parse("2026-06-01T00:00:00Z");
    const now = Date.parse("2026-06-01T12:00:00Z");
    const buildScheduler = (getTimeZone, ledgerName) => {
      const fired = [];
      const scheduler = new LocalCronScheduler({
        ledgerPath: path.join(temporary, ledgerName),
        now: () => now,
        listAutomations: async () => [{ agentId: "a1", automation: { id: "r1", isEnabled: true, trigger: { type: "cron", schedule: "0 9 * * *" }, createdAt, lastRunAt: null } }],
        fire: async (agentId) => { fired.push(agentId); },
        getTimeZone,
      });
      return { scheduler, fired };
    };
    const utc = buildScheduler(() => "UTC", "utc.json");
    await utc.scheduler.tick();
    assert.deepEqual(utc.fired, ["a1"], "UTC 09:00 already passed at 12:00Z");
    const kiritimati = buildScheduler(() => "Pacific/Kiritimati", "kit.json");
    await kiritimati.scheduler.tick();
    assert.deepEqual(kiritimati.fired, [], "09:00 Kiritimati (= 19:00Z) has not passed at 12:00Z");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("per-bot notify chain is wired end to end (renderer RPC → gateway → lifecycle → gate)", async () => {
  const gateway = await readFile(path.join(root, "source/host/gateway-protocol.ts"), "utf8");
  assert.match(gateway, /setAgentNotifyOnUpdates: \(api: GatewayApi, body: string\) => api\.setAgentNotifyOnUpdates/);
  const lifecycle = await readFile(path.join(root, "source/host/extensions/transcript/agent-lifecycle.ts"), "utf8");
  assert.match(lifecycle, /async setAgentNotifyOnUpdates\(/);
  const gate = await readFile(path.join(root, "source/shared/os-notification.ts"), "utf8");
  assert.match(gate, /notifyOnUpdatesEnabled/);
  // The desktop wiring feeds the manager's new sound hook.
  const production = await readFile(path.join(root, "source/electron-main/production-binding-providers.ts"), "utf8");
  assert.match(production, /notificationSound: \{/);
  assert.match(production, /emit\("notification-sound", \{ sound \}\)/);
  // The host-side cron firer consumes the user timezone.
  const cloudSync = await readFile(path.join(root, "source/host/extensions/automations/sand-automation-cloud-sync.ts"), "utf8");
  assert.match(cloudSync, /computeNextRunAt\(schedule, automation\.lastRunAt \?\? automation\.createdAt, this\.deps\.getTimeZone\?\.\(\)\)/);
  const extension = await readFile(path.join(root, "source/host/extensions/automations/extension.ts"), "utf8");
  assert.match(extension, /getTimeZone: \(\) => deps\.settings\.getUserTimeZone\(\),\s*\n\s*\}\);/);
});
