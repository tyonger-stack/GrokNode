import type { ReactNode } from "react";
import type { TranscriptCardProtocolKey } from "./protocol";
import "./server-port-utilities.css";

export const REVIEW_CARD_SCOPE_CLASS = "sand-server-port-review";

export const REVIEW_CARD_PROTOCOL_KEYS: ReadonlySet<TranscriptCardProtocolKey> = new Set<TranscriptCardProtocolKey>([
  "send-message:email-draft",
  "send-message:slack-draft",
  "send-message:user-form",
]);

export function ReviewCardScope({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className={REVIEW_CARD_SCOPE_CLASS}>{children}</div>;
}
