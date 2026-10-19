import { z } from "zod";
import { Ajv } from "ajv";
import { createContext } from "../packages/context/core.js";
import { classifyConnectorFailure } from "../packages/agent/tools/mcp/mcp-connector-failure.js";
import { retryMcpRateLimit } from "../packages/agent/tools/mcp/mcp-connector-retry.js";
import { buildDraftCallArgs, parseDraftCallResult, type DraftExecute } from "./runner/tools/draft-connector.js";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const toolsSchema = z.array(z.object({ providerIdentifier: z.string(), toolName: z.string(), name: z.string(), inputSchema: z.unknown().optional() }));
const authSchema = z.object({ serverId: z.string(), serverName: z.string() });
const rejectedControl = z.object({ result: z.object({ case: z.enum(["toolNotFound", "serverNotFound", "permissionDenied", "rejected", "approved"]) }) });
export interface ReviewMcpBinding {
  listTools(): Promise<unknown>;
  execute(args: ReturnType<typeof buildDraftCallArgs>, context: ReturnType<typeof createContext>): Promise<unknown>;
  needsAuth(providerIdentifier: string): Promise<unknown>;
}

export function bindReviewMcp(value: unknown, agentId: string): ReviewMcpBinding | null {
  if (!record(value) || typeof value.createExecutor !== "function" || typeof value.getTools !== "function") return null;
  const create = value.createExecutor.bind(value), list = value.getTools.bind(value);
  const auth = typeof value.resolveNeedsAuthSlot === "function" ? value.resolveNeedsAuthSlot.bind(value) : undefined;
  return {
    listTools: async () => {
      const [context, cancel] = createContext().withName("review-discovery").withTimeoutAndCancel(20_000);
      try { return await list(context); } finally { cancel(); }
    },
    needsAuth: async id => auth === undefined ? null : auth(id),
    async execute(args, context) {
      const executor: unknown = create(undefined, undefined, { agentId });
      if (!record(executor) || typeof executor.execute !== "function") throw new TypeError("Review MCP executor is unavailable");
      return executor.execute(context, args);
    },
  };
}

export function createReviewDraftExecute(binding: ReviewMcpBinding | null, options: {
  readonly onNeedsAuth?: (account: { readonly serverId: string; readonly serverName: string }) => Promise<void>;
} = {}): DraftExecute {
  const validator = new Ajv({ strict: false, allErrors: false });
  const authCards = new Set<string>();
  return async call => {
    if (binding === null) return { outcome: "failed", error: "Connector execution is unavailable. Connect an account and try again." };
    const [context, cancel] = createContext().withName("review-draft").withTimeoutAndCancel(60_000);
    const aborted = () => cancel();
    call.signal?.addEventListener("abort", aborted, { once: true });
    try {
      if (call.signal?.aborted) return { outcome: "unconfirmed" };
      const auth = authSchema.safeParse(await binding.needsAuth(call.providerIdentifier));
      if (auth.success) {
        if (!authCards.has(call.providerIdentifier)) {
          await options.onNeedsAuth?.(auth.data);
          authCards.add(call.providerIdentifier);
        }
        return { outcome: "needs-auth", ...auth.data };
      }
      authCards.delete(call.providerIdentifier);
      const discovered = toolsSchema.safeParse(await binding.listTools());
      if (!discovered.success) return { outcome: "failed", error: "Connector tool discovery failed. Reconnect the account before trying again." };
      const tool = discovered.data.find(tool => tool.providerIdentifier === call.providerIdentifier && tool.toolName === call.toolName);
      if (tool === undefined) return { outcome: "failed", error: "The connected account does not provide the required tool. Nothing was sent." };
      if (record(tool.inputSchema)) {
        const validate = validator.compile(tool.inputSchema);
        if (!validate(call.args)) return { outcome: "failed", error: "The connector's current input schema does not support this draft. Nothing was sent." };
      }
      const args = buildDraftCallArgs(call);
      args.name = tool.name;
      context.signal.throwIfAborted();
      const attempt = await retryMcpRateLimit(async () => {
        const raw = await binding.execute(args, context);
        const fault = classifyConnectorFailure(raw);
        const parsed = parseDraftCallResult(raw);
        const value = parsed.outcome === "failed" && fault.kind === "unknown" && !rejectedControl.safeParse(raw).success
          ? { outcome: "unconfirmed" as const } : parsed;
        return fault.kind === "rate_limited" ? { ok: false, fault } : { ok: true, value };
      }, { signal: context.signal, maxAttempts: 2 });
      if (!attempt.ok) return { outcome: "failed", error: "The account is rate limited. Wait before trying this draft again." };
      const result = attempt.value;
      return result;
    } catch (error) {
      if (error instanceof Error) return { outcome: "unconfirmed" };
      throw error;
    } finally {
      call.signal?.removeEventListener("abort", aborted);
      cancel();
    }
  };
}
