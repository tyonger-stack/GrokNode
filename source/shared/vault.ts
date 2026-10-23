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

export type VaultLoginInput = VaultLoginValues & {
  readonly id: string;
};

export type VaultCardCreateInput = {
  readonly values: Readonly<Record<string, string>>;
};

export type VaultCardUpdateInput = {
  readonly id: string;
  readonly holderName: string;
  readonly expiry: string;
  readonly billingAddress: VaultAddress;
  readonly billingAddressId: string;
};

export type VaultContactInput = {
  readonly id: string;
  readonly title: string;
  readonly contact: Omit<VaultContact, keyof VaultAddress> & VaultAddress;
};

export type VaultBatchCreateResult =
  | { readonly kind: "imported" }
  | { readonly kind: "refused"; readonly message: string };

export type VaultCardPhoto =
  | { readonly image: Uint8Array; readonly mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" }
  | { readonly image: Uint8Array; readonly mimeType: string };

export type VaultCardPhotoRequest = {
  readonly photos: readonly VaultCardPhoto[];
};

export type VaultCardPhotoResult =
  | { readonly outcome: "read"; readonly number: string; readonly expMonth: number; readonly expYear: number; readonly cardholderName: string; readonly securityCode?: string }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "unavailable" }
  | { readonly outcome: "rate_limited" }
  | { readonly outcome: "refused" }
  | { readonly outcome: "invalid_photo" };

export type VaultTrustedCredential =
  | { readonly kind: "login"; readonly username: string; readonly password: string; readonly sites: readonly string[] }
  | { readonly kind: "card"; readonly number: string; readonly securityCode?: string };

export type VaultCredentialReference = string & { readonly __vaultCredentialReference: unique symbol };
