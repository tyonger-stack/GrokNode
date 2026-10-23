export type VaultAddress = {
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly country: string;
};

export type VaultCard = {
  readonly brand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
  readonly holderName: string;
  readonly billingAddressId: string;
  readonly billingAddress: VaultAddress;
};

export type VaultContact = {
  readonly name: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly country: string;
  readonly phone: string;
  readonly email: string;
  readonly defaultShipping: boolean;
};

export type VaultCredential = {
  readonly id: string;
  readonly title: string;
  readonly username: string;
  readonly notes: string;
  readonly sites: readonly string[];
  readonly card?: VaultCard;
  readonly contact?: VaultContact;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type VaultLoginValues = {
  readonly title: string;
  readonly username: string;
  readonly notes: string;
  readonly sites: readonly string[];
  readonly password: string;
};

export type VaultCardPhotoResult =
  | { readonly outcome: "read"; readonly number: string; readonly expMonth: number; readonly expYear: number; readonly cardholderName: string; readonly securityCode?: string }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "unavailable" }
  | { readonly outcome: "rate_limited" }
  | { readonly outcome: "refused" }
  | { readonly outcome: "invalid_photo" };

export type VaultDesktop = {
  readonly listGrokBotVaultCredentials: () => Promise<VaultCredential[]>;
  readonly putGrokBotVaultCredential: (input: VaultLoginValues & { readonly id: string }) => Promise<VaultCredential>;
  readonly createGrokBotVaultLogins: (input: { readonly logins: readonly VaultLoginValues[] }) => Promise<readonly ({ readonly kind: "imported" } | { readonly kind: "refused"; readonly message: string })[]>;
  readonly updateGrokBotVaultCard: (input: {
    readonly id: string;
    readonly holderName: string;
    readonly expiry: string;
    readonly billingAddress: VaultAddress;
    readonly billingAddressId: string;
  }) => Promise<VaultCredential>;
  readonly putGrokBotVaultContact: (input: {
    readonly id: string;
    readonly title: string;
    readonly contact: VaultContact;
  }) => Promise<VaultCredential>;
  readonly createGrokBotVaultCard: (input: { readonly values: Readonly<Record<string, string>> }) => Promise<VaultCredential>;
  readonly deleteGrokBotVaultCredential: (input: { readonly id: string }) => Promise<void>;
  readonly readGrokBotCardPhoto: (input: {
    readonly readId: string;
    readonly photos: readonly { readonly image: Uint8Array; readonly mimeType: string }[];
  }, options?: { readonly signal?: AbortSignal }) => Promise<VaultCardPhotoResult>;
  readonly cancelGrokBotCardPhotoRead: (input: { readonly readId: string }) => Promise<void>;
};

export type UpstreamVaultStore = {
  readonly load: () => Promise<unknown>;
  readonly dispose: () => void;
};
