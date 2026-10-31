import {
  installApplicationMenu,
  type ApplicationMenuElectronPort,
  type ApplicationMenuHandle,
} from "./application-menu.js";
import { resolveLocale, type LanguagePreference, type SupportedLocale } from "../shared/node/i18n/locale.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getSandRootDir } from "../host/host-paths.js";
import { applyChromiumLocaleFromPreference } from "./prefs/chromium-locale.js";
import { reportDesktopEdgeFailure } from "./desktop-edge-failures.js";
import { desktopMessages } from "./i18n/desktop-messages.js";
import { installRendererCrashRecovery } from "./renderer-crash-recovery.js";
import { createDevToolsGate, createDevToolsMembershipResolver } from "./devtools-gate.js";
import { isGrokNodePackagedApp } from "../shared/node/grok-node-identity.js";
import { applyHardwareAccelerationPolicy } from "../shared/node/hardware-acceleration.js";
import { SandSettingsStore } from "../shared/node/settings/sand-settings-store.js";
import {
  createHostWindowChords,
  type HostInputEvent,
  type HostWindowInput,
} from "./host-window-chords.js";
import {
  attachWindowFocusForwarding,
  attachWindowStateBroadcast,
  createWindowFocusSync,
  createWindowsTitleBarOverlaySession,
  windowChromeOptions,
  type Rectangle,
  type WindowState,
  type WindowsTitleBarOverlay,
} from "./window-chrome.js";
import type { SandWindowPlacement, WindowStatePersistenceWindow } from "./window-state-persistence.js";
import { createElectronMainProductionComposition, type ElectronMainProductionBindings } from "./main-production-services.js";

export interface PreventableEvent {
  preventDefault(): void;
}

export interface MainWebContents {
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  isDevToolsOpened(): boolean;
  closeDevTools(): void;
  openDevTools(options: { readonly mode: "detach" }): void;
  toggleDevTools(): void;
  getZoomFactor(): number;
  setZoomFactor(factor: number): void;
  reload(): void;
  executeJavaScript(script: string, userGesture: boolean): Promise<unknown>;
  getURL(): string;
  setWindowOpenHandler(
    handler: (details: { readonly url: string }) => { readonly action: "deny" },
  ): void;
  on(
    event: "before-input-event",
    listener: (event: HostInputEvent, input: HostWindowInput) => void,
  ): void;
  on(event: "will-navigate", listener: (event: PreventableEvent, url: string) => void): void;
  on(
    event: "will-frame-navigate",
    listener: (details: PreventableEvent & { readonly isMainFrame: boolean; readonly url: string }) => void,
  ): void;
  on(event: "did-start-loading", listener: () => void): void;
  on(event: "unresponsive" | "responsive", listener: () => void): void;
  on(event: "render-process-gone", listener: (event: unknown, details: { readonly reason: string }) => void): void;
  isCrashed(): boolean;
}

export interface MainBrowserWindow extends WindowStatePersistenceWindow {
  readonly webContents: MainWebContents;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  isFocused(): boolean;
  setFullScreen(fullscreen: boolean): void;
  setTitle(title: string): void;
  setTitleBarOverlay?(overlay: WindowsTitleBarOverlay): void;
  loadURL(url: string): Promise<unknown>;
  loadFile(file: string): Promise<unknown>;
  on(event: "page-title-updated", listener: (event: PreventableEvent, title: string) => void): void;
  on(
    event:
      | "resize"
      | "move"
      | "maximize"
      | "unmaximize"
      | "close"
      | "enter-full-screen"
      | "leave-full-screen"
      | "focus"
      | "blur"
      | "session-end"
      | "closed",
    listener: () => void,
  ): void;
}

export interface ElectronMainApp {
  readonly isPackaged: boolean;
  disableHardwareAcceleration(): void;
  readonly commandLine: { readonly appendSwitch: (name: string, value?: string) => void };
  setName?(name: string): void;
  requestSingleInstanceLock(): boolean;
  quit(): void;
  isReady(): boolean;
  whenReady(): Promise<unknown>;
  /** macOS preferred languages. May be unavailable on some test ports. */
  getPreferredSystemLanguages?(): readonly string[];
  on(event: "second-instance", listener: (event: unknown, argv: readonly string[]) => void): void;
  on(event: "open-url", listener: (event: PreventableEvent, url: string) => void): void;
  on(event: "activate" | "window-all-closed", listener: () => void): void;
  on(event: "before-quit", listener: (event: PreventableEvent) => void): void;
  on(event: "will-quit", listener: () => void): void;
  on(
    event: "render-process-gone",
    listener: (event: unknown, contents: MainWebContents, details: { readonly reason: string; readonly exitCode?: number }) => void,
  ): void;
  on(
    event: "child-process-gone",
    listener: (event: unknown, details: { readonly type: string; readonly serviceName?: string; readonly reason: string; readonly exitCode?: number }) => void,
  ): void;
}

