import { z } from "zod";
import { readTranscriptWindow, transcriptLinesFromEntries, type TranscriptWindow } from "../transcript-read.js";

export type TranscriptTarget = { readonly kind: "self" } | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "agent"; readonly agentId: string } | { readonly kind: "subagent"; readonly subagentId: string };
export interface TranscriptWindowRequest { readonly before?: number | undefined; readonly limit?: number | undefined; readonly around?: number | undefined }
export interface TranscriptSource {
  readonly kind: "full" | "messages-only";
  readonly label: string;
  read(window: TranscriptWindowRequest): Promise<TranscriptWindow>;
}
export type TranscriptOpenResult = TranscriptSource | { readonly kind: "refused"; readonly message: string };
export interface TranscriptReader {
  openTranscript(context: unknown, target: TranscriptTarget): Promise<TranscriptOpenResult>;
  openSpokenTranscript(context: unknown, target: TranscriptTarget): Promise<TranscriptOpenResult>;
  readableSessions(): readonly { readonly id: string; readonly name: string }[];
}
export interface LoadedTranscript { readonly label: string; readonly entries: readonly Record<string, unknown>[] }
export interface EntryTranscriptDependencies {
  readonly selfId: string;
  readonly related: () => readonly { readonly id: string; readonly name: string }[];
  readonly agents?: () => readonly { readonly id: string; readonly name: string }[];
  readonly loadTranscript: (id: string) => Promise<LoadedTranscript | null>;
  readonly loadSubagentTranscript?: (id: string) => Promise<LoadedTranscript | null>;
  readonly ownSource?: () => TranscriptSource | null;
  readonly loadSpokenTranscript?: (id: string) => Promise<LoadedTranscript | null>;
}

export function createEntryTranscriptReader(deps: EntryTranscriptDependencies): TranscriptReader {
  async function open(target: TranscriptTarget, spoken: boolean): Promise<TranscriptOpenResult> {
    let id: string;
    let subagent = false;
    switch (target.kind) {
      case "self": id = deps.selfId; break;
      case "session": {
        id = target.sessionId;
        if (id !== deps.selfId && !deps.related().some((link) => link.id === id)) return { kind: "refused", message: "That conversation is not readable from this conversation." };
        break;
      }
      case "agent": {
        id = target.agentId;
        if (id !== deps.selfId && !(deps.agents?.() ?? deps.related()).some((agent) => agent.id === id)) return { kind: "refused", message: "That agent is not readable from this conversation." };
        break;
      }
      case "subagent": id = target.subagentId; subagent = true; break;
      default: { const unreachable: never = target; return unreachable; }
    }
    if (!spoken && !subagent && id === deps.selfId) {
      const own = deps.ownSource?.();
      if (own != null) return own;
    }
    const loaded = subagent ? await deps.loadSubagentTranscript?.(id)
      : await (spoken ? deps.loadSpokenTranscript ?? deps.loadTranscript : deps.loadTranscript)(id);
    if (loaded == null) return { kind: "refused", message: subagent ? "No readable subagent transcript for that id." : "No transcript recorded yet." };
    const messagesOnly = spoken || !subagent && id !== deps.selfId;
    const lines = transcriptLinesFromEntries(loaded.entries, !messagesOnly);
    return { kind: messagesOnly ? "messages-only" : "full", label: loaded.label, read: async (window) => readTranscriptWindow(lines, window) };
  }
  return { openTranscript: (_context, target) => open(target, false), openSpokenTranscript: (_context, target) => open(target, true), readableSessions: deps.related };
}

const rosterSchema = z.array(z.object({ id: z.string().min(1), name: z.string().optional(), isGroup: z.boolean().optional(),
  memberIds: z.array(z.string()).optional(), remoteRoom: z.unknown().optional() }));
export function createLocalConversationAccess(selfId: string, listAgents: () => unknown) {
  function roster() { const parsed = rosterSchema.safeParse(listAgents()); return parsed.success ? parsed.data : []; }
  return {
    agents: () => roster().filter((agent) => agent.id !== selfId && !agent.isGroup && agent.remoteRoom == null)
      .map((agent) => ({ id: agent.id, name: agent.name ?? agent.id })),
    related: () => roster().filter((agent) => agent.isGroup && agent.remoteRoom == null && agent.memberIds?.includes(selfId))
      .map((agent) => ({ id: agent.id, name: agent.name ?? agent.id })),
  };
}

export function transcriptPath(target: TranscriptTarget): string {
  switch (target.kind) {
    case "self": return "/transcripts/self";
    case "session": return `/transcripts/sessions/${encodeURIComponent(target.sessionId)}`;
    case "agent": return `/transcripts/agents/${encodeURIComponent(target.agentId)}`;
    case "subagent": return `/transcripts/subagents/${encodeURIComponent(target.subagentId)}`;
    default: { const unreachable: never = target; return unreachable; }
  }
}

export function transcriptTargetOfPath(path: string): TranscriptTarget | undefined {
  if (path === "/transcripts/self") return { kind: "self" };
  const match = /^\/transcripts\/(sessions|agents|subagents)\/([^/]+)$/.exec(path);
  if (match?.[2] === undefined) return undefined;
  let id: string;
  try { id = decodeURIComponent(match[2]); } catch (error) { if (error instanceof URIError) return undefined; throw error; }
  if (id.length === 0 || encodeURIComponent(id) !== match[2]) return undefined;
  switch (match[1]) {
    case "sessions": return { kind: "session", sessionId: id };
    case "agents": return { kind: "agent", agentId: id };
    case "subagents": return { kind: "subagent", subagentId: id };
    default: return undefined;
  }
}
