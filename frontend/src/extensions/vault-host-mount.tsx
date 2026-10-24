import { useEffect, useMemo, useState } from "react";
import {
  createUpstreamVaultStore,
  createUpstreamVaultLinguiProvider,
  createUpstreamVaultPaneHeaderProvider,
  default as UpstreamVaultSettings,
} from "../recovered/features/vault/upstream-vault-settings.generated.mjs";
import { upstreamVaultMessages, type VaultCatalogEntry } from "../recovered/features/vault/upstream-vault-messages.generated.mjs";
import { upstreamVaultMessages0755 } from "../recovered/features/vault/upstream-vault-messages-0755.mjs";
import type { VaultDesktop, VaultCredential } from "../recovered/features/vault/types";
import type { UpstreamVaultStore } from "../recovered/features/vault/upstream-vault-settings.generated.mjs";
import { createAppAlertController } from "../recovered/features/window-chrome/app-alert/controller";
import { AppAlertHost } from "../recovered/features/window-chrome/app-alert/view";

type WindowWithVault = Window & {
  readonly desktop?: {
    readonly vault?: VaultDesktop;
  };
  __sandVault0721Client?: {
    readonly grokBotVault: UpstreamVaultStore;
    readonly desktop: VaultDesktop;
    readonly experiments: { readonly snapshots: { get(): unknown; subscribe(listener: () => void): () => void } };
    readonly auth: { readonly snapshots: { get(): unknown; subscribe(listener: () => void): () => void } };
    readonly theme: { readonly snapshots: { get(): unknown; subscribe(listener: () => void): () => void } };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function functionOf(value: Record<string, unknown>, name: string): boolean {
  return typeof value[name] === "function";
}

export function validateVaultDesktop(value: unknown): VaultDesktop {
  if (!isRecord(value)) throw new Error("Vault bridge is unavailable");
  const required = [
    "listGrokBotVaultCredentials",
    "putGrokBotVaultCredential",
    "createGrokBotVaultLogins",
    "updateGrokBotVaultCard",
    "putGrokBotVaultContact",
    "createGrokBotVaultCard",
    "deleteGrokBotVaultCredential",
    "readGrokBotCardPhoto",
    "cancelGrokBotCardPhotoRead",
  ] as const;
  for (const name of required) {
    if (!functionOf(value, name)) throw new Error(`Vault bridge method is unavailable: ${name}`);
  }
  return value as VaultDesktop;
}

export function vaultDesktopFromWindow(candidate: Window | undefined = window): VaultDesktop {
  return validateVaultDesktop((candidate as WindowWithVault | undefined)?.desktop?.vault);
}

async function validateCredentialList(value: Awaited<ReturnType<VaultDesktop["listGrokBotVaultCredentials"]>>): Promise<VaultCredential[]> {
  if (!Array.isArray(value)) throw new Error("Vault list returned a non-array value");
  if (!value.every(isVaultCredential)) throw new Error("Vault list returned an invalid item");
  return value;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isVaultAddress(value: unknown): boolean {
  return isRecord(value) && ["line1", "line2", "city", "region", "postalCode", "country"].every((key) => isString(value[key]));
}

function isVaultCredential(value: unknown): value is VaultCredential {
  if (!isRecord(value)) return false;
  if (!["id", "title", "username", "notes"].every((key) => isString(value[key]))
    || !Array.isArray(value.sites) || !value.sites.every(isString)
    || typeof value.createdAtMs !== "number" || typeof value.updatedAtMs !== "number") return false;
  if (value.card !== undefined) {
    const card = value.card;
    if (!isRecord(card)
      || !["brand", "last4", "holderName", "nickname", "billingAddressId"].every((key) => isString(card[key]))
      || typeof card.expMonth !== "number" || typeof card.expYear !== "number"
      || !isVaultAddress(card.billingAddress)) return false;
  }
  if (value.contact !== undefined) {
    const contact = value.contact;
    if (!isRecord(contact)
      || !["name", "line1", "line2", "city", "region", "postalCode", "country", "phone", "email"].every((key) => isString(contact[key]))
      || typeof contact.defaultShipping !== "boolean") return false;
  }
  return true;
}

function constantStore<T>(value: T): { get(): T; subscribe(listener: () => void): () => void } {
  return { get: () => value, subscribe: () => () => undefined };
}

type VaultThemeSnapshot = { readonly resolved: "light" | "dark" };
type VaultThemeStore = {
  readonly snapshots: { get(): VaultThemeSnapshot; subscribe(listener: () => void): () => void };
  dispose(): void;
};

function createVaultThemeStore(): VaultThemeStore {
  const read = (): VaultThemeSnapshot => {
    const theme = document.querySelector(".sand-shell")?.getAttribute("data-theme") ?? "dark";
    return { resolved: theme.toLowerCase().includes("light") ? "light" : "dark" };
  };
  let snapshot = read();
  const listeners = new Set<() => void>();
  const shell = document.querySelector<HTMLElement>(".sand-shell");
  const observer = new MutationObserver(() => {
    const next = read();
    if (next.resolved === snapshot.resolved) return;
    snapshot = next;
    for (const listener of listeners) listener();
  });
  if (shell !== null) observer.observe(shell, { attributes: true, attributeFilter: ["data-theme", "class"] });
  return {
    snapshots: {
      get: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    dispose: () => observer.disconnect(),
  };
}

// Minimal stand-in for the upstream @lingui/core i18n object consumed by the
// original LinguiProvider (xb): it needs `locale`, `t.bind(i18n)` exposed as
// `_`, and `on("change")` returning an unsubscribe. Translations resolve to the
// upstream default English message with [name] interpolation.
function interpolateMessage(template: string, values?: Record<string, unknown>): string {
  return template.replace(/\[([A-Za-z0-9_]+)\]/gu, (match, key: string) => {
    const value = values?.[key];
    return value === undefined ? match : String(value);
  });
}

const vaultLocale = typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")
  ? "zh-CN" as const
  : "en" as const;

function renderCatalogEntry(entry: VaultCatalogEntry, values?: Record<string, unknown>): string | null {
  if (typeof entry === "string") return interpolateMessage(entry, values);
  if (!Array.isArray(entry)) return null;
  let text = "";
  for (const part of entry) {
    if (typeof part === "string") text += part;
    else if (Array.isArray(part) && typeof part[0] === "string") {
      const value = values?.[part[0]];
      text += value === undefined ? "" : String(value);
    } else return null;
  }
  return text;
}

type VaultMessageDescriptor = { readonly id?: string; readonly message?: string; readonly values?: Record<string, unknown> };

const vaultI18n = {
  locale: vaultLocale,
  t(
    idOrDescriptor: string | VaultMessageDescriptor,
    values?: Record<string, unknown>,
    options?: { message?: string },
  ): string {
    const descriptor: VaultMessageDescriptor = typeof idOrDescriptor === "string"
      ? { id: idOrDescriptor }
      : idOrDescriptor;
    const merged = values ?? descriptor.values;
    const id = descriptor.id ?? "";
    const catalogEntry = id.length > 0
      ? upstreamVaultMessages0755[vaultLocale][id]
        ?? upstreamVaultMessages[vaultLocale]?.[id]
        ?? upstreamVaultMessages0755.en[id]
        ?? upstreamVaultMessages.en[id]
      : undefined;
    if (catalogEntry !== undefined) {
      const rendered = renderCatalogEntry(catalogEntry, merged);
      if (rendered !== null) return rendered;
    }
    return interpolateMessage(descriptor.message ?? options?.message ?? id, merged);
  },
  _(idOrDescriptor: string | VaultMessageDescriptor, values?: Record<string, unknown>, options?: { message?: string }): string {
    return vaultI18n.t(idOrDescriptor, values, options);
  },
  on(): () => void {
    return () => undefined;
  },
};

const UpstreamVaultLinguiProvider = createUpstreamVaultLinguiProvider as unknown as
  (props: { readonly i18n: unknown; readonly children?: React.ReactNode }) => React.ReactNode;

const UpstreamVaultPaneHeaderProvider = createUpstreamVaultPaneHeaderProvider as unknown as
  (props: { readonly value: HTMLElement | null; readonly children?: React.ReactNode }) => React.ReactNode;

export function RVaultSettingsHost(props: { readonly focusSetting?: string | null }) {
  const desktop = useMemo(() => vaultDesktopFromWindow(), []);
  const [paneActions, setPaneActions] = useState<HTMLDivElement | null>(null);
  const themeStore = useMemo(() => createVaultThemeStore(), []);
  const alertController = useMemo(() => createAppAlertController(), []);
  const client = useMemo(() => {
    const list = async (): Promise<VaultCredential[]> => validateCredentialList(await desktop.listGrokBotVaultCredentials());
    const healingDesktop = { ...desktop, heal: () => undefined, listGrokBotVaultCredentials: list };
    const store = createUpstreamVaultStore(healingDesktop) as UpstreamVaultStore;
    const value = {
      grokBotVault: store,
      desktop: healingDesktop,
      experiments: {
        snapshots: constantStore({ featureGates: { grok_bot_vault: true, grok_bot_vault_cards: true } }),
        expose: () => undefined,
      },
      alert: alertController,
      auth: { snapshots: constantStore({ status: { kind: "logged-in" } }) },
      theme: themeStore,
    };
    (globalThis as typeof globalThis & { __sandVault0721Client?: typeof value }).__sandVault0721Client = value;
    (window as WindowWithVault).__sandVault0721Client = value;
    return value;
  }, [alertController, desktop]);

  useEffect(() => () => themeStore.dispose(), [themeStore]);
  useEffect(() => () => alertController.dispose(), [alertController]);

  useEffect(() => {
    void client.grokBotVault.load().catch(() => undefined);
    return () => client.grokBotVault.dispose();
  }, [client]);

  useEffect(() => {
    const header = document.querySelector<HTMLElement>("header.sand-settings-pane-header");
    if (header === null) return;
    const target = document.createElement("div");
    target.setAttribute("data-sand-vault-actions", "");
    target.style.marginInlineStart = "auto";
    target.style.marginInlineEnd = "20px";
    header.append(target);
    setPaneActions(target);
    return () => target.remove();
  }, []);

  return (
    <div id="sand-vault-0721-root" style={{ position: "relative" }}>
      <div ref={setPaneActions} style={{ position: "absolute", top: 28, right: 44, zIndex: 4 }} />
      <UpstreamVaultPaneHeaderProvider value={paneActions}>
        <UpstreamVaultLinguiProvider i18n={vaultI18n}>
          <UpstreamVaultSettings params={{ focusSetting: props.focusSetting ?? null }} />
        </UpstreamVaultLinguiProvider>
      </UpstreamVaultPaneHeaderProvider>
      <AppAlertHost controller={alertController} />
    </div>
  );
}
