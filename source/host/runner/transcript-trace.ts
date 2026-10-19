import { z } from "zod";
import { stripContextTags } from "../../packages/agent-transcript/context-stripping.js";
import { stripHiddenMarker } from "./conversation-outline.js";

export const SAND_TRANSCRIPT_MAX_PART_CHARS = 4_000;
const preamblePatterns = ["available_subagent_types", "dynamic_tool_catalog", "instructions_update"].map((tag) =>
  new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g"));
const partSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("image") }),
  z.object({ type: z.literal("file"), filename: z.string().optional() }),
  z.object({ type: z.literal("tool-call"), toolCallId: z.string().optional(), toolName: z.string(), args: z.unknown().optional(), input: z.unknown().optional() }),
  z.object({ type: z.literal("tool-result"), toolCallId: z.string().optional(), toolName: z.string(), result: z.unknown().optional(), output: z.unknown().optional() }),
]);
const messageSchema = z.object({ role: z.string(), content: z.union([z.string(), z.array(z.unknown())]).optional(),
  providerOptions: z.object({ cursor: z.object({ isSummary: z.boolean().optional() }).optional() }).optional() });

function boundedText(value: string): string {
  if (value.length <= SAND_TRANSCRIPT_MAX_PART_CHARS) return value;
  const half = Math.floor((SAND_TRANSCRIPT_MAX_PART_CHARS - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(-half)}`;
}

function userText(value: string): string {
  let text = stripContextTags(stripHiddenMarker(value));
  for (const pattern of preamblePatterns) text = text.replace(pattern, "");
  return text.trim();
}

function boundedPayload(value: unknown): unknown {
  if (typeof value === "string") return boundedText(value);
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); }
  catch (error) { if (error instanceof TypeError) return "[unserializable]"; throw error; }
  return serialized === undefined ? null : serialized.length <= SAND_TRANSCRIPT_MAX_PART_CHARS ? value : boundedText(serialized);
}

function tracePart(part: z.infer<typeof partSchema>, role: string): Readonly<Record<string, unknown>> | undefined {
  switch (part.type) {
    case "text": {
      const text = role === "user" ? userText(part.text) : part.text.trim();
      return text.length === 0 ? undefined : { type: "text", text: boundedText(text) };
    }
    case "reasoning": return part.text.trim().length === 0 ? undefined : { type: "thinking", thinking: boundedText(part.text.trim()) };
    case "image": return { type: "text", text: "[Image]" };
    case "file": return { type: "text", text: part.filename === undefined ? "[File]" : `[File: ${part.filename}]` };
    case "tool-call": return { type: "tool_use", ...(part.toolCallId === undefined ? {} : { id: part.toolCallId }), name: part.toolName, input: boundedPayload(part.args ?? part.input ?? {}) };
    case "tool-result": return { type: "tool_result", ...(part.toolCallId === undefined ? {} : { tool_use_id: part.toolCallId }), name: part.toolName, result: boundedPayload(part.result ?? part.output ?? null) };
    default: { const unreachable: never = part; return unreachable; }
  }
}

export function formatSandTranscriptTraceLine(message: unknown, options?: { readonly messagesOnly?: boolean }): string | undefined {
  const parsed = messageSchema.safeParse(message);
  if (!parsed.success || parsed.data.role === "system" || parsed.data.providerOptions?.cursor?.isSummary === true) return undefined;
  const { role, content } = parsed.data;
  const rawParts = typeof content === "string" ? [{ type: "text", text: content }] : content ?? [];
  const parts = rawParts.flatMap((raw) => {
    const part = partSchema.safeParse(raw);
    if (!part.success) return [];
    const value = tracePart(part.data, role);
    return value === undefined || options?.messagesOnly === true && value.type !== "text" ? [] : [value];
  });
  return parts.length === 0 ? undefined : JSON.stringify({ role, message: { content: parts } });
}
