/**
 * Late-bound reader for the bot-color-in-chat (强调色 = Bot 颜色) feature gate, so the
 * settings extension can enforce upstream's server-side admission without depending on
 * the experiments extension. Same shape and same cycle-breaking rationale as
 * main-agent-gate.ts: `experiments` already depends on `settings`, so a static
 * dependency in this direction would be a cycle, and the gate is only ever read at call
 * time, long after both extensions have started.
 *
 * Unregistered means "gate unknown". Callers must treat that as NOT enabled: upstream's
 * documented default is off, and a build that never registered a gate reader must not
 * silently admit bot-color writes.
 */

import { GROK_BOT_ALL_BOTS_COLOR_THEMING_GATE } from "../../../shared/node/grok-bot-bot-color.js";

type GateReader = (name: string) => boolean;

let pinnedGateReader: GateReader | null = null;

/** Called by the experiments extension once its service exists. */
export function pinGrokBotBotColorGateReader(reader: GateReader | null): void {
  pinnedGateReader = reader;
}

/** True only when the host's own feature-gate service says the bot-color gate is on. */
export function isGrokBotBotColorThemingEnabled(): boolean {
  return pinnedGateReader?.(GROK_BOT_ALL_BOTS_COLOR_THEMING_GATE) === true;
}
