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
  readonly nickname: string;
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
  readonly nickname?: string;
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

/**
 * The subset of Vault data made available to the in-box agent. Cards are
 * deliberately absent: the model can use saved logins and contacts, while
 * card numbers and security codes remain main-process only.
 */
export type VaultSessionLogin = {
  readonly id: string;
  readonly title: string;
  readonly username: string;
  readonly notes: string;
  readonly sites: readonly string[];
  readonly password: string;
  readonly updatedAtMs: number;
};

export type VaultSessionContact = {
  readonly id: string;
  readonly title: string;
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
  readonly updatedAtMs: number;
};

export type VaultSessionSnapshot = {
  readonly version: 1;
  readonly updatedAtMs: number;
  readonly logins: readonly VaultSessionLogin[];
  readonly contacts: readonly VaultSessionContact[];
};

const VAULT_SESSION_MAX_ITEMS = 1000;

function vaultSessionRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function vaultSessionString(value: unknown, maxLength = 4096): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

export function parseVaultSessionSnapshot(value: unknown): VaultSessionSnapshot | null {
  const raw = vaultSessionRecord(value);
  if (raw === null || raw.version !== 1 || !Array.isArray(raw.logins) || !Array.isArray(raw.contacts)) return null;
  if (raw.logins.length > VAULT_SESSION_MAX_ITEMS || raw.contacts.length > VAULT_SESSION_MAX_ITEMS) return null;
  const updatedAtMs = raw.updatedAtMs;
  if (typeof updatedAtMs !== "number" || !Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) return null;
  const logins: VaultSessionLogin[] = [];
  for (const value of raw.logins) {
    const item = vaultSessionRecord(value);
    if (item === null) return null;
    const id = vaultSessionString(item.id, 256);
    const title = vaultSessionString(item.title, 200);
    const username = vaultSessionString(item.username, 512);
    const notes = vaultSessionString(item.notes, 2048);
    const password = vaultSessionString(item.password, 4096);
    const updated = item.updatedAtMs;
    if (id === null || title === null || username === null || notes === null || password === null
      || typeof updated !== "number" || !Number.isSafeInteger(updated) || updated < 0
      || !Array.isArray(item.sites) || item.sites.length > 10) return null;
    const sites = item.sites.map((site) => vaultSessionString(site, 2048));
    if (sites.some((site) => site === null)) return null;
    logins.push({ id, title, username, notes, sites: sites as string[], password, updatedAtMs: updated });
  }
  const contacts: VaultSessionContact[] = [];
  for (const value of raw.contacts) {
    const item = vaultSessionRecord(value);
    if (item === null) return null;
    const text = (key: string, maxLength = 256): string | null => vaultSessionString(item[key], maxLength);
    const id = text("id", 256); const title = text("title", 200); const name = text("name", 200);
    const line1 = text("line1"); const line2 = text("line2"); const city = text("city");
    const region = text("region"); const postalCode = text("postalCode"); const country = text("country");
    const phone = text("phone", 64); const email = text("email", 320);
    const updated = item.updatedAtMs;
    if (id === null || title === null || name === null || line1 === null || line2 === null
      || city === null || region === null || postalCode === null || country === null
      || phone === null || email === null || typeof item.defaultShipping !== "boolean"
      || typeof updated !== "number" || !Number.isSafeInteger(updated) || updated < 0) return null;
    contacts.push({ id, title, name, line1, line2, city, region, postalCode, country,
      phone, email, defaultShipping: item.defaultShipping, updatedAtMs: updated });
  }
  return { version: 1, updatedAtMs, logins, contacts };
}
