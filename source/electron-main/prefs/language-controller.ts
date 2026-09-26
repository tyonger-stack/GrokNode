import { isLanguagePreference, type LanguagePreference } from "../../shared/node/i18n/locale.js";

export interface SandLanguageSettingsStore {
  getLanguagePreference(): LanguagePreference;
  setLanguagePreference(value: LanguagePreference): void;
}

export interface SandLanguageState {
  readonly preference: LanguagePreference;
}

/**
 * Bridges the persisted language preference to renderer + main-process
 * subscribers. Unlike theme, language has no native OS sink we need to sync
 * to (Electron 42 has no `app.setLocale`), so the controller is a thin
 * wrapper around the settings store with broadcast plumbing.
 */
export class SandLanguageController {
  readonly #settingsStore: SandLanguageSettingsStore;
  readonly #broadcastState: (state: SandLanguageState) => void;
  readonly #localListeners: Set<(state: SandLanguageState) => void> = new Set();
  #disposed = false;

  constructor(settingsStore: SandLanguageSettingsStore, broadcastState: (state: SandLanguageState) => void) {
    this.#settingsStore = settingsStore;
    this.#broadcastState = broadcastState;
  }

  getState(): SandLanguageState {
    return { preference: this.#settingsStore.getLanguagePreference() };
  }

  setPreference(value: LanguagePreference): SandLanguageState {
    if (!isLanguagePreference(value)) return this.getState();
    this.#settingsStore.setLanguagePreference(value);
    const state = this.getState();
    this.#broadcastState(state);
    for (const listener of this.#localListeners) listener(state);
    return state;
  }

  /**
   * Main-process subscription hook used by OS-level sinks (e.g. the
   * Electron application menu) that need to rebuild themselves when the
   * preference flips. Returns an unsubscribe function. Mirrors the bridge
   * contract exposed to the renderer.
   */
  subscribe(listener: (state: SandLanguageState) => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#localListeners.add(listener);
    return () => {
      this.#localListeners.delete(listener);
    };
  }

  dispose(): void {
    this.#disposed = true;
    this.#localListeners.clear();
  }

  /** Read-only view; throws if disposed to catch handler-after-teardown bugs. */
  requireLive(): void {
    if (this.#disposed) throw new Error("The language controller has been disposed.");
  }
}
