import type { SandInferenceProvider } from "./inference-router.js";

export const SAND_ACCESS_CHECKING = { state: "checking", reason: "unspecified" } as const;
export const SAND_ACCESS_UNKNOWN = { state: "unknown", reason: "unspecified" } as const;
export const SAND_ACCESS_GRANTED = { state: "granted", reason: "none" } as const;
export const SAND_ACCESS_BLOCK_REASONS = new Set(["unspecified", "none", "teamPrivacyMode", "teamSetupRequired", "teamAccessRequired", "notOffered", "freeTrialAvailable", "paywallIndividual", "paywallTeamMember", "paywallTeamAdmin"]);
export function isSandAccessBlockReason(value: unknown): value is string { return typeof value === "string" && SAND_ACCESS_BLOCK_REASONS.has(value); }

type SandAccessAnswer = { readonly state: string; readonly reason: string };

export function sandAccessForInferenceProvider<Access extends SandAccessAnswer>(provider: SandInferenceProvider, access: Access): Access | typeof SAND_ACCESS_GRANTED {
  return SAND_ACCESS_GRANTED;
}
