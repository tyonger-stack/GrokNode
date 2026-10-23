export interface UpstreamCsvLogin {
  readonly id: string;
  readonly title: string;
  readonly username: string;
  readonly notes: string;
  readonly sites: string[];
  readonly password: string;
}

export interface UpstreamCsvCard {
  readonly title: string;
  readonly brand: string;
  readonly number: string;
  readonly expiry: string;
  readonly csc: string;
  readonly holderName: string;
}

export interface UpstreamDuplicateKeys {
  readonly loginKeys: Set<string>;
  readonly cardKeys: Set<string>;
}

export interface UpstreamExpiry {
  readonly month: number;
  readonly year: number;
}

export declare function parseCsv(args: {
  readonly text: string;
  readonly existing: readonly unknown[];
  readonly cardsEnabled: boolean;
  readonly now: Date;
}): unknown;

export declare function planLogin(
  row: number,
  login: UpstreamCsvLogin,
  context: { readonly cardsEnabled: boolean; readonly now: Date } & UpstreamDuplicateKeys,
): unknown;

export declare function planCard(
  row: number,
  card: UpstreamCsvCard,
  context: { readonly cardsEnabled: boolean; readonly now: Date } & UpstreamDuplicateKeys,
): unknown;

export declare function duplicateKeys(existing: readonly unknown[]): UpstreamDuplicateKeys;
export declare function parseExpiry(value: string): UpstreamExpiry | null;
export declare function formatExpiry(value: UpstreamExpiry): string;
export declare function validateCardNumber(value: string): boolean;
export declare function cardPhotoValues(value: unknown): Record<string, string>;
export declare function parseRecognizedCard(photos: readonly string[][][]): {
  readonly outcome: "read" | "not_found";
  readonly number: string;
  readonly expMonth: number;
  readonly expYear: number;
  readonly cardholderName: string;
  readonly securityCode?: string;
};
export declare function detectCardNumber(lines: readonly (readonly string[])[]): {
  readonly brand: string;
  readonly last4: string;
} | null;
export declare function detectCardBrand(number: string): string | null;
export declare function validateSecurityCode(args: {
  readonly securityCode: string;
  readonly number: string;
}): boolean;
