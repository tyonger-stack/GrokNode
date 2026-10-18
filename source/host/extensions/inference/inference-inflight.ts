/**
 * Process-wide cap on concurrent OpenRouter-family model calls.
 *
 * Bot turns are scheduled per-agent (one active run each), so a fan-out of
 * SendToAgent still dials the upstream in parallel. When the Router points at
 * a direct provider (Z.AI, OpenRouter cloud, …) that bypasses the Mac
 * forwarder's queue, those calls hit the vendor together and stall under load.
 * This gate sits inside the openRouter executor so every route — relay or
 * direct — shares one in-process ceiling.
 *
 * Waiting for a slot is healthy queueing, not a wedged turn: the run-idle
 * deadline must suspend for agents listed here (official host bounds provider
 * silence after dial starts; it has no "kill while queued for capacity" rule).
 *
 * Override with SAND_MAX_INFERENCE_INFLIGHT (positive integer). Default 4.
 */

export const DEFAULT_MAX_INFERENCE_INFLIGHT = 4;

type Waiter = {
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  readonly onAbort: () => void;
  readonly agentId?: string;
};

let active = 0;
const waiters: Waiter[] = [];
/** Agents currently parked on acquireInferenceSlot (no upstream dial yet). */
const waitingAgentIds = new Set<string>();

export function resolveMaxInferenceInflight(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SAND_MAX_INFERENCE_INFLIGHT?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_MAX_INFERENCE_INFLIGHT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MAX_INFERENCE_INFLIGHT;
  return parsed;
}

export function getInferenceInflightSnapshot(): {
  readonly active: number;
  readonly waiting: number;
  readonly limit: number;
} {
  return {
    active,
    waiting: waiters.length,
    limit: resolveMaxInferenceInflight(),
  };
}

/** True while this agent's OpenRouter dial is queued behind the global cap. */
export function isAgentWaitingForInferenceSlot(agentId: string): boolean {
  return waitingAgentIds.has(agentId);
}

/** Test / restart seam: drops waiters and clears the counter. */
export function resetInferenceInflightForTests(): void {
  for (const waiter of waiters.splice(0)) {
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    if (waiter.agentId !== undefined) waitingAgentIds.delete(waiter.agentId);
    waiter.reject(new Error("inference inflight reset"));
  }
  waitingAgentIds.clear();
  active = 0;
}

function releaseSlot(): void {
  active = Math.max(0, active - 1);
  pump();
}

function clearWaiterAgent(waiter: Waiter): void {
  if (waiter.agentId !== undefined) waitingAgentIds.delete(waiter.agentId);
}

function pump(): void {
  const limit = resolveMaxInferenceInflight();
  while (active < limit && waiters.length > 0) {
    const next = waiters.shift();
    if (next === undefined) return;
    next.signal?.removeEventListener("abort", next.onAbort);
    clearWaiterAgent(next);
    if (next.signal?.aborted) {
      next.reject(abortError(next.signal));
      continue;
    }
    active += 1;
    next.resolve(releaseSlot);
  }
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error("The inference inflight wait was aborted.");
  error.name = "AbortError";
  return error;
}

export type AcquireInferenceSlotOptions = {
  readonly signal?: AbortSignal;
  /** When set, run-idle deadline suspends for this agent while queued. */
  readonly agentId?: string;
};

/**
 * Acquire one global inference slot. The returned release function is
 * idempotent; call it exactly once when the stream (or failed start) finishes.
 */
export function acquireInferenceSlot(
  signalOrOptions?: AbortSignal | AcquireInferenceSlotOptions,
): Promise<() => void> {
  const options: AcquireInferenceSlotOptions =
    signalOrOptions instanceof AbortSignal
      ? { signal: signalOrOptions }
      : (signalOrOptions ?? {});
  const { signal, agentId } = options;

  if (signal?.aborted) return Promise.reject(abortError(signal));

  const limit = resolveMaxInferenceInflight();
  if (active < limit) {
    active += 1;
    let released = false;
    return Promise.resolve(() => {
      if (released) return;
      released = true;
      releaseSlot();
    });
  }

  return new Promise<() => void>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      clearWaiterAgent(waiter);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError(signal as AbortSignal));
    };
    const waiter: Waiter = {
      resolve: (release) => {
        if (settled) {
          release();
          return;
        }
        settled = true;
        clearWaiterAgent(waiter);
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          release();
        });
      },
      reject: (error) => {
        if (settled) return;
        settled = true;
        clearWaiterAgent(waiter);
        reject(error);
      },
      onAbort,
      ...(signal === undefined ? {} : { signal }),
      ...(agentId === undefined || agentId.length === 0 ? {} : { agentId }),
    };
    if (waiter.agentId !== undefined) waitingAgentIds.add(waiter.agentId);
    waiters.push(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
