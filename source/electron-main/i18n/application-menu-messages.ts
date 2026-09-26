import type { SupportedLocale } from "../../shared/node/i18n/locale.js";

/**
 * Application-menu strings used by the main process when assembling the
 * Electron `Menu` template. Electron auto-localises the system roles
 * (`editMenu`, `windowMenu`, `help`, `services`, `hide`, …) on macOS, so the
 * labels we actually translate are the custom items the menu template adds.
 */
export interface ApplicationMenuMessages {
  readonly file: string;
  readonly reload: string;
  readonly toggleDeveloperTools: string;
  readonly toggleFullScreen: string;
  readonly helpCenter: string;
  readonly sendFeedback: string;
  readonly aboutAppPrefix: string; // e.g. "About " — final app name is appended.
  readonly appMenuHelp: string;
}

const EN: ApplicationMenuMessages = {
  file: "File",
  reload: "Reload",
  toggleDeveloperTools: "Toggle Developer Tools",
  toggleFullScreen: "Toggle Full Screen",
  helpCenter: "Help Center",
  sendFeedback: "Send Feedback",
  aboutAppPrefix: "About ",
  appMenuHelp: "Help",
};

// Chinese menu labels follow the layout of Grok Bot 0.58 (AppleScript-confirmed).
// The View, Edit, Window and Help menus all use macOS system roles so they
// are auto-localised by Cocoa from `AppleLanguages`; we only translate the
// custom labels that the menu template injects (File, View submenu items, App
// menu About entry, Help submenu).
const ZH_CN: ApplicationMenuMessages = {
  file: "文件",
  reload: "重新加载",
  toggleDeveloperTools: "切换开发者工具",
  toggleFullScreen: "切换全屏",
  helpCenter: "帮助中心",
  sendFeedback: "发送反馈",
  aboutAppPrefix: "关于 ",
  appMenuHelp: "帮助",
};

const MESSAGES: Record<SupportedLocale, ApplicationMenuMessages> = {
  en: EN,
  "zh-CN": ZH_CN,
};

export function applicationMenuMessages(locale: SupportedLocale): ApplicationMenuMessages {
  return MESSAGES[locale] ?? EN;
}