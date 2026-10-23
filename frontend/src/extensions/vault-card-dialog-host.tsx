import { useEffect, useState, type ReactNode } from "react";
import {
  VaultCardDialog,
  type CardPhotoFailure,
  type CardPhotoState,
} from "../recovered/features/vault/card-dialog";
import {
  EMPTY_CARD_DRAFT,
  cardDraftToVaultValues,
  formatCardExpiry,
  formatCardNumber,
  type VaultCardDraft,
} from "../recovered/features/vault/card-editor";
import type { VaultCardPhotoResult, VaultDesktop } from "../recovered/features/vault/types";

const VAULT_CARDS_GATE = "grok_bot_vault_cards";

type CardVault = Pick<VaultDesktop, "createGrokBotVaultCard" | "readGrokBotCardPhoto" | "cancelGrokBotCardPhotoRead">;

function gateEnabled(snapshot: unknown): boolean {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const gates = (snapshot as { featureGates?: unknown }).featureGates;
  if (typeof gates !== "object" || gates === null) return false;
  return (gates as Record<string, unknown>)[VAULT_CARDS_GATE] === true;
}

function cardDesktop(value: unknown): CardVault | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.createGrokBotVaultCard !== "function") return null;
  if (typeof record.readGrokBotCardPhoto !== "function") return null;
  if (typeof record.cancelGrokBotCardPhotoRead !== "function") return null;
  return value as CardVault;
}

function windowVault(): CardVault | null {
  if (typeof window === "undefined") return null;
  return cardDesktop((window as Window & { desktop?: { vault?: unknown } }).desktop?.vault);
}

function photoFailure(outcome: Exclude<VaultCardPhotoResult["outcome"], "read">): CardPhotoFailure {
  switch (outcome) {
    case "not_found":
    case "unavailable":
    case "rate_limited":
    case "refused":
    case "invalid_photo":
      return outcome;
    default: {
      const unexpected: never = outcome;
      return unexpected;
    }
  }
}

function expiryFromPhoto(month: number, year: number): string {
  const yy = String(year % 100).padStart(2, "0");
  return formatCardExpiry(`${String(month).padStart(2, "0")}${yy}`);
}

let photoReadSerial = 0;

export function VaultCardDialogHost(props: {
  readonly desktop?: CardVault | null;
  readonly enabled?: boolean;
}): ReactNode {
  const [enabled, setEnabled] = useState(props.enabled === true);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<VaultCardDraft>(EMPTY_CARD_DRAFT);
  const [photo, setPhoto] = useState<CardPhotoState>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readId, setReadId] = useState<string | null>(null);
  const desktop = props.desktop === undefined ? windowVault() : props.desktop;

  useEffect(() => {
    if (props.enabled !== undefined) {
      setEnabled(props.enabled);
      return;
    }
    let live = true;
    const experiments = (window as Window & { desktop?: { experiments?: { getSnapshot?: () => Promise<unknown> } } }).desktop?.experiments;
    void experiments?.getSnapshot?.().then((snapshot) => {
      if (live) setEnabled(gateEnabled(snapshot));
    }).catch(() => {
      if (live) setEnabled(false);
    });
    return () => { live = false; };
  }, [props.enabled]);

  if (!enabled) return null;
  const close = (): void => {
    if (readId != null) void desktop?.cancelGrokBotCardPhotoRead({ readId }).catch(() => undefined);
    setOpen(false);
    setDraft(EMPTY_CARD_DRAFT);
    setPhoto({ status: "idle" });
    setReadId(null);
    setError(null);
  };
  const save = (): void => {
    if (desktop == null) {
      setError("Vault is unavailable.");
      return;
    }
    setSaving(true);
    setError(null);
    void desktop.createGrokBotVaultCard({ values: cardDraftToVaultValues(draft) }).then(() => {
      close();
    }, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => setSaving(false));
  };
  const submitPhoto = (files: File[]): void => {
    if (desktop == null) {
      setPhoto({ status: "failed", failure: "unavailable" });
      return;
    }
    const nextReadId = `card-photo-${Date.now()}-${photoReadSerial += 1}`;
    setReadId(nextReadId);
    setPhoto({ status: "reading" });
    void Promise.all(files.map(async (file) => ({ image: new Uint8Array(await file.arrayBuffer()), mimeType: file.type }))).then((photos) => (
      desktop.readGrokBotCardPhoto({ readId: nextReadId, photos })
    )).then((result) => {
      if (result.outcome !== "read") {
        setPhoto({ status: "failed", failure: photoFailure(result.outcome) });
        return;
      }
      setDraft((current) => ({
        ...current,
        number: formatCardNumber(result.number),
        expiry: expiryFromPhoto(result.expMonth, result.expYear),
        holderName: result.cardholderName,
        ...(result.securityCode === undefined ? {} : { securityCode: result.securityCode }),
      }));
      setPhoto({ status: "read" });
    }, () => {
      setPhoto({ status: "failed", failure: "unknown" });
    });
  };
  return (
    <section className="sand-vault-card-entry" aria-label="New card">
      <button onClick={() => setOpen(true)} type="button">New card</button>
      {desktop == null ? <p role="status">Vault is unavailable.</p> : null}
      {error == null ? null : <p role="alert">{error}</p>}
      <VaultCardDialog
        draft={draft}
        mode={{ kind: "new" }}
        onCancelPhoto={() => {
          if (readId != null) void desktop?.cancelGrokBotCardPhotoRead({ readId }).catch(() => undefined);
          setPhoto({ status: "idle" });
        }}
        onChange={setDraft}
        onClose={close}
        onSave={save}
        onSubmitPhoto={submitPhoto}
        open={open}
        photo={photo}
        saving={saving}
      />
    </section>
  );
}
