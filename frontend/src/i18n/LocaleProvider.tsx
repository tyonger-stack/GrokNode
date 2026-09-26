import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { IntlProvider } from "react-intl";
import type { DesktopBridge, LanguagePreference, LanguageState } from "../recovered/contracts/desktop-bridge";
import { enMessages } from "./messages/en";
import { zhCNMessages } from "./messages/zh-CN";
import { resolveLocale, type SupportedLocale } from "./locale";

type Messages = Record<string, string>;

const MESSAGES: Record<SupportedLocale, Messages> = {
  en: enMessages,
  "zh-CN": zhCNMessages,
};

/**
 * Translate a system-preferred languages list (`navigator.languages` or the
 * `macos-open` preferred-languages fallback exposed by Electron) into a
 * supported locale. Mirrors `resolveSystemLocale` in the shared layer so the
 * renderer's bootstrap agrees with the settings store's default resolution.
 */
export function resolveFromSystemTags(systemTags: readonly string[] | undefined | null): SupportedLocale {
  return resolveLocale("follow-system", systemTags ?? []);
}

interface LocaleState {
  readonly preference: LanguagePreference;
  readonly resolved: SupportedLocale;
  setPreference(preference: LanguagePreference): Promise<void>;
  /**
   * Subscribe to subsequent bridge-driven state changes. The bridge already
   * owns persistence + emission, so this layer just fans the event out to
   * React subscribers.
   */
  subscribe(listener: (next: LanguageState) => void): () => void;
}

/**
 * Bridges the persisted language preference to react-intl. The resolved
 * locale is recomputed every time the preference changes; when the preference
 * is `follow-system`, a small heuristic on `navigator.languages` picks the
 * initial locale and the user can switch explicitly afterwards.
 */
export function createLocaleState(bridge: DesktopBridge): LocaleState {
  const initial = bridge.language.initial;
  const initialSystem = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  let preference: LanguagePreference = initial.preference;
  let resolved: SupportedLocale = resolveLocale(preference, initialSystem);
  const onChangeListeners: ((next: LanguageState) => void)[] = [];
  bridge.language.onChanged((next) => {
    preference = next.preference;
    const sys = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
    resolved = resolveLocale(preference, sys);
    for (const listener of onChangeListeners) listener(next);
  });
  return {
    get preference() { return preference; },
    get resolved() { return resolved; },
    async setPreference(next: LanguagePreference) {
      const state = await bridge.language.set(next);
      preference = state.preference;
      const sys = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
      resolved = resolveLocale(preference, sys);
      for (const listener of onChangeListeners) listener(state);
    },
    subscribe(listener: (next: LanguageState) => void): () => void {
      onChangeListeners.push(listener);
      return () => {
        const idx = onChangeListeners.indexOf(listener);
        if (idx >= 0) onChangeListeners.splice(idx, 1);
      };
    },
  };
}

const LocaleContext = createContext<LocaleState | null>(null);

export function useLocale(): LocaleState {
  const ctx = useContext(LocaleContext);
  if (ctx == null) throw new Error("useLocale must be used inside <LocaleProvider>.");
  return ctx;
}

/**
 * Wires the locale store into a single `LocaleProvider` so React components
 * can call `useLocale()` and `useIntl()`. The provider also emits a stable
 * reference to the current messages map so consumers can memoise.
 */
export function LocaleProvider({ bridge, children }: { readonly bridge: DesktopBridge; readonly children: ReactNode }) {
  const store = useMemo(() => createLocaleState(bridge), [bridge]);
  const [, setVersion] = useState(0);
  useEffect(() => store.subscribe(() => setVersion((value) => value + 1)), [store]);
  const messages = MESSAGES[store.resolved] ?? enMessages;
  return (
    <LocaleContext.Provider value={store}>
      <IntlProvider locale={store.resolved} messages={messages} defaultLocale="en">
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}