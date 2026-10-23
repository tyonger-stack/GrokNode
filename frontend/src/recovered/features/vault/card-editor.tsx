import type { ReactNode } from "react";
import {
  detectCardBrand,
  parseExpiry,
  validateCardNumber,
  validateSecurityCode,
} from "../../../../../source/electron-main/vault/upstream-vault-parsers.generated.mjs";

export type VaultCardDraft = {
  readonly number: string;
  readonly expiry: string;
  readonly securityCode: string;
  readonly holderName: string;
  readonly billingAddress?: {
    readonly line1: string;
    readonly line2: string;
    readonly city: string;
    readonly region: string;
    readonly postalCode: string;
    readonly country: string;
  };
};

export const EMPTY_CARD_DRAFT: VaultCardDraft = {
  number: "",
  expiry: "",
  securityCode: "",
  holderName: "",
};

export type VaultCardFieldErrors = {
  readonly number?: string;
  readonly expiry?: string;
  readonly securityCode?: string;
  readonly holderName?: string;
};

export type VaultCardBrand = "visa" | "mastercard" | "amex" | "discover" | null;

export interface VaultCardEditorCopy {
  readonly numberLabel: string;
  readonly expiryLabel: string;
  readonly expiryHint: string;
  readonly securityCodeLabel: string;
  readonly securityCodeHint: string;
  readonly holderNameLabel: string;
  readonly invalidNumber: string;
  readonly invalidExpiry: string;
  readonly expiredCard: string;
  readonly invalidSecurityCode: string;
  readonly fieldTooLong: string;
}

export const UPSTREAM_VAULT_CARD_EDITOR_COPY_IDS: Record<keyof VaultCardEditorCopy, string> = {
  numberLabel: "xHIEQ5",
  expiryLabel: "hwlSE2",
  expiryHint: "Xcv4g4",
  securityCodeLabel: "wLmRnI",
  securityCodeHint: "gPftWF",
  holderNameLabel: "Mf9Gtf",
  invalidNumber: "w4wCgl",
  invalidExpiry: "yUqfOJ",
  expiredCard: "yMg5R0",
  invalidSecurityCode: "7xaBoY",
  fieldTooLong: "70Usji",
};

export const DEFAULT_VAULT_CARD_EDITOR_COPY: VaultCardEditorCopy = {
  numberLabel: "Card number",
  expiryLabel: "Expiry (MM/YY)",
  expiryHint: "MM / YY",
  securityCodeLabel: "Security code",
  securityCodeHint: "3 or 4 digits",
  holderNameLabel: "Name on card",
  invalidNumber: "Enter a valid card number",
  invalidExpiry: "Invalid expiry",
  expiredCard: "Card has expired",
  invalidSecurityCode: "Invalid security code",
  fieldTooLong: "A field is too long",
};

export function digitsOf(value: string): string {
  return value.replace(/[^0-9]/gu, "");
}

export function cardBrandOf(number: string): VaultCardBrand {
  const brand = detectCardBrand(digitsOf(number));
  if (brand === "visa" || brand === "mastercard" || brand === "amex" || brand === "discover") return brand;
  return null;
}

export function formatCardNumber(number: string): string {
  const digits = digitsOf(number);
  if (digits.length === 0) return "";
  const groups = cardBrandOf(digits) === "amex" ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const parts: string[] = [];
  let offset = 0;
  for (const size of groups) {
    if (offset >= digits.length) break;
    parts.push(digits.slice(offset, offset + size));
    offset += size;
  }
  if (offset < digits.length) parts.push(digits.slice(offset));
  return parts.join(" ");
}

