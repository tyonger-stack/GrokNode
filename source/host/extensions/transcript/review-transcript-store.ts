import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { SandAgentDb, type TranscriptEntry } from "../session/agent-db.js";
import type { TranscriptManager } from "./transcript-manager.js";
import { appendEntry, updateEntry } from "./transcript-store.js";

export class ReviewTranscriptWriteError extends Error {
  override readonly name = "ReviewTranscriptWriteError";
  constructor() { super("The review card could not be saved. Nothing was sent."); }
}

export class ReviewTranscriptStore {
  constructor(private readonly transcript: TranscriptManager) {}

  async open(agentId: string) {
    const session = await this.transcript.sessions.resolveBackgroundSession(agentId);
    const candidate: unknown = session.db;
    if (!(candidate instanceof SandAgentDb)) throw new ReviewTranscriptWriteError();
    const db = candidate;
    const notify = (entry: TranscriptEntry, added = false): void => {
      if (this.transcript.sessions.activeSession?.id === agentId) {
        if (added) appendEntry(entry);
        else updateEntry(entry.id, () => entry);
        this.transcript.roster.emit({ type: added ? "appended" : "updated", entry });
      }
      void this.transcript.roster.emitAgentUpdate(agentId);
    };
    return {
      id: agentId,
      directory: dirname(session.dbPath),
      readEntries: (): readonly TranscriptEntry[] => db.getTranscriptEntries(),
      append: (message: Readonly<Record<string, unknown>>, metadata: Readonly<Record<string, unknown>> = {}): string => {
        const entry: TranscriptEntry = { ...metadata, id: `send-message-${randomUUID()}`, kind: "send-message", timestampMs: Date.now(), message };
        if (!db.appendTranscriptEntry(entry)) throw new ReviewTranscriptWriteError();
        notify(entry, true);
        return entry.id;
      },
      update: (entryId: string, change: (entry: TranscriptEntry) => TranscriptEntry): TranscriptEntry | null => {
        const updated = db.updateTranscriptEntry(entryId, change);
        if (updated !== null) notify(updated);
        return updated;
      },
      compareAndSet: (expected: TranscriptEntry, next: TranscriptEntry): boolean => {
        if (!db.compareAndSetTranscriptEntry(expected, next)) return false;
        notify(next);
        return true;
      },
    };
  }

  async listAgentIds(): Promise<readonly string[]> {
    const ids: unknown = await this.transcript.sessionStore.listAgentRecordIds();
    if (!Array.isArray(ids)) throw new ReviewTranscriptWriteError();
    return ids.filter((id): id is string => typeof id === "string");
  }

  async wake(agentId: string, receipt: string, inferenceRequestId?: string): Promise<void> {
    const errorTitle = "Agent could not resume after a review action";
    await this.transcript.boxHandoff.resumeWithHiddenPrompt(agentId, receipt, inferenceRequestId === undefined ? errorTitle : { errorTitle, inferenceRequestId });
  }
}
