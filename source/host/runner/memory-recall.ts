import { formatMemoryDate } from "./sand-memory.js";
import type { ContextMemoryType } from "./memory-types.js";

export const RECALL_MEMORY_DEFAULT_LIMIT = 20;
export const RECALL_MEMORY_MAX_LIMIT = 50;
export const RECALL_MEMORY_CHAR_BUDGET = 4_000;
export type RecallMemoryScope = "agent" | "user" | "user_bot" | "all";

const NON_DISCRIMINATING_WORDS = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "by", "can", "do", "for",
  "from", "help", "how", "i", "in", "into", "is", "it", "me", "my", "need",
  "of", "on", "or", "some", "that", "the", "this", "to", "use", "using",
  "want", "we", "what", "when", "which", "with", "you", "your",
]);

export interface RecallMemoryFact {
  readonly content: string;
  readonly createdAt: number;
  readonly memoryType: ContextMemoryType;
  readonly assistantName?: string;
  readonly scope?: Exclude<RecallMemoryScope, "all">;
}

export function memoryFactsForScope(facts: readonly RecallMemoryFact[], scope: RecallMemoryScope): readonly RecallMemoryFact[] {
  return scope === "all" ? facts : facts.filter((fact) => (fact.scope ?? (fact.memoryType.startsWith("shared_") ? "user" : "agent")) === scope);
}

export function queryWords(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((word) => !NON_DISCRIMINATING_WORDS.has(word))
    .slice(0, 8);
}

function scoreFact(content: string, query: string, words: readonly string[]): number {
  const haystack = content.toLowerCase();
  const overlap = words.reduce((count, word) => count + (haystack.includes(word) ? 1 : 0), 0);
  if (overlap > 0) return overlap * 10;
  const literal = query.trim().toLowerCase();
  return literal.length > 0 && haystack.includes(literal) ? 1 : 0;
}

export function recallFactLine(fact: RecallMemoryFact): string {
  const via = fact.assistantName != null && fact.assistantName.trim().length > 0
    ? ` [via ${fact.assistantName.trim()}]`
    : "";
  return `- (learned ${formatMemoryDate(fact.createdAt)})${via}${fact.scope === "user_bot" ? " [with this person]" : ""} [${fact.memoryType}] ${fact.content}`;
}

export function recallMemoryFacts(
  facts: readonly RecallMemoryFact[],
  query: string,
  limit = RECALL_MEMORY_DEFAULT_LIMIT,
): { readonly lines: string[]; readonly searched: number } {
  const words = queryWords(query);
  const cap = Math.min(
    Math.max(1, Math.floor(limit)),
    RECALL_MEMORY_MAX_LIMIT,
  );
  const ranked = facts
    .map((fact) => ({ fact, score: scoreFact(fact.content, query, words) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.fact.createdAt - a.fact.createdAt)
    .slice(0, cap);
  const lines: string[] = [];
  let budget = RECALL_MEMORY_CHAR_BUDGET;
  for (const item of ranked) {
    const line = recallFactLine(item.fact);
    if (lines.length > 0 && line.length > budget) break;
    lines.push(line);
    budget -= line.length;
  }
  return { lines, searched: facts.length };
}

export function renderRecallMemoryResult(args: {
  readonly query: string;
  readonly lines: readonly string[];
  readonly searched: number;
  readonly scope?: RecallMemoryScope;
}): string {
  const label = args.scope === "agent" ? "your memory" : args.scope === "user" ? "the shared user memory"
    : args.scope === "user_bot" ? "your notes with this person" : "your memory and the shared user memory";
  if (args.lines.length === 0) {
    return `No facts in ${label} match "${args.query}" (${args.searched} searched). Try different words, or a shorter literal fragment.`;
  }
  const title = `Top ${args.lines.length} ${args.lines.length === 1 ? "match" : "matches"} for "${args.query}" in ${label} (${args.searched} ${args.searched === 1 ? "fact" : "facts"} searched):`;
  return [title, ...args.lines].join("\n");
}