export interface MainEdge {
  emit(event: string, payload: unknown): void;
}

export interface ElectronMainServices {
  readonly mainEdge: MainEdge;
  readonly getDevToolsMembershipStatus: () => Promise<{
    readonly kind: string;
    readonly isAnysphereUser?: boolean;
  }>;
  readonly subscribeDevToolsMembership: (listener: () => void) => () => void;
  readonly getThemeBackgroundColor: () => string;
  readonly getLanguageController: () => {
    getState(): { readonly preference: LanguagePreference };
    subscribe(listener: (state: { readonly preference: LanguagePreference }) => void): () => void;
  };
  readonly openExternalUrl: (url: string) => Promise<unknown>;
  readonly configureVncTrust?: () => void;
  readonly hardenVncWebviewAttach?: (contents: MainWebContents) => void;
  readonly onWindowCreated?: (window: MainBrowserWindow) => void;
  /** Process-lifetime image context-menu listener installed after the application menu. */
  readonly registerImageContextMenu?: () => void;
  readonly dispose?: () => void | Promise<void>;
}

export interface ElectronMainServicesInitializationOptions {
  readonly routeHostInput: (input: HostWindowInput) => boolean;
}

export interface MainWindowStatePersistence {
  readonly resolveSandWindowPlacement: () => SandWindowPlacement;
  readonly applySandWindowPlacement: (
    window: WindowStatePersistenceWindow,
    placement: SandWindowPlacement,
  ) => void;
}

export interface ElectronMainDependencies {
  readonly app: ElectronMainApp;
  readonly menu: ApplicationMenuElectronPort;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly isLabBuild?: boolean;
  readonly isAttachProdBox?: boolean;
  readonly appVersion?: string;
  readonly appName: string;
  readonly devAppIcon?: string;
  readonly preloadPath: string;
  readonly rendererHtmlPath: string;
  readonly createBrowserWindow: (options: MainBrowserWindowOptions) => MainBrowserWindow;
  readonly getAllWindows: () => readonly MainBrowserWindow[];
  readonly windowStatePersistence: MainWindowStatePersistence;
  readonly deepLinks: {
    readonly extractCandidatesFromArgv: (argv: readonly string[]) => readonly string[];
    readonly handleCandidate: (candidate: string, source: "second-instance" | "open-url") => void;
    readonly handleArgv: (argv: readonly string[], source: "initial-argv") => void;
    readonly hasPendingActivation: () => boolean;
    readonly markNotReady: () => void;
  };
  readonly startup: {
    readonly bootstrapBeforeSingleInstance: () => void;
    readonly bootstrapAfterSingleInstance: (isPrimaryInstance: boolean) => void;
    readonly markPhase: (phase: "move_check" | "services" | "window") => void;
    readonly runMoveCheck: (input: { readonly hasPendingActivation: () => boolean }) => Promise<"continue-bootstrap" | "stop-bootstrap">;
    readonly armStuckWatchdog: () => void;
    readonly noteReady: () => void;
    readonly noteFailed: (error: unknown) => void;
    readonly cancel: () => void;
  };
  readonly initializeFoundation: () => void;
  readonly initializeServices: (options?: ElectronMainServicesInitializationOptions) => Promise<ElectronMainServices>;
  readonly syncWindowFocused: (state: { readonly isFocused: boolean }) => Promise<unknown>;
  readonly beginBeforeQuit?: () => "continue" | "prevent";
  readonly dialog?: {
    showMessageBox(window: MainBrowserWindow, options: Record<string, unknown>): Promise<{ readonly response: number }>;
  };
}

export interface MainBrowserWindowOptions {
  readonly x?: number;
  readonly y?: number;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly title: string;
  readonly icon?: string;
  readonly backgroundColor: string;
  readonly frame: boolean;
  readonly titleBarStyle: "hiddenInset" | "hidden" | "default";
  readonly trafficLightPosition?: { readonly x: number; readonly y: number };
  readonly titleBarOverlay?: WindowsTitleBarOverlay;
  readonly webPreferences: {
    readonly contextIsolation: true;
    readonly nodeIntegration: false;
    readonly preload: string;
    readonly sandbox: false;
    readonly webviewTag: true;
  };
}

