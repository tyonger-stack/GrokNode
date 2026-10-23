import { useEffect, useMemo } from "react";
import {
  createUpstreamVaultStore,
  createUpstreamVaultLinguiProvider,
  default as UpstreamVaultSettings,
} from "../recovered/features/vault/upstream-vault-settings.generated.mjs";
import { upstreamVaultMessages, type VaultCatalogEntry } from "../recovered/features/vault/upstream-vault-messages.generated.mjs";
import type { VaultDesktop, VaultCredential } from "../recovered/features/vault/types";
import type { UpstreamVaultStore } from "../recovered/features/vault/upstream-vault-settings.generated.mjs";

type WindowWithVault = Window & {
  readonly desktop?: {
    readonly vault?: VaultDesktop;
  };
  __sandVault0721Client?: {
    readonly grokBotVault: UpstreamVaultStore;
    readonly desktop: VaultDesktop;
    readonly experiments: { readonly snapshots: { get(): unknown; subscribe(listener: () => void): () => void } };
    readonly auth: { readonly snapshots: { get(): unknown; subscribe(listener: () => void): () => void } };
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
  return value;
}

function constantStore<T>(value: T): { get(): T; subscribe(listener: () => void): () => void } {
  return { get: () => value, subscribe: () => () => undefined };
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
    const catalogEntry = id.length > 0 ? upstreamVaultMessages[vaultLocale][id] : undefined;
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

export function RVaultSettingsHost(props: { readonly focusSetting?: string | null }) {
  const desktop = useMemo(() => vaultDesktopFromWindow(), []);
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
      alert: { alert: () => undefined },
      auth: { snapshots: constantStore({ status: { kind: "logged-in" } }) },
    };
    (globalThis as typeof globalThis & { __sandVault0721Client?: typeof value }).__sandVault0721Client = value;
    (window as WindowWithVault).__sandVault0721Client = value;
    return value;
  }, [desktop]);

  useEffect(() => {
    void client.grokBotVault.load().catch(() => undefined);
    return () => client.grokBotVault.dispose();
  }, [client]);

  return (
    <div id="sand-vault-0721-root">
      <UpstreamVaultLinguiProvider i18n={vaultI18n}>
        <UpstreamVaultSettings params={{ focusSetting: props.focusSetting ?? null }} />
      </UpstreamVaultLinguiProvider>
    </div>
  );
}
