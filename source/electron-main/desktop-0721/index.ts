import type { Desktop0721, Desktop0721Options, DesktopNotificationPermission, DesktopPermissionReading } from "../../shared/desktop-0721.js";

export function createDesktop0721(options: Desktop0721Options): Desktop0721 {
  const upstream = options.transplant(options);
  const roster = upstream.createRoster(options.requestServerRoster === undefined ? {} : { requestServerRoster: options.requestServerRoster });
  const tray = upstream.startMenubarTray({
    assetsDir: options.assetsDir, roster, rosterPhotos: options.rosterPhotos,
    showApp: options.showApp, openAgent: options.onSelectBot, openSettings: options.openSettings,
  });
  const readNative = upstream.readPermission({ platform: options.platform, native: upstream.loadNative() });
  let reading: DesktopPermissionReading = { kind: "unknown", reason: "read_failed" };
  const permission = upstream.createPermission({
    platform: options.platform,
    read: async () => { reading = await readNative(); return reading; },
    showProbe: () => upstream.showProbe(options.electron.Notification),
    openExternal: (url) => options.electron.shell.openExternal(url),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  let disposed = false;
  let writes: Promise<unknown> = Promise.resolve();
  let permissionCalls: Promise<unknown> = Promise.resolve();
  const active = () => { if (disposed) throw new Error("Desktop 0721 is disposed"); };
  const result = (value: { canOpenSettings: boolean }): DesktopNotificationPermission => ({
    status: reading.kind === "known" ? reading.osPermission : "unavailable",
    canOpenSettings: value.canOpenSettings, reading,
  });
  const invokePermission = (action: () => Promise<{ canOpenSettings: boolean }>) => {
    const call = permissionCalls.then(async () => { active(); return result(await action()); });
    permissionCalls = call.catch(() => {});
    return call;
  };
  const readPreferences = async () => {
    const value = await options.storage.read();
    if (value === undefined || value === null) return { ...upstream.defaultPreferences };
    if (!upstream.isPreferences(value)) throw new TypeError("Invalid stored desktop notification preferences");
    return { playSound: value.playSound, sound: value.sound };
  };
  roster.activate();
  return {
    roster,
    trayAvailable: tray !== null,
    async getDesktopNotificationPreferences() { active(); await writes; return readPreferences(); },
    setDesktopNotificationPreferences({ preferences }) {
      active();
      if (!upstream.isPreferences(preferences)) return Promise.reject(new TypeError("Invalid desktop notification preferences"));
      const value = { playSound: preferences.playSound, sound: preferences.sound };
      const write = writes.then(async () => { active(); await options.storage.write(value); return readPreferences(); });
      writes = write.catch(() => {});
      return write;
    },
    getDesktopNotificationPermission() { return invokePermission(permission.get); },
    requestDesktopNotificationPermission() { return invokePermission(permission.request); },
    async openDesktopNotificationSettings() { active(); return permission.openSettings(); },
    getAutoReviewInstructions() { active(); return options.rules.getAutoReviewInstructions(); },
    setAutoReviewInstructions(args) { active(); return options.rules.setAutoReviewInstructions(args); },
    reset() { active(); roster.reset(); },
    dispose() { if (disposed) return; disposed = true; tray?.dispose(); roster.reset(); },
  };
}

