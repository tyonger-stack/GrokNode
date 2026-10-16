import { z } from "zod";

export type SuccessfulMcpResult = {
  readonly isError: boolean;
  readonly texts: readonly string[];
  readonly structured: Readonly<Record<string, unknown>> | null;
};

const successSchema = z.object({
  result: z.object({
    case: z.literal("success"),
    value: z.object({
      content: z.array(z.unknown()),
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface StructMessage {
  readonly fields: Record<string, unknown>;
  toJson(): unknown;
}

function isStructMessage(value: unknown): value is StructMessage {
  return isRecord(value) && isRecord(value.fields) && typeof value.toJson === "function";
}

function textFromContentItem(item: unknown): string | null {
  if (!isRecord(item)) return null;
  if (item.type === "text" && typeof item.text === "string") return item.text;
  const content = item.content;
  if (!isRecord(content) || content.case !== "text") return null;
  const value = content.value;
  return isRecord(value) && typeof value.text === "string" ? value.text : null;
}

function structuredRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (isStructMessage(value)) {
    const json = value.toJson();
    return isRecord(json) ? json : null;
  }
  return isRecord(value) ? value : null;
}

export function parseSuccessfulMcpResult(input: unknown): SuccessfulMcpResult | null {
  const parsed = successSchema.safeParse(input);
  if (!parsed.success) return null;
  const value = parsed.data.result.value;
  return {
    isError: value.isError === true,
    texts: value.content.flatMap(item => {
      const text = textFromContentItem(item);
      return text === null ? [] : [text];
    }),
    structured: value.structuredContent === undefined ? null : structuredRecord(value.structuredContent),
  };
}

const URL_PATTERN = /https:\/\/[^\s<>"']+/gi;

export function extractResultUrls(result: SuccessfulMcpResult): readonly string[] {
  const structured = result.structured === null ? "" : JSON.stringify(result.structured);
  const source = [...result.texts, structured].join("\n");
  return [...source.matchAll(URL_PATTERN)].map(match => match[0].replace(/[.,;!]+$/, ""));
}
