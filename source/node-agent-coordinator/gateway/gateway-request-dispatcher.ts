import { COORDINATOR_UNKNOWN_METHOD, type CoordinatorReplyOutcome } from "../../shared/rpc/coordinator-port.js";
import { isCoordinatorMethod, validateCoordinatorReply } from "../../shared/rpc/coordinator.js";
import { SandGatewayCommandError } from "./gateway-errors.js";
import { SandGatewayUnreachableError } from "./gateway-reachability.js";

export const GATEWAY_COMMAND_FAILED = "gateway-command-failed";
export const GATEWAY_UNREACHABLE = "gateway-unreachable";
export const GATEWAY_TRANSPORT_FAILED = "gateway-transport-failed";

export function failureFor(error: unknown): { code: string; message: string; transportKind?: string } {
  if (error instanceof SandGatewayCommandError) return { code: GATEWAY_COMMAND_FAILED, message: error.message };
  if (error instanceof SandGatewayUnreachableError) return { code: GATEWAY_UNREACHABLE, message: error.message, transportKind: error.kind };
  return { code: GATEWAY_TRANSPORT_FAILED, message: error instanceof Error ? error.message : String(error) };
}

export interface GatewayCommandClient {
  dispatchCommand(method: string, args: unknown, options: { signal?: AbortSignal }): Promise<unknown>;
}

/**
 * Side effect run after a command succeeds, used to keep desktop-side mirrors of box state
 * (see roster-avatar-store). It must never change the reply, so its failures are swallowed
 * rather than surfaced: a mirror that cannot be written is not the caller's problem.
 */
export type GatewayCommandObserver = (method: string, args: unknown) => void | Promise<void>;

export function createGatewayRequestDispatch(client: GatewayCommandClient, serves: (method: string) => boolean = isCoordinatorMethod, observe?: GatewayCommandObserver) {
  return async (method: string, args: unknown, signal?: AbortSignal): Promise<CoordinatorReplyOutcome> => {
    if (!serves(method)) return { status: "failed", failure: { code: COORDINATOR_UNKNOWN_METHOD, message: `no coordinator method named ${method}` } };
    try {
      const value = validateCoordinatorReply(method, await client.dispatchCommand(method, args, { ...(signal === undefined ? {} : { signal }) }));
      if (observe != null) { try { await observe(method, args); } catch { /* mirror is best-effort */ } }
      return { status: "ok", value };
    } catch (error) {
      return { status: "failed", failure: failureFor(error) };
    }
  };
}
