import { useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_VAULT_CARD_EDITOR_COPY,
  VaultCardEditor,
  isVaultCardDraftValid,
  type VaultCardDraft,
  type VaultCardEditorCopy,
} from "./card-editor";

export type CardPhotoStatus = "idle" | "reading" | "read" | "failed";

export type CardScanPrompt = "front" | "back" | "flip-for-name" | "flip-for-security-code";

export type CardPhotoFailure =
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "refused"
  | "invalid_photo"
  | "unknown";

export type CardPhotoState = {
  readonly status: CardPhotoStatus;
  readonly failure?: CardPhotoFailure;
  readonly notice?: string;
  readonly scanPrompt?: CardScanPrompt;
};

export type CardDialogResult = "saved" | "cancelled";

export interface VaultCardDialogCopy extends VaultCardEditorCopy {
  readonly newCardTitle: string;
  readonly editCardTitle: string;
  readonly linkTitle: string;
  readonly saveCard: string;
  readonly cancel: string;
  readonly entryPrompt: string;
  readonly dropPhoto: string;
  readonly choosePhotos: string;
  readonly addPhoto: string;
  readonly addAnotherPhoto: string;
  readonly readingCard: string;
  readonly scanFront: string;
  readonly scanBack: string;
  readonly scanFlipForName: string;
  readonly scanFlipForSecurityCode: string;
  readonly filledFromPhotos: string;
  readonly failedNotFound: string;
  readonly failedRateLimited: string;
  readonly failedUnavailable: string;
  readonly failedRefused: string;
  readonly failedInvalidPhoto: string;
  readonly failedUnknown: string;
  readonly tryAgain: string;
  readonly typeItIn: string;
  readonly privacyNote: string;
}

export const UPSTREAM_VAULT_CARD_DIALOG_COPY_IDS: Record<keyof VaultCardDialogCopy, string> = {
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
  newCardTitle: "pnrmSP",
  editCardTitle: "ja+MfM",
  linkTitle: "H2icqH",
  saveCard: "xGekty",
  cancel: "dEgA5A",
  entryPrompt: "y9b3+R",
  dropPhoto: "uyHRvk",
  choosePhotos: "v8D+Lv",
  addPhoto: "Lx8S4X",
  addAnotherPhoto: "Iyyvds",
  readingCard: "iWnbNJ",
  scanFront: "Ikf/KX",
  scanBack: "dgUkd2",
  scanFlipForName: "plTBeM",
  scanFlipForSecurityCode: "CceMjR",
  filledFromPhotos: "8Hi+X6",
  failedNotFound: "JVB7m7",
  failedRateLimited: "J0eoz+",
  failedUnavailable: "p+R6vr",
  failedRefused: "HRNsFh",
  failedInvalidPhoto: "zQUSik",
  failedUnknown: "zQUSik",
  tryAgain: "KDw4GX",
  typeItIn: "ciVOzZ",
  privacyNote: "2M55hZ",
};

export const DEFAULT_VAULT_CARD_DIALOG_COPY: VaultCardDialogCopy = {
  ...DEFAULT_VAULT_CARD_EDITOR_COPY,
  newCardTitle: "New card",
  editCardTitle: "Edit ",
  linkTitle: "Add a card in Link to pay ",
  saveCard: "Save card",
  cancel: "Cancel",
  entryPrompt: "Fill from photos of the card, such as its front and back. Choose them, or paste or drop them here.",
  dropPhoto: "Drop the photo to fill the card",
  choosePhotos: "Choose photos",
  addPhoto: "Add photo",
  addAnotherPhoto: "Add another photo, such as the back, to read the card again",
  readingCard: "Reading the card…",
  scanFront: "Hold the front of the card inside the frame",
  scanBack: "Hold the back of the card inside the frame",
  scanFlipForName: "Flip the card for the name",
  scanFlipForSecurityCode: "Flip the card for the security code",
  filledFromPhotos: "Filled from the photos. Check each detail before you save.",
  failedNotFound: "Couldn't read the card. Try more light.",
  failedRateLimited: "Too many tries. Wait a minute, then scan again.",
  failedUnavailable: "Scanning isn't available right now. Type it in.",
  failedRefused: "Card scanning isn't turned on for this account",
  failedInvalidPhoto: "Couldn't read the card. Try again.",
  failedUnknown: "Couldn't read the card. Try again.",
  tryAgain: "Try again",
  typeItIn: "or type it in",
  privacyNote: "Grok Bot never sees the number",
};

export const CARD_PHOTO_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export function photoFailureCopy(copy: VaultCardDialogCopy, failure: CardPhotoFailure | undefined): string {
  switch (failure) {
    case "not_found": return copy.failedNotFound;
    case "rate_limited": return copy.failedRateLimited;
    case "unavailable": return copy.failedUnavailable;
    case "refused": return copy.failedRefused;
    case "invalid_photo": return copy.failedInvalidPhoto;
    case "unknown":
    default: return copy.failedUnknown;
  }
}

