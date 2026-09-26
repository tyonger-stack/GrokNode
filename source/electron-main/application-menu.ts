import type { SupportedLocale } from "../shared/node/i18n/locale.js";
import { applicationMenuMessages } from "./i18n/application-menu-messages.js";
import type { WindowShortcut } from "./window-shortcuts.js";

export type ApplicationMenuRole =
  | "close"
  | "editMenu"
  | "help"
  | "hide"
  | "hideOthers"
  | "quit"
  | "services"
  | "togglefullscreen"
  | "unhide"
  | "viewMenu"
  | "windowMenu";

export interface ApplicationMenuItem {
  readonly label?: string;
  readonly role?: ApplicationMenuRole;
  readonly type?: "separator";
  readonly accelerator?: string;
  readonly click?: () => void;
  readonly submenu?: readonly ApplicationMenuItem[];
}

export interface ApplicationMenuElectronPort {
  readonly appName: string;
  readonly buildFromTemplate: (template: readonly ApplicationMenuItem[]) => unknown;
  readonly setApplicationMenu: (menu: unknown) => void;
  readonly openExternal: (url: string) => Promise<unknown>;
}

export interface ApplicationMenuOptions {
  readonly applyWindowShortcut: (shortcut: WindowShortcut) => void;
  readonly canUseDevTools: () => boolean;
  readonly emitOpenAbout: () => void;
  readonly emitOpenFeedback: () => void;
  readonly platform?: NodeJS.Platform;
  /**
   * Resolved locale for the labels the template owns. macOS auto-localises
   * the built-in role strings (`editMenu`, `windowMenu`, `help`, `services`,
   * `hide`, …); we only translate the labels we add ourselves.
   */
  readonly locale?: SupportedLocale;
}

export function buildApplicationMenuTemplate(
  options: ApplicationMenuOptions,
  electron: Pick<ApplicationMenuElectronPort, "appName" | "openExternal">,
): ApplicationMenuItem[] {
  const isMac = (options.platform ?? process.platform) === "darwin";
  const labels = applicationMenuMessages(options.locale ?? "en");
  const template: ApplicationMenuItem[] = [];
  if (isMac) {
    template.push({
      label: electron.appName,
      submenu: [
        { label: `${labels.aboutAppPrefix}${electron.appName}`, click: () => options.emitOpenAbout() },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }
  template.push({
    label: labels.file,
    submenu: [isMac ? { role: "close" } : { role: "quit" }],
  });
  template.push({ role: "editMenu" });
  const viewSubmenu: ApplicationMenuItem[] = [
    {
      label: labels.reload,
      accelerator: "CmdOrCtrl+R",
      click: () => options.applyWindowShortcut("reload"),
    },
  ];
  if (options.canUseDevTools()) {
    viewSubmenu.push(
      { type: "separator" },
      {
        label: labels.toggleDeveloperTools,
        accelerator: isMac ? "Cmd+Alt+I" : "Ctrl+Shift+I",
        click: () => options.applyWindowShortcut("toggledevtools"),
      },
    );
  }
  viewSubmenu.push(
    { type: "separator" },
    isMac
      ? { role: "togglefullscreen" }
      : {
          label: labels.toggleFullScreen,
          accelerator: "F11",
          click: () => options.applyWindowShortcut("fullscreen"),
        },
  );
  // macOS heuristically injects the standard Edit submenu (Undo/Redo/Cut/Copy…)
  // into any top-level menu whose label is `View`/`显示`/`视图`. Use the
  // `viewMenu` role instead so Electron tags this entry as the system View
  // role and macOS does not double-fill it with Edit items — the actual
  // Edit role still renders as its own top-level menu immediately above.
  template.push({ role: "viewMenu" as ApplicationMenuRole, submenu: viewSubmenu });
  template.push({ role: "windowMenu" });
  template.push({
    role: "help",
    submenu: [
      {
        label: labels.helpCenter,
        click: () => {
          void electron.openExternal("https://cursor.com/help");
        },
      },
      { type: "separator" },
      { label: labels.sendFeedback, click: () => options.emitOpenFeedback() },
    ],
  });
  return template;
}

export function installApplicationMenu(
  options: ApplicationMenuOptions,
  electron: ApplicationMenuElectronPort,
): void {
  const template = buildApplicationMenuTemplate(options, electron);
  electron.setApplicationMenu(electron.buildFromTemplate(template));
}