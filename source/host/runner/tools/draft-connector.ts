import { randomUUID } from "node:crypto";
import { Value, type JsonValue } from "@bufbuild/protobuf";
import { z } from "zod";
import { McpArgs } from "../../../packages/proto/generated/agent/v1/mcp_exec_pb.js";

export interface DraftCall {
  readonly providerIdentifier: string;
  readonly toolName: string;
  readonly args: Record<string, JsonValue>;
  readonly signal?: AbortSignal;
}
export type DraftCallOutcome =
  | { readonly outcome: "sent"; readonly resultText: string }
  | { readonly outcome: "failed"; readonly error: string }
  | { readonly outcome: "needs-auth"; readonly serverId: string; readonly serverName: string }
  | { readonly outcome: "unconfirmed" };
export type DraftExecute = (call: DraftCall) => Promise<DraftCallOutcome>;
export function buildDraftCallArgs(call: DraftCall): McpArgs {
  return new McpArgs({ name: `${call.providerIdentifier}-${call.toolName}`, providerIdentifier: call.providerIdentifier,
    toolName: call.toolName, toolCallId: `sand-draft-${randomUUID()}`,
    args: Object.fromEntries(Object.entries(call.args).map(([key, value]) => [key, Value.fromJson(value)])) });
}
const textItem = z.object({ content: z.object({ case: z.string().optional(), value: z.object({ text: z.string().optional() }).passthrough().optional() }) });
const envelope = z.object({ result: z.object({ case: z.string().optional(), value: z.unknown().optional() }) });
const success = z.object({ isError: z.boolean(), content: z.array(textItem) });
const failure = z.object({ error: z.string().optional(), reason: z.string().optional() });
export function parseDraftCallResult(result: unknown): DraftCallOutcome {
  const parsed = envelope.safeParse(result);
  if (!parsed.success) return { outcome: "unconfirmed" };
  const inner = parsed.data.result;
  if (inner.case === "success") {
    const data = success.safeParse(inner.value);
    if (!data.success) return { outcome: "unconfirmed" };
    const resultText = data.data.content.filter(item => item.content.case === "text").map(item => item.content.value?.text ?? "").join(" ").trim();
    return data.data.isError ? { outcome: "failed", error: resultText || "The connector reported a tool error." } : { outcome: "sent", resultText };
  }
  const detail = failure.safeParse(inner.value);
  const errors: Readonly<Record<string, string>> = { toolNotFound: "The connector does not offer this tool.", serverNotFound: "The connector is not installed or connected.", permissionDenied: "The connector denied permission.", approved: "The call was approved but never executed.", rejected: "The call was rejected.", error: "The connector failed." };
  const message = inner.case == null ? undefined : errors[inner.case];
  return message == null ? { outcome: "unconfirmed" } : { outcome: "failed", error: detail.success ? detail.data.error || detail.data.reason || message : message };
}
export function parseDraftConnectorRecord(text: string): Record<string, unknown> | null {
  try {
    const result = z.record(z.unknown()).safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
export function unreachable(value: never): never { throw new TypeError(`Unexpected draft variant: ${String(value)}`); }

export async function executeDraftWithDeadline(execute: DraftExecute, call: DraftCall, timeoutMs = 60_000): Promise<DraftCallOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DraftCallOutcome>(resolve => {
    timer = setTimeout(() => { resolve({ outcome: "unconfirmed" }); controller.abort(); }, timeoutMs);
  });
  try { return await Promise.race([execute({ ...call, signal: call.signal == null ? controller.signal : AbortSignal.any([call.signal, controller.signal]) }), timeout]); }
  catch (error) { if (error instanceof Error) return { outcome: "unconfirmed" }; throw error; }
  finally { clearTimeout(timer); }
}
