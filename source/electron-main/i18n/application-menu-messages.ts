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
  readonly viewMenu: string;
  readonly closeWindow: string;
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
  viewMenu: "View",
  closeWindow: "Close Window",
};

// Chinese menu labels follow Grok Bot 0.61.0's live macOS menu bar
// (CUA-verified 2026-09-28): 文件 / Edit / 显示 / Window / 帮助, with the
// File menu's close item reading 关闭窗口. The pinned 0.18 Electron shell's
// built-in role localisation is incomplete (it leaves View/Help/Close Window
// in English), so the template pins explicit labels for exactly the entries
// 0.61 localises; Edit and Window stay English to match 0.61 byte for byte.
const ZH_CN: ApplicationMenuMessages = {
  file: "文件",
  reload: "重新加载",
  toggleDeveloperTools: "切换开发者工具",
  toggleFullScreen: "切换全屏",
  helpCenter: "帮助中心",
  sendFeedback: "发送反馈",
  aboutAppPrefix: "关于 ",
  appMenuHelp: "帮助",
  viewMenu: "显示",
  closeWindow: "关闭窗口",
};

const MESSAGES: Record<SupportedLocale, ApplicationMenuMessages> = {
  en: EN,
  "zh-CN": ZH_CN,
};

export function applicationMenuMessages(locale: SupportedLocale): ApplicationMenuMessages {
  return MESSAGES[locale] ?? EN;
}