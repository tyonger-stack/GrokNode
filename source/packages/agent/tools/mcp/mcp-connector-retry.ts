import { setTimeout as delay } from "node:timers/promises";
import type { McpConnectorFault } from "./mcp-connector-fault.js";

export type McpConnectorAttempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fault: McpConnectorFault };

export interface McpConnectorRetryOptions {
  readonly signal: AbortSignal;
  readonly maxAttempts?: number;
  readonly fallbackDelayMs?: number;
}

/** Chunk long waits because Node clamps timers above 2^31-1 to 1ms. */
export async function waitForMcpRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError("Invalid MCP retry delay");
  signal.throwIfAborted();
  let remaining = delayMs;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 2_147_483_647);
    await delay(chunk, undefined, { signal });
    remaining -= chunk;
  }
  signal.throwIfAborted();
}

/** Caller must return a confirmed rejection; thrown/ambiguous failures are never replayed.
 * Auth and permanent errors return to the caller for AuthenticateMcpServer or a terminal receipt.
 * No disconnect, repair, permissions, or approval behavior is changed here.
 */
export async function retryMcpRateLimit<T>(
  operation: (signal: AbortSignal) => Promise<McpConnectorAttempt<T>>,
  options: McpConnectorRetryOptions,
): Promise<McpConnectorAttempt<T>> {
  const maxAttempts = options.maxAttempts ?? 2;
  const fallbackDelayMs = options.fallbackDelayMs ?? 1000;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError("Invalid MCP attempt limit");
  if (!Number.isFinite(fallbackDelayMs) || fallbackDelayMs < 0) throw new RangeError("Invalid MCP fallback delay");
  for (let attempt = 1; ; attempt++) {
    options.signal.throwIfAborted();
    const result = await operation(options.signal);
    options.signal.throwIfAborted();
    if (result.ok || attempt >= maxAttempts) return result;
    const fault = result.fault;
    switch (fault.kind) {
      case "rate_limited":
        await waitForMcpRetry(fault.retryAfterMs ?? fallbackDelayMs, options.signal);
        break;
      case "reauthorize":
      case "permanent":
      case "unknown":
        return result;
      default:
        return assertNever(fault);
    }
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected MCP fault: ${String(value)}`);
}
