import { useRef, useState } from "react";
import type { DraftCardMessage, DraftSendState } from "../../../../../../../../source/shared/external-drafts";
import { useTranscriptCardLeafProviders } from "./shared";

export function useDraftActions(entryId: string | undefined, persisted: DraftSendState | undefined, stale: boolean | undefined) {
  const providers = useTranscriptCardLeafProviders();
  const [local, setLocal] = useState<DraftSendState>();
  const pending = useRef(false);
  const [rejected, setRejected] = useState(false);
  const state = selectDraftSendState(persisted, local, pending.current);
  const agentId = providers?.scope.agentId;
  const actions = providers?.serverPortActions;
  const enabled = !stale && state === "editable" && agentId != null && actions != null;
  async function run(draft?: DraftCardMessage) {
    if (!enabled || pending.current || entryId == null || agentId == null || actions == null) return;
    pending.current = true;
    setLocal("sending");
    setRejected(false);
    try {
      const result = draft == null ? await actions.discardDraft({agentId, entryId}) : await actions.sendDraft({agentId, entryId, draft});
      setLocal(result);
      setRejected(result === "editable");
    } catch {
      // Transport loss may follow a real send: never unlock a blind resend or echo provider errors.
      setLocal("unconfirmed");
    } finally { pending.current = false; }
  }
  return { state, enabled, run, rejected };
}

function selectDraftSendState(persisted: DraftSendState | undefined, local: DraftSendState | undefined, inFlight: boolean): DraftSendState {
  if (persisted === "sent" || persisted === "discarded" || persisted === "unconfirmed" || persisted === "draft-created") return persisted;
  if (inFlight) return "sending";
  if (local != null && local !== "sending") return local;
  if (persisted === "editable") return "editable";
  return local ?? persisted ?? "editable";
}

export const draftStatusLabels: Readonly<Record<DraftSendState, string>> = {
  editable: "Ready to send", sending: "Sending…", sent: "Sent", discarded: "Discarded",
  unconfirmed: "Send outcome unconfirmed", "draft-created": "Draft created",
};