export function scanPromptCopy(copy: VaultCardDialogCopy, prompt: CardScanPrompt | undefined): string | null {
  switch (prompt) {
    case "front": return copy.scanFront;
    case "back": return copy.scanBack;
    case "flip-for-name": return copy.scanFlipForName;
    case "flip-for-security-code": return copy.scanFlipForSecurityCode;
    default: return null;
  }
}

export function collectPhotoFiles(files: ArrayLike<File | null> | null | undefined): File[] {
  if (files == null) return [];
  const picked: File[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (file != null && CARD_PHOTO_ACCEPTED_MIME_TYPES.includes(file.type as (typeof CARD_PHOTO_ACCEPTED_MIME_TYPES)[number])) {
      picked.push(file);
    }
  }
  return picked;
}

export function VaultCardDialog(props: {
  readonly open: boolean;
  readonly mode: { readonly kind: "new" } | { readonly kind: "edit"; readonly name: string };
  readonly draft: VaultCardDraft;
  readonly photo: CardPhotoState;
  readonly copy?: Partial<VaultCardDialogCopy>;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly saving?: boolean;
  readonly onChange: (draft: VaultCardDraft) => void;
  readonly onSubmitPhoto: (files: File[]) => void;
  readonly onCancelPhoto: () => void;
  readonly onSave: (result: CardDialogResult) => void;
  readonly onClose: (result: CardDialogResult) => void;
}): ReactNode {
  const copy: VaultCardDialogCopy = { ...DEFAULT_VAULT_CARD_DIALOG_COPY, ...props.copy };
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  if (!props.open) return null;
  const title = props.title ?? (props.mode.kind === "new" ? copy.newCardTitle : `${copy.editCardTitle}${props.mode.name}`);
  const pickPhoto = (): void => {
    fileInput.current?.click();
  };
  const submitFiles = (files: ArrayLike<File | null> | null): void => {
    const picked = collectPhotoFiles(files);
    if (picked.length > 0) props.onSubmitPhoto(picked);
  };
  const busy = props.disabled === true || props.saving === true;
  const saveDisabled = busy || !isVaultCardDraftValid(props.draft, copy);
  const scanPrompt = scanPromptCopy(copy, props.photo.scanPrompt);
  return (
    <div className="sand-vault-card-dialog" role="dialog" aria-label={title}>
      <h2 className="sand-vault-card-dialog-title">{title}</h2>
      <div
        className="sand-vault-card-photo"
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          submitFiles(event.dataTransfer?.files ?? null);
        }}
        onPaste={(event) => {
          submitFiles(event.clipboardData?.files ?? null);
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept={CARD_PHOTO_ACCEPTED_MIME_TYPES.join(",")}
          multiple
          aria-label={copy.choosePhotos}
          disabled={props.photo.status === "reading"}
          onChange={(event) => {
            submitFiles(event.target.files);
            event.target.value = "";
          }}
          style={{ display: "none" }}
        />
        {props.photo.status === "idle" ? (
          <p className="sand-vault-card-photo-entry">{copy.entryPrompt}</p>
        ) : null}
        {props.photo.status === "reading" ? (
          <p className="sand-vault-card-photo-status" role="status">
            {scanPrompt ?? copy.readingCard}
          </p>
        ) : null}
        {props.photo.status === "read" ? (
          <p className="sand-vault-card-photo-status" role="status">
            {props.photo.notice ?? copy.filledFromPhotos}
          </p>
        ) : null}
        {props.photo.status === "failed" ? (
          <p className="sand-vault-card-photo-error" role="alert">
            {photoFailureCopy(copy, props.photo.failure)}
          </p>
        ) : null}
        {dragOver ? (
          <p className="sand-vault-card-photo-drop" aria-hidden="true">{copy.dropPhoto}</p>
        ) : null}
        <div className="sand-vault-card-photo-actions">
          {props.photo.status === "reading" ? (
            <button onClick={props.onCancelPhoto} type="button">{copy.cancel}</button>
          ) : (
            <button disabled={busy} onClick={pickPhoto} type="button">
              {props.photo.status === "read" ? copy.addAnotherPhoto : copy.addPhoto}
            </button>
          )}
          {props.photo.status === "failed" ? (
            <button onClick={pickPhoto} type="button">{copy.tryAgain}</button>
          ) : null}
          <span className="sand-vault-card-photo-hint">{copy.typeItIn}</span>
        </div>
      </div>
      <VaultCardEditor copy={copy} disabled={busy} draft={props.draft} onChange={props.onChange} />
      <p className="sand-vault-card-privacy">{copy.privacyNote}</p>
      <div className="sand-vault-card-dialog-actions">
        <button disabled={saveDisabled} onClick={() => props.onSave("saved")} type="button">{copy.saveCard}</button>
        <button onClick={() => props.onClose("cancelled")} type="button">{copy.cancel}</button>
      </div>
    </div>
  );
}
