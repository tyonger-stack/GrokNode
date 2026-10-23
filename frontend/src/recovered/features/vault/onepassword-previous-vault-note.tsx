import type { ReactNode } from "react";

export interface OnePasswordPreviousVaultNoteCopy {
  readonly noticeSingular: string;
  readonly noticePlural: string;
  readonly moveAction: string;
  readonly dismissAction: string;
  readonly cancelAction: string;
}

export const ONEPASSWORD_NOTE_COPY_IDS: Record<keyof OnePasswordPreviousVaultNoteCopy, string> = {
  noticeSingular: "dz/K6y",
  noticePlural: "dz/K6y",
  moveAction: "sfQ/9c",
  dismissAction: "1QfxQT",
  cancelAction: "dEgA5A",
};

export const DEFAULT_ONEPASSWORD_NOTE_COPY: OnePasswordPreviousVaultNoteCopy = {
  noticeSingular:
    "{count} login in your \u201c{vaultName}\u201d vault isn't available to Grok Bot. Grok Bot can only use logins in your Personal or Private vault. In 1Password, select it and move it there.",
  noticePlural:
    "{count} logins in your \u201c{vaultName}\u201d vault aren't available to Grok Bot. Grok Bot can only use logins in your Personal or Private vault. In 1Password, select them and move them there.",
  moveAction: "Move to Private",
  dismissAction: "Dismiss",
  cancelAction: "Cancel",
};

export function renderPreviousVaultNotice(copy: OnePasswordPreviousVaultNoteCopy, count: number, vaultName: string): string {
  const template = count === 1 ? copy.noticeSingular : copy.noticePlural;
  return template.replace("{count}", String(count)).replace("{vaultName}", vaultName);
}

export function OnePasswordPreviousVaultNote(props: {
  readonly count: number;
  readonly vaultName: string;
  readonly copy?: Partial<OnePasswordPreviousVaultNoteCopy>;
  readonly onMove: () => void;
  readonly onDismiss: () => void;
}): ReactNode {
  const copy: OnePasswordPreviousVaultNoteCopy = { ...DEFAULT_ONEPASSWORD_NOTE_COPY, ...props.copy };
  return (
    <div className="sand-vault-onepassword-note" role="status">
      <p>{renderPreviousVaultNotice(copy, props.count, props.vaultName)}</p>
      <div className="sand-vault-onepassword-note-actions">
        <button onClick={props.onMove} type="button">{copy.moveAction}</button>
        <button onClick={props.onDismiss} type="button">{copy.dismissAction}</button>
      </div>
    </div>
  );
}
