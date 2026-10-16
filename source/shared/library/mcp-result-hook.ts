import { AsyncLocalStorage } from "node:async_hooks";
import type { LibraryExecutionContext } from "../library-contracts.js";
export type LibraryMcpExecution = LibraryExecutionContext & { readonly connectorAccount: string };
const execution = new AsyncLocalStorage<LibraryMcpExecution>();
export function runWithLibraryMcpExecution<T>(context: LibraryMcpExecution, work: () => T): T {
  return execution.run({ ...context, principal: { ...context.principal, teamIds: [...context.principal.teamIds] } }, work);
}
export interface LibraryMcpResult {
  readonly providerIdentifier: string;
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly agentId?: string;
  readonly displayName: string;
  readonly args?: unknown;
  readonly raw: unknown;
}
export type LibraryMcpResultHook = (result: LibraryMcpResult, context: LibraryMcpExecution | undefined) => void;
const hooks = new Set<LibraryMcpResultHook>();
export function registerLibraryMcpResultHook(next: LibraryMcpResultHook | null): () => void {
  if (next === null) { hooks.clear(); return () => undefined; }
  hooks.add(next);
  return () => { hooks.delete(next); };
}
export function notifyLibraryMcpResult(result: LibraryMcpResult): void {
  try {
    for (const hook of hooks) hook(result, execution.getStore());
  } catch {
    void 0;
  }
}

export interface LibraryMcpExecutorArgs {
  readonly providerIdentifier?: string;
  readonly serverIdentifier?: string;
  readonly toolCallId?: string;
}
export interface LibraryMcpExecutor {
  execute(context: unknown, args: LibraryMcpExecutorArgs, options?: { readonly execId?: string }): Promise<unknown>;
}
export interface LibraryMcpCaptureService {
  mainCredential(): string;
  runMcpExecution<T>(args: { readonly credential: string; readonly agentId: string; readonly storeId: string; readonly toolCallId: string; readonly connectorAccount: string }, signal: AbortSignal, work: () => T): Promise<T>;
}
export function captureLibraryMcpExecution<Executor extends LibraryMcpExecutor>(input: {
  readonly service: LibraryMcpCaptureService;
  readonly agentId: string;
  readonly storeId: string;
  readonly connectorAccountOf: (args: LibraryMcpExecutorArgs) => string;
  readonly inner: Executor;
}): Executor {
  return new Proxy(input.inner, {
    get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver);
      return async (context: unknown, args: LibraryMcpExecutorArgs, options?: { readonly execId?: string }): Promise<unknown> => {
        const toolCallId = typeof args.toolCallId === "string" && args.toolCallId.length > 0
          ? args.toolCallId
          : typeof options?.execId === "string" && options.execId.length > 0 ? options.execId : null;
        if (toolCallId === null) return await target.execute(context, args, options);
        return await input.service.runMcpExecution({
          credential: input.service.mainCredential(),
          agentId: input.agentId,
          storeId: input.storeId,
          toolCallId,
          connectorAccount: input.connectorAccountOf(args),
        }, AbortSignal.timeout(120000), async () => await target.execute(context, args, options));
      };
    },
  });
}
