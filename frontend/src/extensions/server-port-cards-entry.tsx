import { createRoot } from "react-dom/client";
import { createServerPortCardActions } from "../production/server-port-card-actions";
import { REVIEW_CARD_SCOPE_CLASS } from "../recovered/features/conversation/cards/transcript-card/review-card-scope";
import type { ProductionCoordinatorClient } from "../production/coordinator-client";
import { TranscriptCardLeafProvider } from "../recovered/features/conversation/cards/transcript-card/views/shared";
import { EmailDraftTranscriptCard } from "../recovered/features/conversation/cards/transcript-card/views/email-draft";
import { SlackDraftTranscriptCard } from "../recovered/features/conversation/cards/transcript-card/views/slack-draft";
import { UserFormTranscriptCard } from "../recovered/features/conversation/cards/transcript-card/views/user-form";
import { projectTranscriptCardEntry } from "../recovered/features/conversation/cards/transcript-card/protocol";
import "../recovered/features/conversation/cards/transcript-card/view.css";
export { EmailDraftTranscriptCard, SlackDraftTranscriptCard, UserFormTranscriptCard, TranscriptCardLeafProvider, createServerPortCardActions };

/** Feed host userFormState/formResolution on expiry; generic isStale is not a form lifecycle. */
export function mountServerPortCard(element: HTMLElement, client: Pick<ProductionCoordinatorClient, "call">, scope: { readonly accountSlot: string | null; readonly agentId: string }, initialEntry: unknown) {
  const root = createRoot(element);
  const actions = createServerPortCardActions(client);
  function update(value: unknown, isStale = false) {
    const entry = projectTranscriptCardEntry(value);
    const leaf = entry?.message.type === "email-draft" ? <EmailDraftTranscriptCard key={entry.id} entry={entry} isStale={isStale} />
      : entry?.message.type === "slack-draft" ? <SlackDraftTranscriptCard key={entry.id} entry={entry} isStale={isStale} />
      : entry?.message.type === "user-form" ? <UserFormTranscriptCard key={entry.message.form.id} entry={entry} isStale={isStale} /> : null;
    root.render(<div className={REVIEW_CARD_SCOPE_CLASS}><TranscriptCardLeafProvider value={{scope, widgetInteractions: null, cloudAgents: null, serverPortActions: actions}}>{leaf}</TranscriptCardLeafProvider></div>);
  }
  update(initialEntry);
  return { update, unmount: () => root.unmount() };
}
