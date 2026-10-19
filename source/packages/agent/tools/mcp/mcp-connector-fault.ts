import { z } from "zod";
import { classifyMcpErrorMessage } from "./mcp-error-classification.js";
import { ToolErrorClassification } from "../core.js";

export type McpConnectorFault =
  | { readonly kind: "rate_limited"; readonly retryAfterMs: number | undefined }
  | { readonly kind: "reauthorize" }
  | { readonly kind: "permanent"; readonly reason: "forbidden" | "not_found" | "unknown_tool" }
  | { readonly kind: "unknown" };

const faultInput = z.object({
  status: z.number().int().optional(),
  code: z.number().int().optional(),
  message: z.string().optional(),
  needsAuth: z.boolean().optional(),
  retryAfter: z.string().optional(),
  retryAfterMs: z.number().finite().nonnegative().optional(),
});

// host-main.cjs:527515-527524: exclude argument/schema errors from unknown-tool detection.
const toolName = "(?:\"[^\"]+\"|'[^']+'|`[^`]+`|(?!(?:arguments?|parameters?|params?|fields?|inputs?|schema|propert(?:y|ies)|names?|values?|options?)(?![a-z0-9_.:/-]))[a-z0-9_.:/-]+)";
const unknownToolPatterns = [
  new RegExp(`(?:^|:\\s*)tool\\s+${toolName}\\s+(?:was\\s+)?not found\\b`, "i"),
  new RegExp(`(?:^|:\\s*)unknown tool(?:\\s*:\\s*|\\s+)${toolName}`, "i"),
  new RegExp(`(?:^|:\\s*)tool\\s+${toolName}\\s+(?:does not|doesn't) exist\\b`, "i"),
  /(?:^|:\s*)no such tool\b/i,
  /method not found:\s*tools\/call/i,
] as const;

// Formal src/shared/parse/retry-after.ts: seconds or HTTP-date, never wait less than requested.
export function parseMcpRetryAfterMs(raw: string | undefined, nowMs = Date.now()): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Number.isFinite(seconds * 1000) ? Math.max(0, Math.round(seconds * 1000)) : undefined;
  const when = Date.parse(trimmed);
  return Number.isFinite(when) ? Math.max(0, when - nowMs) : undefined;
}

/** Normalize transport status/headers into these fields; do not infer status from arbitrary body numbers. */
export function classifyMcpConnectorFault(raw: unknown): McpConnectorFault {
  const parsed = faultInput.safeParse(raw);
  if (!parsed.success) return { kind: "unknown" };
  const input = parsed.data;
  const message = input.message ?? "";
  if (input.needsAuth === true || input.status === 401
      || classifyMcpErrorMessage(message) === ToolErrorClassification.MCP_AUTH_ERROR) {
    return { kind: "reauthorize" };
  }
  if (input.status === 403) return { kind: "permanent", reason: "forbidden" };
  if (input.status === 404) return { kind: "permanent", reason: "not_found" };
  if (input.code === -32601 || /MCP error\s*-32601:/i.test(message)
      || unknownToolPatterns.some(pattern => pattern.test(message))) {
    return { kind: "permanent", reason: "unknown_tool" };
  }
  if (input.status === 429 || /\b(?:rate[ -]limit(?:ed)?|too many requests|ratelimited)\b/i.test(message)) {
    return { kind: "rate_limited", retryAfterMs: input.retryAfterMs ?? parseMcpRetryAfterMs(input.retryAfter) };
  }
  return { kind: "unknown" };
}
