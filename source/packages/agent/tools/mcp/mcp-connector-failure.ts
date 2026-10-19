import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { classifyMcpConnectorFault, type McpConnectorFault } from "./mcp-connector-fault.js";

const errorEnvelope = z.object({ result: z.object({ case: z.literal("error"), value: z.object({ error: z.string() }) }) });
const toolError = z.object({ isError: z.literal(true), content: z.array(z.unknown()) });
const textItem = z.union([
  z.object({ type: z.literal("text"), text: z.string() }).transform(item => item.text),
  z.object({ content: z.object({ case: z.literal("text"), value: z.object({ text: z.string() }) }) }).transform(item => item.content.value.text),
  z.object({ text: z.object({ text: z.string() }) }).transform(item => item.text.text),
]);
const successEnvelope = z.object({ result: z.object({ case: z.literal("success"), value: toolError }) });
const messageError = z.object({ error: z.string() }).passthrough();
const connectStatus = new Map<number, number>([[Code.Unauthenticated, 401], [Code.PermissionDenied, 403], [Code.NotFound, 404]]);
const safeEnvelope = z.object({
  type: z.literal("mcp-connector-failure"), version: z.literal(1),
  fault: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("rate_limited"), retryAfterMs: z.number().finite().nonnegative().optional() }),
    z.object({ kind: z.literal("reauthorize") }),
    z.object({ kind: z.literal("permanent"), reason: z.enum(["forbidden", "not_found", "unknown_tool"]) }),
  ]),
});

function classifyFailureText(message: string): McpConnectorFault {
  if (message.trimStart().startsWith("{")) {
    try {
      const parsed = safeEnvelope.safeParse(JSON.parse(message));
      if (parsed.success) {
        const fault = parsed.data.fault;
        return fault.kind === "rate_limited" ? { kind: "rate_limited", retryAfterMs: fault.retryAfterMs } : fault;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return classifyMcpConnectorFault({ message });
}

export function serializeConnectorFailure(value: unknown): string | undefined {
  if (!(value instanceof ConnectError)) return undefined;
  const fault = classifyConnectorFailure(value);
  if (fault.kind === "unknown") return undefined;
  return JSON.stringify({ type: "mcp-connector-failure", version: 1,
    connectCode: value.code, status: connectStatus.get(value.code) ?? (fault.kind === "rate_limited" ? 429 : undefined), fault });
}

export function classifyConnectorFailure(value: unknown): McpConnectorFault {
  if (value instanceof ConnectError) {
    if (value.code === Code.Canceled || value.code === Code.DeadlineExceeded) return { kind: "unknown" };
    const retryAfter = value.metadata.get("retry-after") ?? undefined;
    return classifyMcpConnectorFault({
      status: connectStatus.get(value.code) ?? (value.code === Code.ResourceExhausted && retryAfter !== undefined ? 429 : undefined),
      message: value.rawMessage,
      retryAfter,
    });
  }
  if (typeof value === "string") return classifyFailureText(value);
  const envelope = errorEnvelope.safeParse(value);
  if (envelope.success) return classifyFailureText(envelope.data.result.value.error);
  const success = successEnvelope.safeParse(value);
  const direct = toolError.safeParse(value);
  const content = success.success ? success.data.result.value : direct.success ? direct.data : undefined;
  if (content !== undefined) {
    const texts = content.content.flatMap(item => {
      const parsed = textItem.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    for (const text of texts) {
      const fault = classifyFailureText(text);
      if (fault.kind !== "unknown") return fault;
    }
    return { kind: "unknown" };
  }
  const error = messageError.safeParse(value);
  if (error.success) {
    const fault = classifyFailureText(error.data.error);
    return fault.kind === "rate_limited" && fault.retryAfterMs === undefined
      ? classifyMcpConnectorFault({ ...error.data, message: error.data.error }) : fault;
  }
  return classifyMcpConnectorFault(value);
}
