import { z } from "zod";
import { defineCommunicateTool } from "./communicate-tool.js";
import { SandToolInputError } from "./tool-input-error.js";
import { renderTranscriptRead, searchSpokenLines, type TranscriptLine } from "../transcript-read.js";
import { createEntryTranscriptReader, transcriptPath, transcriptTargetOfPath, type TranscriptReader, type TranscriptSource, type TranscriptTarget, type EntryTranscriptDependencies } from "../sessions/transcript-reader.js";

export interface TranscriptToolDependencies extends EntryTranscriptDependencies {
  readonly transcriptReader?: TranscriptReader;
}

const targets = {
  session_id: z.string().trim().optional().describe("Another conversation's session_id from the related conversations list. Omit to read this conversation."),
  agent_id: z.string().trim().optional().describe("Another agent owned by the same user, using an agent id from your agent directory."),
  subagent_id: z.string().trim().optional().describe("A background subagent you dispatched, using the Agent ID from its dispatch result."),
};
const readParameters = z.object({ ...targets,
  limit: z.number().int().min(1).max(200).optional(),
  before: z.number().int().nonnegative().optional(),
  around: z.number().int().nonnegative().optional(),
});
const searchParameters = z.object({ ...targets,
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(200).optional(),
  all_conversations: z.boolean().optional(),
});
const fileParameters = z.object({
  path: z.string().trim().min(1),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});
type TargetArgs = Pick<z.infer<typeof readParameters>, "session_id" | "agent_id" | "subagent_id">;

function virtualPath(id: string, subagent = false): string {
  return `/transcripts/${subagent ? "subagents/" : ""}${encodeURIComponent(id)}.jsonl`;
}

function targetOf(deps: TranscriptToolDependencies, args: TargetArgs): TranscriptTarget {
  const sessionId = args.session_id || undefined;
  const agentId = args.agent_id || undefined;
  const subagentId = args.subagent_id || undefined;
  const ids = [sessionId, agentId, subagentId].filter((id) => id !== undefined);
  if (ids.length > 1) throw new SandToolInputError("Pass at most one of session_id, agent_id, or subagent_id.");
  if (subagentId !== undefined) return { kind: "subagent", subagentId };
  if (agentId !== undefined) return agentId === deps.selfId ? { kind: "self" } : { kind: "agent", agentId };
  return sessionId === undefined || sessionId === deps.selfId ? { kind: "self" } : { kind: "session", sessionId };
}

async function loadTarget(deps: TranscriptToolDependencies, args: TargetArgs, spoken = false) {
  const target = targetOf(deps, args);
  const reader = deps.transcriptReader ?? createEntryTranscriptReader(deps);
  const source = await (spoken ? reader.openSpokenTranscript(undefined, target) : reader.openTranscript(undefined, target));
  if (source.kind === "refused") throw new SandToolInputError(source.message);
  const id = args.session_id || args.agent_id || args.subagent_id || deps.selfId;
  return { id, target, path: transcriptPath(target), filePath: virtualPath(id, target.kind === "subagent"), label: source.label,
    spokenOnly: source.kind === "messages-only", source };
}

const spokenLineSchema = z.object({ position: z.number().optional(), role: z.enum(["user", "assistant", "tool"]), message: z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) }) });
async function scan(source: TranscriptSource) {
  const lines: { readonly raw: string; readonly line: TranscriptLine }[] = [];
  let before: number | undefined;
  do {
    const page = await source.read({ before, limit: 200 });
    const chunk = page.lines.flatMap((raw, index) => {
      const parsed = spokenLineSchema.safeParse(JSON.parse(raw));
      return parsed.success ? [{ raw, line: { position: parsed.data.position ?? page.first + index,
        role: parsed.data.role, text: parsed.data.message.content.map((part) => part.text).join("\n") } }] : [];
    });
    lines.unshift(...chunk);
    if (page.olderBefore === before || page.lines.length === 0) break;
    before = page.olderBefore;
  } while (before !== undefined && lines.length < 2000);
  return { lines: lines.slice(-2000), partial: before !== undefined };
}

async function search(deps: TranscriptToolDependencies, args: z.infer<typeof searchParameters>) {
  const named = Boolean(args.session_id || args.agent_id || args.subagent_id);
  if (named && args.all_conversations) throw new SandToolInputError("Use a target id or all_conversations, not both.");
  const requests: TargetArgs[] = args.all_conversations ? [{}, ...deps.related().map(({ id }) => ({ session_id: id }))] : [args];
  const hits = [];
  for (const request of requests) {
    const loaded = await loadTarget(deps, request, true);
    const scanned = await scan(loaded.source);
    const spoken = scanned.lines.map((entry) => entry.line);
    for (const hit of searchSpokenLines(loaded.id, loaded.label, spoken, args.query)) {
      hits.push({ ...hit, path: loaded.path, filePath: loaded.filePath, partial: scanned.partial, line: spoken.findIndex((line) => line.position === hit.position) + 1 });
    }
  }
  return hits.sort((a, b) => b.score - a.score || b.position - a.position).slice(0, args.limit ?? 10);
}