export interface ElectronMainRuntime {
  readonly isPrimaryInstance: boolean;
  readonly isQuitting: () => boolean;
  readonly getMainWindow: () => MainBrowserWindow | undefined;
  readonly ensureMainWindow: () => void;
  readonly setTitleBarOverlayTone: (isOverlayTone: boolean) => void;
  readonly syncWindowsTitleBarOverlay: () => void;
}

export function configureDesktopEnvironment(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly isPackaged: boolean;
  readonly isAttachProdBox: boolean;
  readonly isLabBuild: boolean;
  readonly appVersion?: string;
}): void {
  if (input.isAttachProdBox) input.env.SAND_ATTACH_PROD_BOX = "1";
  else if (!input.isPackaged) input.env.SAND_ATTACH_PROD_BOX = "0";
  input.env.SAND_PACKAGED = input.isAttachProdBox || input.isPackaged ? "1" : "0";
  input.env.SAND_LAB = input.isLabBuild ? "1" : "0";
  if (input.appVersion != null) input.env.SAND_CLIENT_APP_VERSION = input.appVersion;
}

export function isSameDocumentNavigation(target: string, current: string): boolean {
  try {
    const next = new URL(target);
    const here = new URL(current);
    return next.origin === here.origin && next.pathname === here.pathname;
  } catch {
    return false;
  }
}

