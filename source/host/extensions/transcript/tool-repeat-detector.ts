/** Loop-suspect detector for tool-call streams: counts identical tool+arguments
 * signatures per session within a turn and fires exactly when the count lands
 * on a threshold. Observes only - never interrupts. Mirrors OpenMausBot's
 * RepeatDetector (thresholds 5/10/20): a pathological turn burning money on
 * the same call gets noticed instead of running silently.
 */
export interface LoopSuspect {
  readonly count: number;
  readonly threshold: number;
}

export const LOOP_SUSPECT_THRESHOLDS = [5, 10, 20] as const;

export function toolRepeatKey(
  toolName: string | undefined,
  args: unknown,
): string | null {
  if (toolName == null || toolName === "") return null;
  let serialized: string;
  try {
    serialized =
      typeof args === "string" ? args : JSON.stringify(args ?? null);
  } catch {
    serialized = String(args);
  }
  const normalized = serialized.replace(/\s+/g, " ").trim();
  if (normalized === "" || normalized === "null" || normalized === toolName)
    return null;
  return `${toolName}:${normalized}`;
}

export class ToolRepeatDetector {
  private readonly counts = new Map<string, Map<string, number>>();
  private readonly maxKeysPerSession: number;

  constructor(maxKeysPerSession = 256) {
    this.maxKeysPerSession = Math.max(1, Math.floor(maxKeysPerSession));
  }

  /** Count one completed tool call for a session. Returns the suspect hit,
   * or undefined when below threshold. */
  record(
    sessionId: string,
    toolName: string | undefined,
    args: unknown,
  ): LoopSuspect | undefined {
    const key = toolRepeatKey(toolName, args);
    if (key == null) return undefined;
    let perSession = this.counts.get(sessionId);
    if (perSession == null) {
      perSession = new Map();
      this.counts.set(sessionId, perSession);
    }
    const previous = perSession.get(key);
    // Bounded recency set: existing keys move to the back so one long turn
    // cannot grow the server unboundedly.
    if (previous !== undefined) perSession.delete(key);
    else if (perSession.size >= this.maxKeysPerSession)
      perSession.delete(perSession.keys().next().value!);
    const count = (previous ?? 0) + 1;
    perSession.set(key, count);
    return (LOOP_SUSPECT_THRESHOLDS as readonly number[]).includes(count)
      ? { count, threshold: count }
      : undefined;
  }

  /** The turn settled: counts reset for the next turn. */
  settle(sessionId: string): void {
    this.counts.delete(sessionId);
  }
}
