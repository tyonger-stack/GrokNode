/**
 * Grok Bot "bot color in chat" (设置 → 通用 → 强调色 = Bot 颜色) contract — ported from
 * the official client, dimension-reduced onto this build's flat 0.18 token surface.
 *
 * Evidence (byte-sourced 2026-10-12 from the official Grok Bot 0.70.2 app asar;
 * see the sibling investigation report for full offsets):
 *
 *   * The setting is a two-value dropdown, `black` | `bot-color` (chunk-view settings
 *     table `ga={black:{id:"THokF3"},"bot-color":{id:"p7v5PZ"}}`), whose onValueChange
 *     collapses the UI enum to a BOOLEAN: setEnabled(U === "bot-color"). The stored slice
 *     is `botColorInChat` (desktop settings namespace, next to theme/language), persisted
 *     host-side through appWindow.setBotColorInChatEnabled({enabled:boolean}) with the
 *     audit tag "bot-color-in-chat".
 *   * The effective value is the official three-state rule rqe/Tde:
 *         isBotTintEnabled = gate && (preference ?? gate)
 *     i.e. an unset preference follows the gate's default; an explicit preference wins
 *     over the gate default but the gate can still force the whole feature off.
 *   * The write path is gate-gated, the read path is not — the same split this port
 *     already applies to mainAgentId (grok-bot-main-agent.ts).
 *   * Per-bot eligibility (official renderer `ar()`): groups are never tinted, bots with
 *     a custom avatar are never tinted (treated as "gray"), and black/gray hues have no
 *     tint variants at all ("or keep them black"). violet is normalized to purple.
 *
 * Dimension reduction (this port): upstream 0.70.2 implements tinting as a three-layer
 * token redirect (hue value tokens → semantic `accent`-prefixed tokens → inline container
 * overrides). The 0.18 baseline predates that entire system (0 hits for
 * --sand-bg-accent-* / --sand-transcript-bubble-user-fill), but its components already
 * consume flat tokens that cover the same surfaces (--sand-fill-bubble-user for user
 * bubbles, --sand-fill-accent / --sand-text-accent / --sand-border-accent for buttons
 * and focus states). The renderer pass therefore re-defines those flat tokens on the
 * transcript, composer, and info-pane containers at runtime, scoped exactly like the
 * official inline overrides. No component code changes.
 */

/** Upstream's own gate name; registered in the bundled FLAGS table by scripts/lib/bot-color-gate-patch.mjs. */
export const GROK_BOT_ALL_BOTS_COLOR_THEMING_GATE = "grok_bot_all_bots_color_theming";

/** Thrown by the settings service when a bot-color write arrives while the gate is off. */
export class GrokBotBotColorRefusedError extends Error {
  constructor() {
    super("The bot-color feature is not enabled for this build, so the accent setting cannot be changed.");
    this.name = "GrokBotBotColorRefusedError";
  }
}

/** The persisted preference. `undefined` follows the gate default (official `preference ?? isDefaultOn`). */
export type BotColorInChatPreference = boolean | undefined;

/** The official three-state rule, hoisted here so host and tests share one implementation. */
export function resolveBotColorInChatEnabled(preference: BotColorInChatPreference, isGateOn: boolean): boolean {
  return isGateOn && (preference ?? true);
}
