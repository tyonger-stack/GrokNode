import type { McpConnectorFault } from "./mcp-connector-fault.js";
import { waitForMcpRetry } from "./mcp-connector-retry.js";

export interface ConnectorRateLimitWaiter {
  defer(providerIdentifier: string, fault: McpConnectorFault): void;
  wait(providerIdentifier: string, signal: AbortSignal): Promise<void>;
}

export function createConnectorRateLimitWaiter(): ConnectorRateLimitWaiter {
  const untilByAccount = new Map<string, number>();
  return {
    defer(providerIdentifier, fault) {
      if (fault.kind !== "rate_limited" || fault.retryAfterMs === undefined) return;
      const deadline = Date.now() + fault.retryAfterMs;
      untilByAccount.set(providerIdentifier, Math.max(untilByAccount.get(providerIdentifier) ?? 0, deadline));
    },
    async wait(providerIdentifier, signal) {
      signal.throwIfAborted();
      for (;;) {
        const deadline = untilByAccount.get(providerIdentifier);
        if (deadline === undefined) return;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          untilByAccount.delete(providerIdentifier);
          return;
        }
        await waitForMcpRetry(remaining, signal);
      }
    },
  };
}
