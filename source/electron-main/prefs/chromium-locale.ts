/**
 * Syncs the persisted language preference into Chromium UI locale.
 *
 * Renderer patches and the native application menu resolve per render,
 * but Chromium-internal UI (right-click context menus, default dialogs)
 * follows the app locale (OS language by default). No app.setLocale here,
 * so the --lang switch (appended before app ready) is the only channel.
 * A preference flip needs a relaunch before context menus follow.
 */

import { DEFAULT_LANGUAGE_PREFERENCE, isLanguagePreference, type LanguagePreference } from "../../shared/node/i18n/locale.js";

export const CHROMIUM_LANG_SWITCH = "lang";
export const CHROMIUM_ENGLISH_LOCALE = "en-US";
export const CHROMIUM_CHINESE_LOCALE = "zh-CN";

export function chromiumLocaleForPreference(preference: LanguagePreference): string | null {
  if (preference === "zh-CN") return CHROMIUM_CHINESE_LOCALE;
  if (preference === "en") return CHROMIUM_ENGLISH_LOCALE;
  return null;
}

export function readStoredLanguagePreference(
  readFile: (path: string) => string,
  settingsPath: string,
): LanguagePreference {
  try {
    const raw = JSON.parse(readFile(settingsPath)) as { readonly languagePreference?: unknown };
    const preference = raw?.languagePreference;
    if (isLanguagePreference(preference)) return preference;
  } catch {
  }
  return DEFAULT_LANGUAGE_PREFERENCE;
}

export function applyChromiumLocaleFromPreference(deps: {
  readonly appendSwitch: (name: string, value?: string) => void;
  readonly readFile: (path: string) => string;
  readonly settingsPath: string;
}): LanguagePreference {
  const preference = readStoredLanguagePreference(deps.readFile, deps.settingsPath);
  const locale = chromiumLocaleForPreference(preference);
  if (locale != null) deps.appendSwitch(CHROMIUM_LANG_SWITCH, locale);
  return preference;
}