export function formatCardExpiry(expiry: string): string {
  const digits = digitsOf(expiry);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}`;
}

export function validateVaultCardDraft(
  draft: VaultCardDraft,
  copy: VaultCardEditorCopy = DEFAULT_VAULT_CARD_EDITOR_COPY,
  now: Date = new Date(),
): VaultCardFieldErrors {
  const errors: { number?: string; expiry?: string; securityCode?: string; holderName?: string } = {};
  const number = digitsOf(draft.number);
  if (number.length === 0 || !validateCardNumber(number)) {
    errors.number = copy.invalidNumber;
  }
  const expiry = parseExpiry(draft.expiry.trim());
  if (expiry === null) {
    errors.expiry = copy.invalidExpiry;
  } else if (expiry.year * 12 + expiry.month - 1 < now.getFullYear() * 12 + now.getMonth()) {
    errors.expiry = copy.expiredCard;
  }
  const securityCode = draft.securityCode.trim();
  if (securityCode.length > 0 && !validateSecurityCode({ securityCode, number })) {
    errors.securityCode = copy.invalidSecurityCode;
  }
  if (draft.holderName.trim().length > 200) {
    errors.holderName = copy.fieldTooLong;
  }
  return errors;
}

export function isVaultCardDraftValid(
  draft: VaultCardDraft,
  copy: VaultCardEditorCopy = DEFAULT_VAULT_CARD_EDITOR_COPY,
  now: Date = new Date(),
): boolean {
  const errors = validateVaultCardDraft(draft, copy, now);
  return errors.number === undefined && errors.expiry === undefined && errors.securityCode === undefined;
}

export function cardDraftToVaultValues(draft: VaultCardDraft): Readonly<Record<string, string>> {
  const values: Record<string, string> = {
    cc_number: digitsOf(draft.number),
    cc_exp: draft.expiry.trim(),
    cc_csc: draft.securityCode.trim(),
    cc_name: draft.holderName.trim(),
  };
  const billing = draft.billingAddress;
  if (billing !== undefined) {
    values.billing_line1 = billing.line1.trim();
    values.billing_line2 = billing.line2.trim();
    values.billing_city = billing.city.trim();
    values.billing_region = billing.region.trim();
    values.billing_postal_code = billing.postalCode.trim();
    values.billing_country = billing.country.trim();
  }
  return values;
}

export function VaultCardEditor(props: {
  readonly draft: VaultCardDraft;
  readonly copy?: VaultCardEditorCopy;
  readonly disabled?: boolean;
  readonly showErrors?: boolean;
  readonly onChange: (draft: VaultCardDraft) => void;
}): ReactNode {
  const copy = props.copy ?? DEFAULT_VAULT_CARD_EDITOR_COPY;
  const errors = validateVaultCardDraft(props.draft, copy);
  const showErrors = props.showErrors === true;
  const set = (patch: Partial<VaultCardDraft>): void => {
    props.onChange({ ...props.draft, ...patch });
  };
  const field = (label: string, error: string | undefined, hasContent: boolean, input: ReactNode): ReactNode => (
    <label className="sand-vault-card-field">
      <span className="sand-vault-card-label">{label}</span>
      {input}
      {error === undefined || (!showErrors && !hasContent) ? null : (
        <span className="sand-vault-card-error" role="alert">{error}</span>
      )}
    </label>
  );
  const brand = cardBrandOf(props.draft.number);
  return (
    <div className="sand-vault-card-editor">
      {field(copy.numberLabel, errors.number, props.draft.number.trim().length > 0,
        <input
          aria-label={copy.numberLabel}
          autoComplete="cc-number"
          data-brand={brand ?? ""}
          disabled={props.disabled}
          inputMode="numeric"
          name="cardNumber"
          onChange={(event) => set({ number: formatCardNumber(event.target.value) })}
          value={props.draft.number}
        />)}
      {field(`${copy.expiryLabel} · ${copy.expiryHint}`, errors.expiry, props.draft.expiry.trim().length > 0,
        <input
          aria-label={copy.expiryLabel}
          autoComplete="cc-exp"
          disabled={props.disabled}
          inputMode="numeric"
          name="cardExpiry"
          onChange={(event) => set({ expiry: formatCardExpiry(event.target.value) })}
          placeholder={copy.expiryHint}
          value={props.draft.expiry}
        />)}
      {field(`${copy.securityCodeLabel} · ${copy.securityCodeHint}`, errors.securityCode, props.draft.securityCode.trim().length > 0,
        <input
          aria-label={copy.securityCodeLabel}
          autoComplete="cc-csc"
          disabled={props.disabled}
          inputMode="numeric"
          name="cardSecurityCode"
          onChange={(event) => set({ securityCode: digitsOf(event.target.value) })}
          value={props.draft.securityCode}
        />)}
      {field(copy.holderNameLabel, errors.holderName, props.draft.holderName.trim().length > 0,
        <input
          aria-label={copy.holderNameLabel}
          autoComplete="cc-name"
          disabled={props.disabled}
          name="cardHolderName"
          onChange={(event) => set({ holderName: event.target.value })}
          value={props.draft.holderName}
        />)}
    </div>
  );
}
