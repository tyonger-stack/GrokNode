/**
 * xAI compaction out-of-band segment store (evidence: host-main.cjs
 * compactionSegmentsDir / formatCompactionSegmentsHint / writeCompactionSegment).
 * Writes `compaction/segment_NNN.md` + `INDEX.md` under the agent transcripts folder
 * so a successor can recover exact code / tool output after the live prompt is replaced.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createLogger } from "../../context/index.js";
import type { Context } from "../../context/core.js";

const logger = createLogger("@anysphere/agent");

export const COMPACTION_SEGMENTS_DIR = "compaction";
export const COMPACTION_INDEX_FILE = "INDEX.md";
const SEGMENT_PREFIX = "segment_";

export const COMPACTION_INDEX_HEADER =
  "# Compaction Segment Index\n\n| Segment | File | Turns | Approx bytes | Keywords |\n|---|---|---|---|---|\n";

function getSafeConversationId(conversationId: string): string {
  return conversationId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function segmentLabel(index: number): string {
  return String(index).padStart(3, "0");
}

export function compactionSegmentFilename(index: number): string {
  return `${SEGMENT_PREFIX}${segmentLabel(index)}.md`;
}

export function parseCompactionSegmentIndex(filename: string): number | undefined {
  if (!filename.startsWith(SEGMENT_PREFIX) || !filename.endsWith(".md")) return undefined;
  const digits = filename.slice(SEGMENT_PREFIX.length, -".md".length);
  return /^\+?\d+$/.test(digits) ? Number(digits) : undefined;
}

export function compactionSegmentsDir(args: {
  readonly agentTranscriptsFolder: string;
  readonly conversationId: string;
  readonly subagentId?: string | undefined;
}): string {
  const conversationDir = join(
    args.agentTranscriptsFolder,
    getSafeConversationId(args.conversationId),
  );
  return args.subagentId === undefined
    ? join(conversationDir, COMPACTION_SEGMENTS_DIR)
    : join(
      conversationDir,
      "subagents",
      getSafeConversationId(args.subagentId),
      COMPACTION_SEGMENTS_DIR,
    );
}

export function formatCompactionSegmentsHint(compactionDir: string): string {
  return `

Full verbatim rollouts of previous segments are available at ${compactionDir}/segment_*.md.  See ${compactionDir}/${COMPACTION_INDEX_FILE} for a table of contents.  Use read_file or grep to recover specific details (exact code, file paths, tool outputs) if this summary is insufficient.  Do NOT delete these files.`;
}

function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function extractCompactionKeywords(summary: string): string[] {
  const stopwords = new Set([
    "section", "summary", "current", "work", "errors", "analysis", "primary",
    "request", "intent", "technical", "concepts", "pending", "problem", "solving",
    "include", "outline", "describe", "specific", "messages", "feedback", "snippet",
    "snippets", "session", "explicit", "thorough", "language", "important", "convention",
  ]);
  const start = /^#{0,6}\s*8\.\s+Current Work/m.exec(summary);
  let text = summary;
  if (start !== null) {
    const nextHeader = /^#{0,6}\s*\d+\.\s+[A-Z]/gm;
    nextHeader.lastIndex = start.index + start[0].length;
    const end = nextHeader.exec(summary);
    text = summary.slice(start.index, end === null ? summary.length : end.index);
  }
  const seen: string[] = [];
  for (const match of text.matchAll(/[A-Z][A-Za-z0-9_]{3,}|[a-z][a-z0-9_]{5,}/g)) {
    const keyword = match[0]!;
    if (stopwords.has(keyword.toLowerCase()) || seen.includes(keyword)) continue;
    seen.push(keyword);
    if (seen.length >= 8) break;
  }
  return seen;
}

function renderCompactionIndexRow(args: {
  readonly index: number;
  readonly turnCount: number;
  readonly approxBytes: number;
  readonly keywords: readonly string[];
}): string {
  const keywordText = args.keywords.map(keyword => `"${keyword}"`).join(", ");
  return `| ${segmentLabel(args.index)} | ${compactionSegmentFilename(args.index)} | ${args.turnCount} | ${args.approxBytes} | ${keywordText} |\n`;
}

function messageRoleLabel(role: string): string {
  switch (role) {
    case "system": return "System";
    case "user": return "Human";
    case "assistant": return "Assistant";
    case "tool": return "Function";
    default: return role;
  }
}

function flattenMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    try { return JSON.stringify(content) ?? ""; } catch { return ""; }
  }
  return content.map(part => {
    if (part == null || typeof part !== "object") return "";
    const typed = part as { type?: string; text?: unknown; toolName?: unknown; args?: unknown; result?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") return typed.text;
    if (typed.type === "tool-call") {
      try { return `[tool_request: ${String(typed.toolName)}] ${JSON.stringify(typed.args) ?? ""}`; }
      catch { return `[tool_request: ${String(typed.toolName)}]`; }
    }
    if (typed.type === "tool-result") {
      try { return `[tool_response] ${typeof typed.result === "string" ? typed.result : JSON.stringify(typed.result) ?? ""}`; }
      catch { return "[tool_response]"; }
    }
    if (typed.type === "image") return "[image]";
    return "";
  }).filter(Boolean).join("\n");
}

export function renderCompactionSegmentMarkdown(args: {
  readonly index: number;
  readonly timestamp: string;
  readonly summary: string;
  readonly messages: readonly { readonly role: string; readonly content?: unknown }[];
}): string {
  const label = segmentLabel(args.index);
  const turns = args.messages.map((message, turnIndex) => {
    const text = flattenMessageText(message.content);
    return `### Turn ${turnIndex} (${messageRoleLabel(message.role)})\n${text}\n`;
  });
  return `# History segment ${label}

- Written at: ${args.timestamp}
- Turns: ${args.messages.length}

## Compact summary

${args.summary}

## Verbatim turns

${turns.join("\n")}`;
}

export function writeCompactionSegment(args: {
  readonly compactionDir: string;
  readonly messages: readonly { readonly role: string; readonly content?: unknown }[];
  readonly rawSummary: string;
  readonly timestamp?: string | undefined;
}): { readonly index: number; readonly path: string } | undefined {
  mkdirSync(args.compactionDir, { recursive: true });
  const existing = readdirSync(args.compactionDir);
  const knownIndices = existing.flatMap(name => {
    const index = parseCompactionSegmentIndex(name);
    return index === undefined ? [] : [index];
  });
  const indexPath = join(args.compactionDir, COMPACTION_INDEX_FILE);
  let existingIndex = "";
  try {
    existingIndex = readFileSync(indexPath, "utf8");
    for (const match of existingIndex.matchAll(/^\| \d+ \| (segment_\d+\.md) \|/gm)) {
      const parsed = parseCompactionSegmentIndex(match[1]!);
      if (parsed !== undefined) knownIndices.push(parsed);
    }
  } catch {
    existingIndex = "";
  }
  const index = knownIndices.length === 0 ? 0 : Math.max(...knownIndices) + 1;
  const timestamp = args.timestamp ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const markdown = renderCompactionSegmentMarkdown({
    index,
    timestamp,
    summary: args.rawSummary,
    messages: args.messages,
  });
  const segmentPath = join(args.compactionDir, compactionSegmentFilename(index));
  writeFileSync(segmentPath, markdown, "utf8");
  const row = renderCompactionIndexRow({
    index,
    turnCount: args.messages.length,
    approxBytes: utf8ByteLength(markdown),
    keywords: extractCompactionKeywords(args.rawSummary),
  });
  writeFileSync(
    indexPath,
    `${existingIndex === "" ? COMPACTION_INDEX_HEADER : existingIndex}${row}`,
    "utf8",
  );
  return { index, path: segmentPath };
}

export function persistCompactionSegmentSafe(
  ctx: Context,
  args: {
    readonly compactionDir: string;
    readonly messages: readonly { readonly role: string; readonly content?: unknown }[];
    readonly rawSummary: string;
  },
): void {
  try {
    const written = writeCompactionSegment(args);
    logger.info(ctx, "[xai-compaction] compaction segment written", {
      summarization: {
        compactionDir: args.compactionDir,
        segmentIndex: written?.index,
        messageCount: args.messages.length,
      },
    });
  } catch (error) {
    logger.warn(ctx, "[xai-compaction] compaction segment persistence failed", {
      summarization: { error, compactionDir: args.compactionDir },
    });
  }
}
