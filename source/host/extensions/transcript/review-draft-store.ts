import { z } from "zod";
import { draftCardMessageSchema, draftRouteSchema, draftRouteVerificationSchema, draftSendStateSchema,
  type DraftEntry, type DraftKey, type DraftEmission } from "../../../shared/external-drafts.js";
import type { DraftStore } from "./draft-sends.js";
import type { TranscriptEntry } from "../session/agent-db.js";
import type { ReviewTranscriptStore } from "./review-transcript-store.js";

const persistedDraft = z.object({ kind: z.literal("send-message"), message: draftCardMessageSchema,
  draftRoute: draftRouteSchema, draftRouteVerified: draftRouteVerificationSchema,
  draftSendState: draftSendStateSchema.optional(), draftRevision: z.number().int().nonnegative().default(0) });
function readDraft(agentId: string, entry: TranscriptEntry): DraftEntry | null {
  const parsed = persistedDraft.safeParse(entry);
  if (!parsed.success) return null;
  const value = parsed.data;
  return { agentId, entryId: entry.id, message: value.message, route: value.draftRoute,
    verification: value.draftRouteVerified, state: value.draftSendState ?? "editable", revision: value.draftRevision };
}

export function createReviewDraftStore(transcripts: ReviewTranscriptStore): DraftStore & {
  publish(agentId: string, emission: DraftEmission): Promise<string>;
} {
  return {
    async publish(agentId, emission) {
      const session = await transcripts.open(agentId);
      return session.append(emission.message, { draftRoute: emission.route, draftRouteVerified: emission.verification, draftRevision: 0 });
    },
    async read(key: DraftKey) {
      const session = await transcripts.open(key.agentId);
      const entry = session.readEntries().find(entry => entry.id === key.entryId);
      return entry === undefined ? null : readDraft(key.agentId, entry);
    },
    async compareAndSet(expected, next) {
      if (expected.agentId !== next.agentId || expected.entryId !== next.entryId || next.revision !== expected.revision + 1) return false;
      const session = await transcripts.open(expected.agentId);
      const current = session.readEntries().find(entry => entry.id === expected.entryId);
      if (current === undefined) return false;
      const saved = readDraft(expected.agentId, current);
      if (saved === null || JSON.stringify(saved) !== JSON.stringify(expected)) return false;
      return session.compareAndSet(current, { ...current, message: next.message, draftRoute: next.route,
        draftRouteVerified: next.verification, draftSendState: next.state, draftRevision: next.revision });
    },
    async listSending() {
      const sending: DraftEntry[] = [];
      for (const agentId of await transcripts.listAgentIds()) {
        const session = await transcripts.open(agentId);
        for (const entry of session.readEntries()) {
          const draft = readDraft(agentId, entry);
          if (draft?.state === "sending") sending.push(draft);
        }
      }
      return sending;
    },
  };
}
