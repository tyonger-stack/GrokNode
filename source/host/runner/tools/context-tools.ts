import { z } from "zod";
import { UserMemoryStore } from "../../extensions/memory/memory-service.js";
import {
  isContextMemoryType,
  memoryTypeForStoredKind,
  memoryWriteTarget,
  type ContextMemoryType,
} from "../memory-types.js";
import {
  recallMemoryFacts,
  renderRecallMemoryResult,
  memoryFactsForScope,
  type RecallMemoryFact,
} from "../memory-recall.js";
import { defineCommunicateTool } from "./communicate-tool.js";
import { SandToolInputError } from "./tool-input-error.js";
import { createTranscriptTools } from "./transcript-tools.js";
import { createEntryTranscriptReader, type EntryTranscriptDependencies, type TranscriptReader } from "../sessions/transcript-reader.js";

export const UPDATE_MEMORY_TOOL_NAME = "UpdateMemory";
export const RECALL_MEMORY_TOOL_NAME = "RecallMemory";
export const SEARCH_TRANSCRIPTS_TOOL_NAME = "SearchTranscripts";

const immediateDebounce = {
  name: "sand-context-memory",
  wrap: <T extends (...args: never[]) => unknown>(fn: T) => Object.assign(fn, { dispose() {} }),
};

export interface ContextStatePort {
  writeMemory(args: {
    content: string;
    tier: string;
    scope: string;
    project?: string;
  }): Promise<{ ok: true; detail: string } | { ok: false; reason: string }>;
  removeMemory(args: {
    content: string;
    scope: string;
    project?: string;
  }): Promise<{ ok: true; detail: string } | { ok: false; reason: string }>;
}

export interface LoadedTranscript {
  readonly label: string;
  readonly entries: readonly Record<string, unknown>[];
}

export interface ContextToolDependencies {
  readonly state: ContextStatePort;
  readonly selfId: string;
  readonly listFacts: () => readonly RecallMemoryFact[];
  readonly loadTranscript: (id: string) => Promise<LoadedTranscript | null>;
  readonly related: () => readonly { readonly id: string; readonly name: string }[];
  readonly loadSubagentTranscript?: (id: string) => Promise<LoadedTranscript | null>;
  readonly supportsUserBotMemory?: boolean;
  readonly transcriptReader?: TranscriptReader;
  readonly agents?: () => readonly { readonly id: string; readonly name: string }[];
}

interface OwnMemoryRecord {
  readonly content?: unknown;
  readonly createdAt?: unknown;
  readonly kind?: unknown;
}

function ownFacts(memory: unknown, scope: "agent" | "user_bot" = "agent"): RecallMemoryFact[] {
  if (typeof memory !== "object" || memory == null || !("listMemories" in memory) || typeof memory.listMemories !== "function") return [];
  const list: unknown = memory.listMemories(Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: OwnMemoryRecord) => {
    if (typeof item.content !== "string" || item.kind !== "profile" && item.kind !== "log") return [];
    return [{
      content: item.content,
      createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
      memoryType: memoryTypeForStoredKind(item.kind, "agent"),
      scope,
    }];
  });
}

function userBotStore(memory: unknown): unknown {
  if (typeof memory !== "object" || memory === null || !("memoryScopes" in memory)) return undefined;
  const scopes = memory.memoryScopes;
  return typeof scopes === "object" && scopes !== null && "userBot" in scopes ? scopes.userBot : undefined;
}

function sharedFacts(
  sandRoot: string | undefined,
  selfId: string,
  resolveAgentName: (id: string) => string,
): RecallMemoryFact[] {
  if (sandRoot == null || sandRoot.length === 0) return [];
  const store = new UserMemoryStore(sandRoot, selfId, resolveAgentName, immediateDebounce);
  const recalled = store.recallAll();
  const mapKind = (kind: string | undefined): ContextMemoryType =>
    memoryTypeForStoredKind(kind === "profile" ? "profile" : "log", "user");
  return [
    ...recalled.filter((fact) => fact.kind === "profile").map((fact) => ({
      content: fact.content,
      createdAt: fact.createdAt,
      memoryType: mapKind(fact.kind),
      assistantName: fact.agentName,
      scope: "user" as const,
    })),
    ...recalled.filter((fact) => fact.kind === "log").map((fact) => ({
      content: fact.content,
      createdAt: fact.createdAt,
      memoryType: mapKind(fact.kind),
      assistantName: fact.agentName,
      scope: "user" as const,
    })),
  ];
}

export function buildContextToolDependencies(input: EntryTranscriptDependencies & {
  readonly state: ContextStatePort;
  readonly selfId: string;
  readonly ownMemory: unknown;
  readonly sandRoot?: string;
  readonly resolveAgentName?: (id: string) => string;
  readonly loadTranscript: (id: string) => Promise<LoadedTranscript | null>;
  readonly related: () => readonly { readonly id: string; readonly name: string }[];
  readonly loadSubagentTranscript?: (id: string) => Promise<LoadedTranscript | null>;
  readonly transcriptReader?: TranscriptReader;
}): ContextToolDependencies {
  const resolveAgentName = input.resolveAgentName ?? ((id: string) => id);
  return {
    state: input.state,
    selfId: input.selfId,
    listFacts: () => [
      ...ownFacts(input.ownMemory),
      ...ownFacts(userBotStore(input.ownMemory), "user_bot"),
      ...sharedFacts(input.sandRoot, input.selfId, resolveAgentName),
    ],
    supportsUserBotMemory: userBotStore(input.ownMemory) !== undefined,
    transcriptReader: input.transcriptReader ?? createEntryTranscriptReader(input),
    ...(input.agents === undefined ? {} : { agents: input.agents }),
    loadTranscript: input.loadTranscript,
    related: input.related,
    ...(input.loadSubagentTranscript === undefined ? {} : { loadSubagentTranscript: input.loadSubagentTranscript }),
  };
}

