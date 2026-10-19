import { SAND_HIDDEN_PROMPT_MARKER } from "./sand-prompt-markers.js";
import { READ_TRANSCRIPT_TOOL_NAME } from "./sessions/related-conversations-prompt.js";
import { formatSandTranscriptTraceLine } from "./transcript-trace.js";

export const TRANSCRIPT_DEFAULT_MESSAGES = 30;
export const TRANSCRIPT_MAX_MESSAGES = 200;
export const TRANSCRIPT_MAX_BYTES = 48_000;
export const TRANSCRIPT_MAX_PART_CHARS = 4_000;

export interface TranscriptLine {
  readonly position: number;
  readonly role: "user" | "assistant" | "tool";
  readonly text: string;
  readonly content?: Readonly<Record<string, unknown>>;
  readonly messageContent?: unknown;
}

export function clampTranscriptLimit(limit: number | undefined): number {
  const safe = limit !== undefined && Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : TRANSCRIPT_DEFAULT_MESSAGES;
  return Math.min(safe, TRANSCRIPT_MAX_MESSAGES);
}

export function truncateMiddle(text: string, max = TRANSCRIPT_MAX_PART_CHARS): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

function visibleText(text: string): string {
  const stripped = text.startsWith(SAND_HIDDEN_PROMPT_MARKER)
    ? text.slice(SAND_HIDDEN_PROMPT_MARKER.length)
    : text;
  return stripped.replace(/\s+/g, " ").trim();
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Spoken lines are what another conversation may share. Tool lines stay on self reads. */
export function transcriptLinesFromEntries(
  entries: readonly Record<string, unknown>[],
  includeTools: boolean,
): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  entries.forEach((entry, position) => {
    const kind = stringField(entry.kind);
    if (kind === "prompt-message") {
      if (entry.role === "system") return;
      const options = entry.providerOptions;
      if (typeof options === "object" && options !== null && "cursor" in options) {
        const cursor = options.cursor;
        if (typeof cursor === "object" && cursor !== null && "isSummary" in cursor && cursor.isSummary === true) return;
      }
      const text = typeof entry.content === "string" ? visibleText(entry.content)
        : Array.isArray(entry.content) ? entry.content.flatMap((part: unknown) =>
          typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? [part.text] : []).join("\n") : "";
      const role = entry.role === "user" ? "user" : entry.role === "tool" ? "tool" : "assistant";
      if (!includeTools) {
        if (role === "user" && text.length > 0 && !String(entry.content ?? "").startsWith(SAND_HIDDEN_PROMPT_MARKER)) {
          lines.push({ position, role, text });
        } else if (role === "assistant" && Array.isArray(entry.content)) {
          for (const part of entry.content) {
            if (typeof part !== "object" || part === null || !("toolName" in part) || typeof part.toolName !== "string"
              || !/(?:send_message|SendToUser|SendMessage)$/.test(part.toolName) || !("args" in part)) continue;
            const args: unknown = part.args;
            if (typeof args === "object" && args !== null && "content" in args && typeof args.content === "string") {
              lines.push({ position, role: "assistant", text: visibleText(args.content) });
            }
          }
        }
        return;
      }
      if (formatSandTranscriptTraceLine(entry) !== undefined) lines.push({ position, role, text, messageContent: entry.content });
      return;
    }
    if (includeTools && kind === "user") {
      const text = visibleText(stringField(entry.text) ?? "");
      if (text.length > 0) lines.push({ position, role: "user", text });
      return;
    }
    if (kind === "message" && entry.role === "user") {
      if (!includeTools && (entry.hidden === true || String(entry.content ?? "").startsWith(SAND_HIDDEN_PROMPT_MARKER))) return;
      const text = visibleText(stringField(entry.content) ?? "");
      if (text.length > 0) lines.push({ position, role: "user", text });
      return;
    }
    if (kind === "send-message") {
      const message = entry.message;
      if (typeof message !== "object" || message == null) return;
      const record = message as Record<string, unknown>;
      if (record.type !== "text") return;
      const text = visibleText(stringField(record.content) ?? "");
      if (text.length > 0) lines.push({ position, role: "assistant", text });
      return;
    }
    if (includeTools && kind === "tool-call") {
      const name = stringField(entry.name) ?? "tool";
      lines.push({ position, role: "tool", text: name, content: { type: "tool_use", ...entry } });
      return;
    }
    if (includeTools && (kind === "thinking" || kind === "assistant-text" || kind === "tool-result")) {
      const text = stringField(entry.content) ?? stringField(entry.text) ?? JSON.stringify(entry);
      lines.push({ position, role: kind === "tool-result" ? "tool" : "assistant", text,
        content: { type: kind === "thinking" ? "thinking" : kind === "tool-result" ? "tool_result" : "text", ...entry } });
    }
  });
  return lines;
}

