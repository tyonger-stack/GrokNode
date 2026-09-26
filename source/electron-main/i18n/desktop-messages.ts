import type {
  LanguagePreference,
  SupportedLocale,
} from "../../shared/node/i18n/locale.js";

// Minimal mirror of source/shared/node/i18n/locale.ts (kept import-free so
// tests can load this module through a data URL; frontend/src/i18n/locale.ts
// follows the same precedent). Parity is enforced by
// tests/i18n-desktop-messages.test.mjs.
const LOCALE_FALLBACK: SupportedLocale = "en";

function isSupportedLocaleMirror(value: unknown): value is SupportedLocale {
  return value === "en" || value === "zh-CN";
}

function isLanguagePreferenceMirror(value: unknown): value is LanguagePreference {
  return value === "follow-system" || isSupportedLocaleMirror(value);
}

function resolveSystemLocaleMirror(systemTags: readonly string[]): SupportedLocale {
  for (const raw of systemTags) {
    const tag = raw.trim().toLowerCase();
    if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return LOCALE_FALLBACK;
}

/**
 * User-visible main-process copy in English + Simplified Chinese.
 *
 * Every Chinese row is byte-sourced from the installed Grok Bot 0.58.0 macOS
 * app (bundle com.anysphere.sand), whose main bundle resolves the same
 * message IDs at runtime (dist/electron-main/main-core.cjs, dt._ catalogs).
 * Each row cites its 0.58 message ID so it can be re-checked against that
 * bundle. Nothing here is authored translation.
 *
 * Surfaces covered: the move-to-Applications startup dialog, the avatar
 * open dialog, the attachment download error, and the OS-notification
 * fallback bodies. The notification titles stay English: they interpolate
 * agent names and 0.58 ships no template for them.
 */
export interface DesktopLanguageSource {
  readonly getPreference?: () => LanguagePreference;
  readonly systemTags?: readonly string[];
}

export function resolveDesktopLocale(source?: DesktopLanguageSource): SupportedLocale {
  const raw = source?.getPreference?.();
  const preference: LanguagePreference = isLanguagePreferenceMirror(raw) ? raw : "follow-system";
  return preference === "follow-system"
    ? resolveSystemLocaleMirror(source?.systemTags ?? [])
    : preference;
}

interface MoveMessages {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly moveButton: string;
  readonly laterButton: string;
  readonly errorTitle: string;
  readonly errorMessage: string;
  readonly errorDetail: string;
  readonly okButton: string;
}

interface AvatarMessages {
  readonly openTitle: string;
  readonly filterName: string;
  readonly invalidImage: string;
  readonly describeFirst: string;
}

interface AttachmentsMessages {
  readonly errorTitle: string;
  readonly errorMessage: string;
}

interface NotificationMessages {
  readonly waitingInput: string;
  readonly seeWhatItDid: string;
}

interface ContextMenuMessages {
  readonly openLink: string;
  readonly copyLinkAddress: string;
  readonly copyImage: string;
  readonly saveImage: string;
  readonly copyImageAddress: string;
  readonly undo: string;
  readonly redo: string;
  readonly cut: string;
  readonly copy: string;
  readonly paste: string;
  readonly selectAll: string;
}

export interface DesktopMessages {
  readonly move: MoveMessages;
  readonly avatar: AvatarMessages;
  readonly attachments: AttachmentsMessages;
  readonly notification: NotificationMessages;
  readonly contextMenu: ContextMenuMessages;
}

const EN: DesktopMessages = {
  move: {
    title: "Move Grok Bot to Applications",
    message: "Move Grok Bot to the Applications folder?",
    detail: "Grok Bot cannot install updates from its current location. It will reopen after moving.",
    moveButton: "Move to Applications",
    laterButton: "Not Now",
    errorTitle: "Couldn't Move Grok Bot",
    errorMessage: "Grok Bot couldn't move to Applications",
    errorDetail: "Move Grok Bot to the Applications folder manually, then reopen Grok Bot",
    okButton: "OK",
  },
  avatar: {
    openTitle: "Choose an avatar image",
    filterName: "Images",
    invalidImage: "Selected file is not a valid image.",
    describeFirst: "Describe the avatar to generate first.",
  },
  attachments: {
    errorTitle: "Save File",
    errorMessage: "Couldn't save this file",
  },
  notification: {
    waitingInput: "Waiting for your input.",
    seeWhatItDid: "Open Grok Bot to see what it did.",
  },
  contextMenu: {
    openLink: "Open link",
    copyLinkAddress: "Copy link address",
    copyImage: "Copy image",
    saveImage: "Save image…",
    copyImageAddress: "Copy image address",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    selectAll: "Select All",
  },
};

const ZH_CN: DesktopMessages = {
  move: {
    title: "将 Grok Bot 移到“应用程序”文件夹",
    message: "要将 Grok Bot 移到“应用程序”文件夹吗？",
    detail: "Grok Bot 无法从当前位置安装更新。移动后会自动重新打开。",
    moveButton: "移到“应用程序”文件夹",
    laterButton: "暂不",
    errorTitle: "无法移动 Grok Bot",
    errorMessage: "Grok Bot 无法移到“应用程序”文件夹",
    errorDetail: "请手动将 Grok Bot 移到“应用程序”文件夹，然后重新打开 Grok Bot",
    okButton: "确定",
  },
  avatar: {
    openTitle: "选择头像图片",
    filterName: "图片",
    invalidImage: "所选文件不是有效的图片。",
    describeFirst: "请先描述要生成的头像。",
  },
  attachments: {
    errorTitle: "保存文件",
    errorMessage: "无法保存此文件",
  },
  notification: {
    waitingInput: "正在等待你的输入。",
    seeWhatItDid: "打开 Grok Bot 查看它做了什么。",
  },
  contextMenu: {
    openLink: "打开链接",
    copyLinkAddress: "复制链接地址",
    copyImage: "复制图片",
    saveImage: "保存图片…",
    copyImageAddress: "复制图片地址",
    undo: "撤销",
    redo: "重做",
    cut: "剪切",
    copy: "复制",
    paste: "粘贴",
    selectAll: "全选",
  },
};

// 0.58 main-catalog message IDs backing the ZH rows above, in field order:
// move: cl1wFU XIG+80 Ztywec WfbkKQ 3/XRac K4NRRh 2pfw/p hDgwB3 zga9sT
// avatar: Bvll0Q an5hVd cwHmX1 O9LjcE
// attachments: bBmHTz jpRhoK
// notification: PvEVPo IaFdOQ
// contextMenu: x57cJf wvbeyS GWCG6Y 9cMqgC XfEsUn 9uI/rE H3oH0g cCd8Bs he3ygx HzVv6g mCB6Je

const MESSAGES: Record<SupportedLocale, DesktopMessages> = {
  en: EN,
  "zh-CN": ZH_CN,
};

export function desktopMessages(locale: SupportedLocale): DesktopMessages {
  return MESSAGES[locale] ?? EN;
}

export const DESKTOP_MESSAGE_IDS: Record<string, string> = {
  "move.title": "cl1wFU",
  "move.message": "XIG+80",
  "move.detail": "Ztywec",
  "move.moveButton": "WfbkKQ",
  "move.laterButton": "3/XRac",
  "move.errorTitle": "K4NRRh",
  "move.errorMessage": "2pfw/p",
  "move.errorDetail": "hDgwB3",
  "move.okButton": "zga9sT",
  "avatar.openTitle": "Bvll0Q",
  "avatar.filterName": "an5hVd",
  "avatar.invalidImage": "cwHmX1",
  "avatar.describeFirst": "O9LjcE",
  "attachments.errorTitle": "bBmHTz",
  "attachments.errorMessage": "jpRhoK",
  "notification.waitingInput": "PvEVPo",
  "notification.seeWhatItDid": "IaFdOQ",
  "contextMenu.openLink": "x57cJf",
  "contextMenu.copyLinkAddress": "wvbeyS",
  "contextMenu.copyImage": "GWCG6Y",
  "contextMenu.saveImage": "9cMqgC",
  "contextMenu.copyImageAddress": "XfEsUn",
  "contextMenu.undo": "9uI/rE",
  "contextMenu.redo": "H3oH0g",
  "contextMenu.cut": "cCd8Bs",
  "contextMenu.copy": "he3ygx",
  "contextMenu.paste": "HzVv6g",
  "contextMenu.selectAll": "mCB6Je",
};