const CONTEXT_MEMORY_TYPE_VALUES = [
  "profile",
  "journal",
  "shared_profile",
  "shared_journal",
] as const;

const updateMemoryParameters = z.object({
  action: z.enum(["write", "forget"]).describe('action "write" saves a fact; action "forget" drops one by its exact text.'),
  fact: z.string().trim().min(1).describe("The fact to save, or the exact recorded text to forget."),
  type: z.enum(CONTEXT_MEMORY_TYPE_VALUES).optional().describe("The memory type to write or forget."),
  memory_type: z.enum(CONTEXT_MEMORY_TYPE_VALUES).optional().describe(
    'Required for write. profile and journal are this agent. shared_profile and shared_journal are the user across assistants.',
  ),
});

const recallMemoryParameters = z.object({
  query: z.string().trim().min(1).describe(
    "What to look for. Facts sharing distinctive words with the query rank first; when nothing overlaps, a literal case-insensitive substring match is used instead.",
  ),
  limit: z.number().int().min(1).max(50).optional().describe("Maximum facts to return (default 20, max 50)."),
  scope: z.enum(["agent", "user", "all"]).optional().describe("Search agent memory, shared user memory, or both (all)."),
});

async function forgetFact(state: ContextStatePort, fact: string): Promise<string> {
  const scopes = ["agent", "user"] as const;
  for (const scope of scopes) {
    const outcome = await state.removeMemory({ content: fact, scope });
    if (outcome.ok) return outcome.detail;
  }
  return `Not saved — no fact with exactly that text is recorded in your memory or shared user memory.`;
}

export function createContextTools(deps: ContextToolDependencies) {
  const updateMemory = defineCommunicateTool(deps, {
    id: "PLATFORM_ACTION",
    name: UPDATE_MEMORY_TOOL_NAME,
    description: [
      'Change durable memory. action "write" saves a fact into a memory type: profile and journal stay on this agent; shared_profile and shared_journal are the user across assistants.',
      'action "forget" drops a fact by its exact text.',
      "Prefer this over editing memory files with the shell.",
    ].join("\n"),
    parameters: updateMemoryParameters,
    describeActivity: (args: z.infer<typeof updateMemoryParameters>) => ({ detail: args.type ?? args.memory_type ?? args.action }),
    execute: async (_ctx, args: z.infer<typeof updateMemoryParameters>) => {
      if (args.type !== undefined && args.memory_type !== undefined && args.type !== args.memory_type) throw new SandToolInputError("type and memory_type must agree.");
      const type = args.type ?? args.memory_type;
      if (args.action === "forget" && type === undefined) return forgetFact(deps.state, args.fact);
      if (type == null || !isContextMemoryType(type)) {
        throw new SandToolInputError("write requires memory_type: profile, journal, shared_profile, or shared_journal.");
      }
      const target = memoryWriteTarget(type);
      if (args.action === "forget") {
        if (!deps.listFacts().some((fact) => fact.memoryType === type && fact.content === args.fact)) return "No fact with that exact text is recorded in that memory type.";
        const outcome = await deps.state.removeMemory({ content: args.fact, scope: target.scope });
        return outcome.ok ? outcome.detail : `Not saved — ${outcome.reason}`;
      }
      const outcome = await deps.state.writeMemory({
        content: args.fact,
        tier: target.tier,
        scope: target.scope,
      });
      return outcome.ok ? outcome.detail : `Not saved — ${outcome.reason}`;
    },
  });

  const recallMemory = defineCommunicateTool(deps, {
    id: "PLATFORM_ACTION",
    name: RECALL_MEMORY_TOOL_NAME,
    description: [
      "Search your durable memory for facts that are not in the memory section of your prompt: older journal entries, notes that have aged out of the recent slice, and shared user facts recorded by any of this user's assistants.",
      "Read-only. Results list each fact with its date, memory type and, for shared facts, which assistant learned it.",
      `To add or drop a fact use ${UPDATE_MEMORY_TOOL_NAME}. Prefer this tool over grepping memory folders.`,
    ].join("\n"),
    parameters: deps.supportsUserBotMemory === true
      ? recallMemoryParameters.extend({ scope: z.enum(["agent", "user", "user_bot", "all"]).optional() }) : recallMemoryParameters,
    describeActivity: (args: { query: string; limit?: number }) => ({ detail: args.query }),
    execute: async (_ctx, args: { query: string; limit?: number; scope?: "agent" | "user" | "user_bot" | "all" }) => {
      const scope = args.scope ?? "all";
      const found = recallMemoryFacts(memoryFactsForScope(deps.listFacts(), scope), args.query, args.limit);
      return renderRecallMemoryResult({ query: args.query.trim(), scope, ...found });
    },
  });

  return [updateMemory, recallMemory, ...createTranscriptTools(deps)];
}
