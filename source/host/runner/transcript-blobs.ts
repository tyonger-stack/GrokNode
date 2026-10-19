import { z } from "zod";
import { ConversationSummaryArchive, SubagentPersistedState } from "../../packages/proto/generated/agent/v1/agent_pb.js";
import { coreMessageSerde } from "../../packages/agent/serde.js";
import { formatSandTranscriptTraceLine } from "./transcript-trace.js";
import { clampTranscriptLimit, TRANSCRIPT_MAX_BYTES, type TranscriptWindow } from "./transcript-read.js";
import type { TranscriptSource, TranscriptWindowRequest } from "./sessions/transcript-reader.js";

const stateSchema = z.object({
  summaryArchives: z.array(z.instanceof(Uint8Array)).default([]),
  rootPromptMessagesJson: z.array(z.instanceof(Uint8Array)).default([]),
});

export function hasPromptTranscriptState(value: unknown): boolean {
  const state = stateSchema.safeParse(value);
  return state.success && state.data.summaryArchives.length + state.data.rootPromptMessagesJson.length > 0;
}

interface TranscriptBlobInput {
  readonly state: unknown;
  readonly getBlob: (id: Uint8Array) => Promise<Uint8Array | undefined>;
}

async function listMessageBlobIds(input: TranscriptBlobInput): Promise<readonly Uint8Array[]> {
  const state = stateSchema.safeParse(input.state);
  if (!state.success) return [];
  const ids: Uint8Array[] = [];
  for (const archiveId of state.data.summaryArchives) {
    const archive = await input.getBlob(archiveId);
    if (archive !== undefined) ids.push(...ConversationSummaryArchive.fromBinary(archive).summarizedMessages);
  }
  ids.push(...state.data.rootPromptMessagesJson);
  return ids;
}

export async function readArchivedPromptEntries(input: TranscriptBlobInput): Promise<readonly Record<string, unknown>[]> {
  const ids = await listMessageBlobIds(input);
  const entries: Record<string, unknown>[] = [];
  for (let offset = 0; offset < ids.length; offset += 8) {
    const batch = await Promise.all(ids.slice(offset, offset + 8).map(async (id) => {
      const blob = await input.getBlob(id);
      return blob === undefined ? null : coreMessageSerde.deserialize(blob);
    }));
    for (const message of batch) if (message !== null) entries.push({ kind: "prompt-message", ...message });
  }
  return entries;
}

export async function readSandTranscriptWindow(input: TranscriptBlobInput & TranscriptWindowRequest): Promise<TranscriptWindow> {
  const ids = await listMessageBlobIds(input);
  const end = input.before === undefined ? ids.length : Math.max(0, Math.min(input.before, ids.length));
  const limit = clampTranscriptLimit(input.limit);
  const lines: string[] = [];
  let first = end;
  let bytes = 0;
  let full = false;
  while (first > 0 && lines.length < limit && !full) {
    const chunkEnd = first;
    const chunkStart = Math.max(0, chunkEnd - Math.min(8, limit - lines.length));
    const chunk = await Promise.all(ids.slice(chunkStart, chunkEnd).map(async (id) => {
      const blob = await input.getBlob(id);
      return blob === undefined ? undefined : formatSandTranscriptTraceLine(coreMessageSerde.deserialize(blob));
    }));
    for (let index = chunkEnd - 1; index >= chunkStart; index -= 1) {
      const line = chunk[index - chunkStart];
      if (line !== undefined) {
        const size = Buffer.byteLength(line, "utf8");
        if (lines.length > 0 && bytes + size > TRANSCRIPT_MAX_BYTES) { full = true; break; }
        lines.unshift(line); bytes += size;
      }
      first = index;
    }
  }
  return { lines, first, end, total: ids.length, ...(first > 0 ? { olderBefore: first } : {}) };
}

export function createPromptTranscriptSource(input: {
  readonly label: string;
  readonly state: () => unknown;
  readonly getBlob: TranscriptBlobInput["getBlob"];
}): TranscriptSource {
  return { kind: "full", label: input.label, read: (window) => readSandTranscriptWindow({ ...window, state: input.state(), getBlob: input.getBlob }) };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readOwnedSubagentTranscript(runner: unknown, id: string) {
  if (!record(runner)) return null;
  if (typeof runner.getAgentConversationStateStructure === "function" && typeof runner.getBlobStore === "function") {
    const state: unknown = runner.getAgentConversationStateStructure();
    const store: unknown = runner.getBlobStore();
    if (record(state) && record(store) && typeof store.getBlob === "function") {
      const getBlob = store.getBlob;
      const context = record(runner.options) ? runner.options.ctx : undefined;
      const readBlob = async (blobId: Uint8Array): Promise<Uint8Array | undefined> => {
        const value: unknown = await Reflect.apply(getBlob, store, [context, blobId]);
        return value instanceof Uint8Array ? value : undefined;
      };
      let persisted: unknown = record(state.subagentStates) ? state.subagentStates[id] : undefined;
      const ref: unknown = record(state.subagentStateRefs) ? state.subagentStateRefs[id] : undefined;
      if (ref instanceof Uint8Array) {
        const blob = await readBlob(ref);
        if (blob !== undefined) persisted = SubagentPersistedState.fromBinary(blob);
      }
      if (record(persisted) && persisted.conversationState !== undefined) {
        return { label: id, entries: await readArchivedPromptEntries({ state: persisted.conversationState, getBlob: readBlob }) };
      }
    }
  }
  if (!record(runner.subagents)) return null;
  const runtime = runner.subagents;
  if (typeof runtime.listSubagents !== "function" || typeof runtime.getSubagentOutline !== "function") return null;
  const records: unknown = runtime.listSubagents();
  if (!Array.isArray(records)) return null;
  const match = records.find((item: unknown) => record(item) && item.subagentId === id);
  if (!record(match)) return null;
  const live = runtime.sessions instanceof Map ? runtime.sessions.get(id) : undefined;
  if (record(live) && typeof live.getAgentConversationStateStructure === "function" && typeof live.getBlobStore === "function") {
    const store: unknown = live.getBlobStore();
    if (record(store) && typeof store.getBlob === "function") {
      const getBlob = store.getBlob;
      const context = record(live.options) ? live.options.ctx : undefined;
      const entries = await readArchivedPromptEntries({ state: live.getAgentConversationStateStructure(),
        getBlob: async (blobId) => { const value: unknown = await Reflect.apply(getBlob, store, [context, blobId]); return value instanceof Uint8Array ? value : undefined; } });
      return { label: typeof match.title === "string" ? match.title : id, entries };
    }
  }
  const outline: unknown = await runtime.getSubagentOutline(id);
  return Array.isArray(outline) ? { label: typeof match.title === "string" ? match.title : id, entries: outline.filter(record) } : null;
}
