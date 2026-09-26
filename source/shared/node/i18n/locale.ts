/**
 * Grok Node language identity.
 *
 * Three values are persisted in SandSettingsStore. `follow-system` resolves
 * against the macOS preferred languages at boot and on every render; the
 * two explicit locales are stable across reboots. `isSupportedLocale` is the
 * single source of truth for what locales ship translations for.
 *
 * The renderer and the Electron main process share these values so the app
 * menu, the IPC bridge and the renderer-side IntlProvider all agree.
 */
export type SupportedLocale = "en" | "zh-CN";
export type LanguagePreference = "follow-system" | SupportedLocale;

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["en", "zh-CN"] as const;
export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = "follow-system";
export const FALLBACK_LOCALE: SupportedLocale = "en";

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "follow-system" || isSupportedLocale(value);
}

/** Map a BCP-47 tag (`en`, `en-US`, `zh-Hans`, `zh-CN`, ...) to a supported locale. */
export function resolveSystemLocale(systemTags: readonly string[]): SupportedLocale {
  for (const raw of systemTags) {
    const tag = raw.trim().toLowerCase();
    if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return FALLBACK_LOCALE;
}

export function resolveLocale(preference: LanguagePreference, systemTags: readonly string[]): SupportedLocale {
  return preference === "follow-system" ? resolveSystemLocale(systemTags) : preference;
}
