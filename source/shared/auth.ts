export interface AccountStatus {
  readonly kind: string;
  readonly authId?: string;
  readonly email?: string;
  readonly [key: string]: unknown;
}

export function accountSlot(status: AccountStatus): string | null {
  if (status.kind !== "logged-in") return null;
  const slot = status.authId ?? status.email;
  return slot == null || slot.length === 0 ? null : slot;
}
