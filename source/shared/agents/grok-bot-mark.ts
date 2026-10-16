/**
 * Official 0.71.2 mark (avatar shape/color) catalogs — carved from
 * `box/sand-host/host-main.cjs` (`GROK_BOT_MARK_SHAPES` / `GROK_BOT_COLORS`).
 * Used by `update_state` profile.set so the bot can change its own mark.
 */

export const GROK_BOT_MARK_SHAPES = [
  "blob",
  "pebble",
  "bean",
  "egg",
  "squircle",
  "tablet",
  "capsule",
  "cylinder",
  "hex",
  "gem",
  "crystal",
  "wedge",
  "shield",
  "dome",
  "arch",
  "cloud",
  "teardrop",
  "leaf",
  "square",
  "sparkle",
  "clover",
  "flower",
  "heart",
  "house",
  "star",
] as const;

export type GrokBotMarkShape = (typeof GROK_BOT_MARK_SHAPES)[number];

/** Color ids from official `GROK_BOT_COLORS` (value/label omitted — host only needs ids). */
export const GROK_BOT_MARK_COLORS = [
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "magenta",
  "gray",
] as const;

export type GrokBotMarkColor = (typeof GROK_BOT_MARK_COLORS)[number];

export function isGrokBotMarkShape(value: string): value is GrokBotMarkShape {
  return (GROK_BOT_MARK_SHAPES as readonly string[]).includes(value);
}

export function isGrokBotMarkColor(value: string): value is GrokBotMarkColor {
  return (GROK_BOT_MARK_COLORS as readonly string[]).includes(value);
}
