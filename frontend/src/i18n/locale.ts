/**
 * Renderer-side mirror of `source/shared/node/i18n/locale.ts`.
 *
 * The frontend tsconfig deliberately does not include `../source/`, so we
 * re-declare the supported locale set here. Keep this in sync with the
 * canonical source — the smoke test `frontend/tests/i18n-mirrors-source.test.mjs`
 * enforces parity.
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