export interface TranscriptWindow {
  readonly lines: string[];
  readonly first: number;
  readonly end: number;
  readonly total: number;
  readonly olderBefore?: number;
}

export function readTranscriptWindow(
  source: readonly TranscriptLine[],
  args: { readonly limit?: number | undefined; readonly before?: number | undefined; readonly around?: number | undefined },
): TranscriptWindow {
  const total = source.length;
  const before = args.before;
  let eligible = before === undefined
    ? source
    : source.filter((line) => line.position < before);
  const limit = clampTranscriptLimit(args.limit);
  const around = args.around;
  if (around !== undefined) {
    const match = source.findIndex((line) => line.position >= around);
    const center = match < 0 ? source.length - 1 : match;
    const start = Math.max(0, Math.min(source.length - limit, center - Math.floor(limit / 2)));
    eligible = source.slice(start, start + limit);
  }
  const chosen: TranscriptLine[] = [];
  const lines: string[] = [];
  let bytes = 0;
  for (let index = eligible.length - 1; index >= 0 && chosen.length < limit; index -= 1) {
    const item = eligible[index];
    if (item === undefined) continue;
    const line = serializeTranscriptLine(item);
    const size = Buffer.byteLength(line, "utf8");
    if (lines.length > 0 && bytes + size > TRANSCRIPT_MAX_BYTES) break;
    bytes += size;
    lines.unshift(line);
    chosen.unshift(item);
  }
  const first = chosen[0]?.position ?? 0;
  const end = (chosen[chosen.length - 1]?.position ?? -1) + 1;
  return {
    lines,
    first,
    end,
    total,
    ...(chosen.length > 0 && first > 0 ? { olderBefore: first } : {}),
  };
}

export function serializeTranscriptLine(item: TranscriptLine): string {
  if (item.messageContent !== undefined) return formatSandTranscriptTraceLine({ role: item.role, content: item.messageContent }) ?? "";
  const content = item.content ?? {
    type: item.role === "tool" ? "tool_use" : "text",
    text: truncateMiddle(item.text),
    ...(item.role === "tool" ? { name: item.text } : {}),
  };
  const rendered = JSON.stringify({ position: item.position, role: item.messageContent !== undefined ? item.role : item.role === "tool" ? "assistant" : item.role, message: { content: item.messageContent ?? [content] } });
  return Buffer.byteLength(rendered, "utf8") <= 16_000 ? rendered
    : JSON.stringify({ position: item.position, role: item.role, message: { content: [{ type: "text", text: truncateMiddle(rendered) }] } });
}

export function renderTranscriptRead(args: {
  readonly label: string;
  readonly window: TranscriptWindow;
  readonly spokenOnly: boolean;
}): string {
  const { label, window, spokenOnly } = args;
  if (window.lines.length === 0) {
    return window.total === 0
      ? `No transcript recorded yet for ${label}.`
      : `No readable messages in ${label} before position ${window.end}.`;
  }
  const privacy = spokenOnly
    ? " Only what was said there is shared; that conversation's tool activity stays private."
    : "";
  const paging = window.olderBefore === undefined
    ? "This is the start of the transcript."
    : `Older messages remain: call ${READ_TRANSCRIPT_TOOL_NAME} again with the same target and before=${window.olderBefore}.`;
  return [
    `Transcript of ${label}, ${window.lines.length} shown.${privacy}`,
    ...window.lines,
    paging,
  ].join("\n");
}

export interface TranscriptSearchHit {
  readonly sessionId: string;
  readonly label: string;
  readonly position: number;
  readonly snippet: string;
  readonly score: number;
}

export function searchSpokenLines(
  sessionId: string,
  label: string,
  lines: readonly TranscriptLine[],
  query: string,
): TranscriptSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const hits: TranscriptSearchHit[] = [];
  const words = [...new Set(needle.match(/[\p{L}\p{N}]+/gu) ?? [])];
  for (const line of lines) {
    if (line.role === "tool") continue;
    const text = line.text.toLowerCase();
    const overlap = words.filter((word) => text.includes(word)).length;
    if (overlap === 0 && !text.includes(needle)) continue;
    hits.push({
      sessionId,
      label,
      position: line.position,
      snippet: truncateMiddle(line.text, 240),
      score: overlap || 0.5,
    });
  }
  return hits.sort((a, b) => b.score - a.score || b.position - a.position);
}
