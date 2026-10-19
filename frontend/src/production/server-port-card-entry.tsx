import { useMemo } from "react";
import { createServerPortCardActions } from "./server-port-card-actions";
import { TranscriptCardLeafProvider } from "../recovered/features/conversation/cards/transcript-card/views/shared";
import { EmailDraftTranscriptCard } from "../recovered/features/conversation/cards/transcript-card/views/email-draft";
import { SlackDraftTranscriptCard } from "../recovered/features/conversation/cards/transcript-card/views/slack-draft";
import { UserFormTranscriptCard } from "../recovered/features/conversation/cards/transcript-card/views/user-form";
import { projectTranscriptCardEntry, type TranscriptCardScope } from "../recovered/features/conversation/cards/transcript-card/protocol";
import { REVIEW_CARD_SCOPE_CLASS } from "../recovered/features/conversation/cards/transcript-card/review-card-scope";

export type ReviewCardScope = Readonly<TranscriptCardScope>;
export type ReviewCardCall = (method: string, args?: unknown) => Promise<unknown>;
export interface ReviewCardProps {
  readonly entry: unknown;
  readonly scope: ReviewCardScope;
  readonly call: ReviewCardCall;
}

export function ReviewCard({ entry: value, scope, call }: ReviewCardProps) {
  const actions = useMemo(() => createServerPortCardActions({ call }), [call]);
  const entry = projectTranscriptCardEntry(value);
  const leaf = entry?.message.type === "email-draft" ? <EmailDraftTranscriptCard entry={entry} />
    : entry?.message.type === "slack-draft" ? <SlackDraftTranscriptCard entry={entry} />
    : entry?.message.type === "user-form" ? <UserFormTranscriptCard entry={entry} /> : null;
  const identity = JSON.stringify([scope.accountSlot, scope.agentId, entry?.id, entry?.message.type === "user-form" ? entry.message.form.id : null]);
  return <div className={REVIEW_CARD_SCOPE_CLASS}><TranscriptCardLeafProvider key={identity} value={{ scope, widgetInteractions: null, cloudAgents: null, serverPortActions: actions }}>{leaf}</TranscriptCardLeafProvider></div>;
}

