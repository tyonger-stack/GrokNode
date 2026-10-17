// Local preview park only — not official cloud `Wake computer` (HIBERNATED box).
// Decision 2026-10-17: ship this semantics; do not wire EnsureSandBox wake.

export type ComputerPreviewState = "awake" | "asleep";

export interface ComputerPreviewController {
  readonly getState: (agentId: string) => ComputerPreviewState;
  readonly sleep: (agentId: string) => ComputerPreviewState;
  readonly wake: (agentId: string) => ComputerPreviewState;
}

export function createComputerPreviewController(): ComputerPreviewController {
  const sleepingBots = new Set<string>();
  return {
    getState: agentId => sleepingBots.has(agentId) ? "asleep" : "awake",
    sleep: agentId => {
      sleepingBots.add(agentId);
      return "asleep";
    },
    wake: agentId => {
      sleepingBots.delete(agentId);
      return "awake";
    },
  };
}