export function startElectronMain(deps: ElectronMainDependencies): ElectronMainRuntime {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  configureDesktopEnvironment({
    env,
    isPackaged: deps.app.isPackaged,
    isAttachProdBox: deps.isAttachProdBox ?? false,
    isLabBuild: deps.isLabBuild ?? false,
    ...(deps.appVersion == null ? {} : { appVersion: deps.appVersion }),
  });
  deps.startup.bootstrapBeforeSingleInstance();

  // Hardware acceleration: 0.71.2 AF() — only disable (+ disable-gpu) when the resolved
  // preference is false. Platform default is enabled on darwin/win32. Must run before ready.
  const settingsPath = join(getSandRootDir(), "settings.json");
  applyHardwareAccelerationPolicy({
    app: deps.app,
    storedPreference: new SandSettingsStore(settingsPath).getHardwareAccelerationEnabled(),
    platform,
  });
  deps.app.commandLine.appendSwitch("no-sandbox");
  try {
    applyChromiumLocaleFromPreference({
      appendSwitch: (name, value) => deps.app.commandLine.appendSwitch(name, value),
      readFile: (path) => readFileSync(path, "utf8"),
      settingsPath,
    });
  } catch {
    // Locale sync must never break startup; Chromium falls back to the OS language.
  }

  const isPrimaryInstance = !deps.app.isPackaged || deps.app.requestSingleInstanceLock();
  if (!isPrimaryInstance) deps.app.quit();
  deps.startup.bootstrapAfterSingleInstance(isPrimaryInstance);

  let mainWindow: MainBrowserWindow | undefined;
  let mainWindowCreation: Promise<void> | undefined;
  let isMainWindowCreationReady = false;
  let appIsQuitting = false;
  let services: ElectronMainServices | undefined;
  let overlaySession: ReturnType<typeof createWindowsTitleBarOverlaySession> | undefined;

  const syncWindowFocused = createWindowFocusSync({
    getMainWindow: () => mainWindow,
    setWindowFocused: deps.syncWindowFocused,
    reportFailure: (error) => reportDesktopEdgeFailure("window-focus", "push", error),
  });

  const devToolsGate = createDevToolsGate({ isDevBuild: !deps.app.isPackaged });
  const hostChords = createHostWindowChords({
    getMainWindow: () => mainWindow,
    emitZoomFactorChanged: (factor) => services?.mainEdge.emit("zoom-factor-changed", { factor }),
    quitApp: () => deps.app.quit(),
    canUseDevTools: () => devToolsGate.isAllowed(),
    shouldCloseOpenDevTools: () => devToolsGate.shouldCloseOpenDevTools(),
    platform,
  });
  devToolsGate.subscribe(() => hostChords.enforceDevToolsGate());

  const focusMainWindow = (): void => {
    const window = mainWindow;
    if (window != null && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return;
    }
    if (deps.app.isReady() && isMainWindowCreationReady) ensureMainWindow();
  };

  const createWindow = async (): Promise<void> => {
    if (services == null) throw new Error("Electron main services were not initialized");
    services.configureVncTrust?.();
    const placement = deps.windowStatePersistence.resolveSandWindowPlacement();
    const backgroundColor = services.getThemeBackgroundColor();
    const chrome = windowChromeOptions({
      isMac: platform === "darwin",
      isWindows: platform === "win32",
      backgroundColor,
    });
    const icon = deps.app.isPackaged ? undefined : deps.devAppIcon;
    const window = deps.createBrowserWindow({
      ...placement.windowOptions,
      title: deps.appName,
      ...(icon == null ? {} : { icon }),
      backgroundColor,
      ...chrome,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: deps.preloadPath,
        sandbox: false,
        webviewTag: true,
      },
    });
    // The shipped renderer is branded "Grok Bot" and sets document.title, which
    // would overwrite this window's title (shown in the Dock window list and
    // Mission Control) despite the fork's appName. Rewrite those titles to the
    // fork's name, preserving any dynamic suffix the renderer appends.
    window.on("page-title-updated", (event, title) => {
      if (title.includes("Grok Bot")) {
        event.preventDefault();
        window.setTitle(title.replaceAll("Grok Bot", "Grok Node"));
      }
    });
    services.hardenVncWebviewAttach?.(window.webContents);
    mainWindow = window;
    overlaySession = createWindowsTitleBarOverlaySession({
      isWindows: platform === "win32",
      getWindow: () => mainWindow,
      getThemeBackgroundColor: services.getThemeBackgroundColor,
    });
    attachWindowStateBroadcast(window, (state: WindowState) => {
      services?.mainEdge.emit("window-state", state);
    });
    deps.windowStatePersistence.applySandWindowPlacement(window, placement);
    attachWindowFocusForwarding(window, syncWindowFocused);
    services.onWindowCreated?.(window);
    hostChords.attachChordForwarding(window.webContents);
    window.webContents.setWindowOpenHandler(({ url }) => {
      void services?.openExternalUrl(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (isSameDocumentNavigation(url, window.webContents.getURL())) return;
      event.preventDefault();
      void services?.openExternalUrl(url);
    });
    window.webContents.on("will-frame-navigate", (details) => {
      if (details.isMainFrame) return;
      if (isSameDocumentNavigation(details.url, window.webContents.getURL())) return;
      details.preventDefault();
    });
    window.webContents.on("did-start-loading", () => deps.deepLinks.markNotReady());
    window.on("closed", () => deps.deepLinks.markNotReady());
    installRendererCrashRecovery(window.webContents, {
      isQuitting: () => appIsQuitting,
      reload: () => {
        loadMainDocument(window).catch((error: unknown) => reportDesktopEdgeFailure("renderer-recovery", "reload", error));
      },
      askToReloadOrQuit: () => askToReloadOrQuit(window),
      quit: () => deps.app.quit(),
      reportAskFailure: (error) => reportDesktopEdgeFailure("renderer-recovery", "crash-loop-dialog", error),
      reportCrashLoop: (record) =>
        reportDesktopEdgeFailure("renderer-recovery", "crash-loop", new Error(`renderer crash loop after ${record.reloads} reloads`)),
    });
    await loadMainDocument(window);
  };

  const loadMainDocument = (window: MainBrowserWindow): Promise<unknown> =>
    env.VITE_DEV_SERVER_URL != null ? window.loadURL(env.VITE_DEV_SERVER_URL) : window.loadFile(deps.rendererHtmlPath);

  const askToReloadOrQuit = async (window: MainBrowserWindow): Promise<"reload" | "quit"> => {
    if (deps.dialog == null) return "reload";
    const preference = services?.getLanguageController().getState().preference ?? "follow-system";
    const copy = desktopMessages(resolveLocale(preference, deps.app.getPreferredSystemLanguages?.() ?? [])).rendererRecovery;
    const withAppName = (text: string): string => text.replace("{0}", deps.appName);
    const { response } = await deps.dialog.showMessageBox(window, {
      type: "error",
      message: withAppName(copy.crashLoopMessage),
      buttons: [copy.reloadButton, withAppName(copy.quitButton)],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return response === 1 ? "quit" : "reload";
  };

  const ensureMainWindow = (): void => {
    if (mainWindow != null && !mainWindow.isDestroyed()) return;
    if (mainWindowCreation != null || !isMainWindowCreationReady) return;
    mainWindowCreation = createWindow().finally(() => {
      mainWindowCreation = undefined;
    });
  };

  deps.app.on("second-instance", (_event, argv) => {
    const candidates = deps.deepLinks.extractCandidatesFromArgv(argv);
    if (candidates.length === 0) {
      const window = mainWindow;
      if (window == null || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.focus();
      return;
    }
    for (const candidate of candidates) deps.deepLinks.handleCandidate(candidate, "second-instance");
  });
  deps.app.on("open-url", (event, url) => {
    event.preventDefault();
    if (!isPrimaryInstance) return;
    deps.deepLinks.handleCandidate(url, "open-url");
  });
  if (isPrimaryInstance) deps.deepLinks.handleArgv(process.argv, "initial-argv");
  deps.initializeFoundation();

  void deps.app
    .whenReady()
    .then(async () => {
      if (!isPrimaryInstance) {
        deps.startup.cancel();
        return;
      }
      // 0.78.1 spell-check preference applies at the session level (Chromium spellchecker).
      try {
        const electron = require("electron") as { session?: { defaultSession?: { setSpellCheckerEnabled?: (enabled: boolean) => void } } };
        electron.session?.defaultSession?.setSpellCheckerEnabled?.(new SandSettingsStore(settingsPath).getSpellCheckEnabled());
      } catch { /* session API unavailable in this environment */ }
      deps.startup.markPhase("move_check");
      const moveDisposition = await deps.startup.runMoveCheck({
        hasPendingActivation: deps.deepLinks.hasPendingActivation,
      });
      if (moveDisposition === "stop-bootstrap") return;
      deps.startup.armStuckWatchdog();
      deps.startup.markPhase("services");
      services = await deps.initializeServices({ routeHostInput: hostChords.routeHostInput });

      const membership = createDevToolsMembershipResolver({
        getStatus: services.getDevToolsMembershipStatus,
        setMembership: devToolsGate.setMembership,
        onError: (error) => reportDesktopEdgeFailure("local-account", "membership", error),
      });
      services.subscribeDevToolsMembership(() => void membership.refresh());
      void membership.refresh();

      const resolveMenuLocale = (): SupportedLocale => {
        const preference = services?.getLanguageController().getState().preference ?? "follow-system";
        const systemTags = deps.app.getPreferredSystemLanguages?.() ?? [];
        return resolveLocale(preference, systemTags);
      };
      // 0.71.2: checkbox state lives across View-menu rebuilds (locale / DevTools gate).
      let applicationMenu: ApplicationMenuHandle | undefined;
      const installMenu = (): void => {
        applicationMenu = installApplicationMenu(
          {
            applyWindowShortcut: hostChords.applyWindowShortcut,
            canUseDevTools: devToolsGate.isAllowed,
            emitOpenAbout: () => services?.mainEdge.emit("open-about", {}),
            emitOpenFeedback: () => services?.mainEdge.emit("open-feedback", {}),
            emitUnreadFilterMenuClicked: (isChecked) =>
              services?.mainEdge.emit("unread-filter-menu-clicked", { isChecked }),
            initialUnreadFilterChecked: applicationMenu?.isUnreadFilterChecked() === true,
            locale: resolveMenuLocale(),
            platform,
          },
          deps.menu,
        );
      };
      installMenu();
      services.registerImageContextMenu?.();
      devToolsGate.subscribe(installMenu);
      services?.getLanguageController().subscribe(installMenu);

      deps.startup.markPhase("window");
      isMainWindowCreationReady = true;
      await createWindow();
      deps.startup.noteReady();
      deps.app.on("activate", () => {
        if (deps.getAllWindows().length === 0) ensureMainWindow();
      });
    })
    .catch((error: unknown) => deps.startup.noteFailed(error));

  deps.app.on("window-all-closed", () => {
    if (platform !== "darwin") deps.app.quit();
  });
  deps.app.on("before-quit", (event) => {
    appIsQuitting = true;
    deps.startup.cancel();
    if (deps.beginBeforeQuit?.() === "prevent") {
      event.preventDefault();
      return;
    }
    void services?.dispose?.();
    mainWindow = undefined;
  });

  return {
    isPrimaryInstance,
    isQuitting: () => appIsQuitting,
    getMainWindow: () => mainWindow,
    ensureMainWindow,
    setTitleBarOverlayTone: (isOverlayTone) => overlaySession?.setOverlayTone(isOverlayTone),
    syncWindowsTitleBarOverlay: () => overlaySession?.syncFromTheme(),
  };
}

export function startElectronMainProduction(bindings: ElectronMainProductionBindings): ElectronMainRuntime {
  // The packaged Grok Node presents its own name in the app menu, About dialog
  // and window title (CFBundleName stays "Grok Bot" for helper ABI parity).
  // This must run before the production composition is created, because the
  // composition eagerly snapshots app.getName() for the menu and window title.
  if (isGrokNodePackagedApp()) bindings.native.app.setName?.("Grok Node");
  const composition = createElectronMainProductionComposition(bindings);
  const runtime = startElectronMain(composition.dependencies);
  composition.bindRuntime(runtime);
  return runtime;
}