export function createTranscriptTools(deps: TranscriptToolDependencies) {
  const read = defineCommunicateTool(deps, {
    id: "SEARCH_CONVERSATIONS", name: "ReadTranscript",
    description: "Read persisted earlier messages, reasoning and tool activity in this conversation, including history compacted out of context. Other readable conversations share only what was said. Use around=<position> to open a SearchTranscripts match; before pages backward. subagent_id reads only your dispatched subagents.",
    parameters: readParameters,
    execute: async (_ctx, args: z.infer<typeof readParameters>) => {
      const loaded = await loadTarget(deps, args, args.around !== undefined);
      const window = await loaded.source.read({ limit: args.limit, before: args.around === undefined ? args.before : args.around + Math.ceil((args.limit ?? 30) / 2) });
      return `Transcript path: ${loaded.path}\n${renderTranscriptRead({ label: loaded.label, spokenOnly: loaded.spokenOnly, window })}`;
    },
  });
  const find = (name: "SearchTranscripts" | "SearchTranscriptFiles") => defineCommunicateTool(deps, {
    id: "SEARCH_CONVERSATIONS", name,
    description: "Find spoken messages ranked by query words, excluding reasoning and tool activity. With no id searches this conversation; all_conversations searches the readable conversations together. Each hit has session_id, position and a virtual file with line number. Open using ReadTranscript around=<position> or ReadTranscriptFile path and offset.",
    parameters: searchParameters,
    execute: async (_ctx, args: z.infer<typeof searchParameters>) => {
      const hits = await search(deps, args);
      const lines = hits.map((hit) => `- ${hit.label} (session_id: ${hit.sessionId}) position ${hit.position}; ${hit.path}; ${hit.filePath}:${hit.line}: ${hit.snippet}${hit.partial ? " [only the newest 2000 messages searched]" : ""}`);
      const shown: string[] = [];
      let bytes = 0;
      for (const line of lines) {
        const size = Buffer.byteLength(line, "utf8");
        if (bytes + size > 4000) break;
        shown.push(line); bytes += size;
      }
      return shown.length === 0 ? "No spoken messages match the query." : shown.join("\n");
    },
  });
  const readFile = defineCommunicateTool(deps, {
    id: "SEARCH_CONVERSATIONS", name: "ReadTranscriptFile",
    description: "Read a virtual transcript file returned by a transcript search or ReadTranscript. offset is a one-based line number, default 1; limit defaults to 200, max 1000. Only authorized transcript paths are readable; this tool does not read arbitrary files.",
    parameters: fileParameters,
    execute: async (_ctx, args: z.infer<typeof fileParameters>) => {
      const link = [{ id: deps.selfId }, ...deps.related(), ...(deps.agents?.() ?? [])].find(({ id }) => virtualPath(id) === args.path);
      const subagentPrefix = "/transcripts/subagents/";
      let request: TargetArgs;
      const canonical = transcriptTargetOfPath(args.path);
      if (canonical !== undefined) {
        switch (canonical.kind) {
          case "self": request = {}; break;
          case "session": request = { session_id: canonical.sessionId }; break;
          case "agent": request = { agent_id: canonical.agentId }; break;
          case "subagent": request = { subagent_id: canonical.subagentId }; break;
          default: { const unreachable: never = canonical; return unreachable; }
        }
      } else if (link !== undefined) request = deps.agents?.().some((agent) => agent.id === link.id) ? { agent_id: link.id } : { session_id: link.id };
      else if (args.path.startsWith(subagentPrefix) && args.path.endsWith(".jsonl")) {
        const encoded = args.path.slice(subagentPrefix.length, -6);
        let id: string;
        try { id = decodeURIComponent(encoded); } catch (error) { if (error instanceof URIError) throw new SandToolInputError("Invalid transcript path."); throw error; }
        if (virtualPath(id, true) !== args.path) throw new SandToolInputError("Invalid transcript path.");
        request = { subagent_id: id };
      } else throw new SandToolInputError("Use a transcript path returned by a transcript tool.");
      const loaded = await loadTarget(deps, request, true);
      const scanned = await scan(loaded.source);
      const source = scanned.lines.map((entry) => entry.raw);
      const start = (args.offset ?? 1) - 1;
      const shown: string[] = [];
      let bytes = 0;
      for (let index = start; index < Math.min(source.length, start + (args.limit ?? 200)); index += 1) {
        const line = `${index + 1}: ${source[index] ?? ""}`;
        if (bytes + Buffer.byteLength(line, "utf8") > 20_000) break;
        shown.push(line); bytes += Buffer.byteLength(line, "utf8");
      }
      const next = start + shown.length < source.length ? `\nNext offset: ${start + shown.length + 1}` : "";
      return `${loaded.path}, ${shown.length} of ${source.length} spoken lines${scanned.partial ? " (newest 2000 only)" : ""}\n${shown.join("\n")}${next}`;
    },
  });
  return [read, find("SearchTranscripts"), find("SearchTranscriptFiles"), readFile];
}
