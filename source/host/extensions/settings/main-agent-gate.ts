/**
 * Late-bound reader for the main-bot feature gate, so the settings extension can enforce
 * upstream's server-side admission without depending on the experiments extension.
 *
 * Why late binding: `experiments` already depends on `settings` (it needs the feature-flag
 * override channel), so a static `dependencies: [Experiments]` on the settings side would
 * be a cycle. The gate is only ever read at call time, long after both extensions have
 * started, so a registration hook is both sufficient and cycle-free. Same idiom as
 * `host-diagnostics.ts`'s pinned reporter.
 *
 * Unregistered means "gate unknown". Callers must treat that as NOT enabled: upstream's
 * documented default is off, and a build that never registered a gate reader must not
 * silently start admitting main-bot writes.
 */

import { GROK_BOT_MAIN_AGENT_GATE } from "../../../shared/node/grok-bot-main-agent.js";

type GateReader = (name: string) => boolean;

let pinnedGateReader: GateReader | null = null;

/** Called by the experiments extension once its service exists. */
export function pinGrokBotMainAgentGateReader(reader: GateReader | null): void {
  pinnedGateReader = reader;
}

/** True only when the host's own feature-gate service says the main-bot gate is on. */
export function isGrokBotMainAgentEnabled(): boolean {
  return pinnedGateReader?.(GROK_BOT_MAIN_AGENT_GATE) === true;
}
