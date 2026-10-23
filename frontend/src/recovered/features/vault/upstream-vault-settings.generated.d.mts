import type { VaultDesktop } from "./types";

export declare function createUpstreamVaultStore(desktop: VaultDesktop): {
  readonly load: () => Promise<unknown>;
  readonly dispose: () => void;
};

export type UpstreamVaultStore = ReturnType<typeof createUpstreamVaultStore>;

declare function UpstreamVaultSettings(props: { readonly params: { readonly focusSetting?: string | null } }): React.ReactNode;
export { UpstreamVaultSettings as default };

export declare function createUpstreamVaultLinguiProvider(props: {
  readonly i18n: unknown;
  readonly defaultComponent?: unknown;
  readonly children?: React.ReactNode;
}): React.ReactNode;
