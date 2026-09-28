export const SAND_INFERENCE_PROVIDERS = ["codex", "openrouter"] as const;
export type SandInferenceProvider = (typeof SAND_INFERENCE_PROVIDERS)[number];

export interface SandInferenceRouterUsageProvider {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly lastUsedAt: string | null;
  // Last observed quota-exhaustion for this provider (null when never seen).
  // Written by the failure path only; never touched by the success counter,
  // so a quota event stays visible until the next one overwrites it.
  readonly quotaExhaustedAt: string | null;
  readonly quotaExhaustedModel: string | null;
}

export interface SandInferenceRouterUsage {
  readonly schemaVersion: 1;
  readonly providers: Record<SandInferenceProvider, SandInferenceRouterUsageProvider>;
}

export function isSandInferenceProvider(value: unknown): value is SandInferenceProvider {
  return typeof value === "string" && (SAND_INFERENCE_PROVIDERS as readonly string[]).includes(value);
}

export function emptySandInferenceRouterUsage(): SandInferenceRouterUsage {
  const empty = (): SandInferenceRouterUsageProvider => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastUsedAt: null, quotaExhaustedAt: null, quotaExhaustedModel: null });
  return { schemaVersion: 1, providers: { codex: empty(), openrouter: empty() } };
}
