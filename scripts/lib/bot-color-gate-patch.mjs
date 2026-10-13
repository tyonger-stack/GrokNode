// Register the Grok Bot "bot color in chat" (设置 → 通用 → 强调色 = Bot 颜色) feature gate
// in the bundled FLAGS table, at the value the Statsig backend is CURRENTLY serving for
// this account.
//
// Evidence (byte-sourced 2026-10-12 from the official Grok Bot 0.70.2 app asar on this
// machine; full offsets in the sibling investigation report 强调色对话渲染机制-0702.md):
//
//   * The gate exists upstream as `grok_bot_all_bots_color_theming` with
//     `{client: true, default: false}` in the official host bundle's registry, next to
//     `sand_enable_accent_theming` (the older "branded" tinting mode, which this port
//     deliberately does not ship — the dropdown's current behaviour is the botTint mode).
//   * It is NOT in this build's experiment-config.gen.ts, which is a frozen 0.18 recovery
//     artifact that cannot be regenerated here. Same situation, and same remedy, as
//     grok-main-agent-gate-patch.mjs: insert the entry into the BUNDLED table at package
//     time, byte-anchored, with the evidence written down here.
//   * Why `true` and not upstream's `default: false`: same reasoning the main-agent gate
//     patch records — this build can never receive a server-assigned gate value (the local
//     statsig stub freezes to {}), so every gate read lands on the bundled default.
//     The official app on this account currently serves the gate ON, observed directly on
//     2026-10-12 via CDP: the transcript scroll container of a violet-bot 1:1 chat carries
//     the botTint inline overrides (`--sand-transcript-bubble-user-fill:
//     var(--sand-fill-purple-bubble-user)`), which the renderer only emits when
//     grok_bot_all_bots_color_theming is true AND the account preference is enabled.
//
// Insertion, not mutation: the gate name is ABSENT from the 0.18 table, so there is no
// `default: false` line to flip. The patch appends one entry next to a unique existing
// neighbour and fails closed when the neighbour is missing or already ambiguous.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Real neighbouring entries in the 0.18 bundled FLAGS table, used as insertion points.
// Anchors are FULL table entries verified against the pristine src/app/dist host bundle,
// so a drifted bundle cannot match by accident. Ordered by preference; the caller counts
// occurrences and fails closed when the chosen one is not unique.
const ANCHOR_CANDIDATES = [
  "  sand_get_grok_bot_ios: {\n    client: true,\n    default: false\n  },",
  "  sand_usage_page: {\n    client: true,\n    default: false\n  },",
  "  sand_multitask: {\n    client: true,\n    default: true\n  },",
];
const INSERT = `  // Bot color in chat (设置 → 通用 → 强调色 = Bot 颜色). Ported from the official
  // client; see source/shared/node/grok-bot-bot-color.ts for the full evidence trail.
  // Upstream's own registry entry reads { client: true, default: false }; the default is
  // recorded as true here because this build's statsig stub can never deliver the
  // server-side rollout state, and the backend currently serves ON for this account
  // (2026-10-12, observed via the official app's emitted botTint overrides).
  grok_bot_all_bots_color_theming: {
    client: true,
    default: true
  },
`;

/**
 * Picks a real neighbour in the bundled table and inserts the entry before it.
 * Kept in one function so the test can drive it against a fixture rather than a 29 MB bundle.
 */
export function insertBotColorGate(source, pickAnchor = defaultAnchorPicker) {
  if (source.includes("grok_bot_all_bots_color_theming: {")) {
    return { text: source, applied: false, reason: "already-present" };
  }
  const anchor = pickAnchor(source);
  if (anchor == null) return { text: source, applied: false, reason: "anchor-missing" };
  const occurrences = source.split(anchor.text).length - 1;
  if (occurrences !== 1) return { text: source, applied: false, reason: `anchor-ambiguous:${occurrences}` };
  return { text: source.replace(anchor.text, INSERT + anchor.text), applied: true, reason: "inserted", anchor };
}

// Uniqueness is NOT decided here — the caller counts occurrences so that an ambiguous
// neighbour is reported as ambiguous, not as missing.
function defaultAnchorPicker(source) {
  for (const candidate of ANCHOR_CANDIDATES) {
    if (source.includes(candidate)) return { text: candidate };
  }
  return null;
}

export const BOT_COLOR_GATE_NAME = "grok_bot_all_bots_color_theming";

export async function applyBotColorGatePatch({ stageRoot }) {
  const hostBundle = path.join(stageRoot, "dist", "host", "host-main.cjs");
  let source;
  try {
    source = await readFile(hostBundle, "utf8");
  } catch (error) {
    console.log(`Bot-color gate: skipped (${path.relative(stageRoot, hostBundle)} unreadable: ${String(error)})`);
    return { mode: "bot-color-gate", applied: false, reason: "host-bundle-unreadable" };
  }
  const result = insertBotColorGate(source);
  if (!result.applied) {
    console.log(`Bot-color gate: skipped (${result.reason})`);
    return { mode: "bot-color-gate", applied: false, reason: result.reason, gates: [BOT_COLOR_GATE_NAME] };
  }
  await writeFile(hostBundle, result.text);
  const patchedHash = createHash("sha256").update(result.text).digest("hex");
  console.log(`Bot-color gate: inserted ${BOT_COLOR_GATE_NAME} (default true) into the bundled FLAGS table`);
  const provenancePath = path.join(stageRoot, "dist", "bot-color-gate-extension.json");
  await writeFile(provenancePath, `${JSON.stringify({ mode: "bot-color-gate", gates: [BOT_COLOR_GATE_NAME], default: true, anchor: result.anchor?.text ?? null, patchedSha256: patchedHash }, null, 2)}\n`);
  return { mode: "bot-color-gate", applied: true, gates: [BOT_COLOR_GATE_NAME], patchedSha256: patchedHash, provenancePath };
}
