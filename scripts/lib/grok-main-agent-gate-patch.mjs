// Register the two Grok Bot "main agent" (主 Bot) feature gates in the bundled FLAGS
// table, at the value the Statsig backend is CURRENTLY serving for this account.
//
// Evidence (byte-sourced 2026-10-02 from the official Grok Bot app on this machine —
// 0.63.0 and the currently installed 0.66.0 — plus the host bundle that app actually runs,
// /opt/sand/sand-host/host-main.cjs):
//
//   * Both gates exist upstream with the comments quoted in
//     source/shared/node/grok-bot-main-agent.ts, and both are still present in 0.66.0
//     (renderer assets + electron-main + host bundle). They are NOT in this build's
//     experiment-config.gen.ts, which is a frozen 0.18 recovery artifact whose header says
//     "Do not hand-edit registry values; regenerate them from the immutable evidence
//     artifact" — and scripts/recover-experiment-config.mjs is not in the repo, so
//     regeneration is not available. Same situation, and same remedy, as
//     teach-gate-restore-patch.mjs: patch the BUNDLED table at package time, byte-anchored,
//     with the evidence written down here.
//
//   * Why `true` and not upstream's `default: false`: upstream's default is the *off*
//     default for a fresh account, but this build can never receive a server-assigned gate
//     value — electron main ships createElectronProductionExperimentsBinding(), a local-only
//     stub whose snapshot is Object.freeze({}), so every renderer-side gate reads `?? false`
//     and the host's gate resolution ends at the bundled FLAGS default (the identical
//     reasoning teach-gate-restore-patch.mjs records for sand_teach_by_demonstration).
//     Shipping the default `true` therefore reproduces what this account actually gets from
//     the backend today, which was observed directly: the official app force-opened its
//     primary-bot chooser at ~04:00 on 2026-10-02 and the sidebar now shows a bot badged
//     「主 Bot」. Both gates are on for this account, so both are recorded as on here.
//
//   * The chooser UI itself is NOT patched. It lives in the official renderer's a3e() hook,
//     which does not exist anywhere in this build's 0.18 renderer baseline (mainAgentEnabled,
//     sawPointer, pointerUnknown, SetGrokBotMainAgent: 0 hits across the pristine
//     src/app/dist renderer). Injecting a chooser would mean authoring UI, which this project
//     forbids. These two gates only unblock the host-side admission path that this port
//     implements; the visible chooser needs a renderer baseline that already contains it.
//
// Insertion, not mutation: the gate names are ABSENT from the 0.18 table, so there is no
// `default: false` line to flip. The patch appends whole entries next to a unique existing
// neighbour and fails closed when the neighbour is missing or already ambiguous.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Real neighbouring entries in the 0.18 bundled FLAGS table, used as insertion points.
// Anchors are FULL table entries (2-space entry indent, 4-space field indent) verified
// against the pristine src/app/dist/host/host-main.cjs, so a drifted bundle cannot match by
// accident. Ordered by preference; the caller counts occurrences and fails closed when the
// chosen one is not unique.
const ANCHOR_CANDIDATES = [
  "  sand_get_grok_bot_ios: {\n    client: true,\n    default: false\n  },",
  "  sand_usage_page: {\n    client: true,\n    default: false\n  },",
  "  sand_multitask: {\n    client: true,\n    default: true\n  },",
];
const INSERT = `  // The user's main bot (主 Bot). Ported from the official client; see
  // source/shared/node/grok-bot-main-agent.ts for the full evidence trail. Upstream's own
  // comment: "The user's main bot: SetGrokBotMainAgent and EnsureGrokBotDefaultMainAgent
  // (server-side admission) and the Sand desktop's main-bot roster treatment, the
  // replace-main-bot menu item and picker. The only main bot the server sets on its own is
  // a new user's onboarding bot (sand_grok_onboarding_main_agent); an existing user with
  // none picks one, or adds Grok Bot, in the client's chooser. When OFF (the default) both
  // RPCs are refused and the desktop shows every bot the same way; main_agent_id still
  // rides GetGrokBotUserRuntimeSettings so a client can read it without the gate."
  sand_grok_main_agent: {
    client: true,
    default: true
  },
  // Opens the primary-bot chooser only together with sand_grok_main_agent, and keeps it
  // open until a main agent is selected. (upstream comment, verbatim)
  sand_grok_force_main_agent_selection: {
    client: true,
    default: true
  },
`;

/**
 * Picks a real neighbour in the bundled table and inserts the two entries before it.
 * Kept in one function so the test can drive it against a fixture rather than a 29 MB bundle.
 */
export function insertMainAgentGates(source, pickAnchor = defaultAnchorPicker) {
  if (source.includes("sand_grok_main_agent: {") || source.includes("sand_grok_force_main_agent_selection: {")) {
    return { text: source, applied: false, reason: "already-present" };
  }
  const anchor = pickAnchor(source);
  if (anchor == null) return { text: source, applied: false, reason: "anchor-missing" };
  const occurrences = source.split(anchor.text).length - 1;
  if (occurrences !== 1) return { text: source, applied: false, reason: `anchor-ambiguous:${occurrences}` };
  return { text: source.replace(anchor.text, INSERT + anchor.text), applied: true, reason: "inserted", anchor };
}

// Prefers the placeholder marker (never present in a real bundle) and otherwise falls back
// to a real neighbouring table entry. Uniqueness is NOT decided here — the caller counts
// occurrences so that an ambiguous neighbour is reported as ambiguous, not as missing.
// Uniqueness is NOT decided here — the caller counts occurrences so that an ambiguous
// neighbour is reported as ambiguous, not as missing.
function defaultAnchorPicker(source) {
  for (const candidate of ANCHOR_CANDIDATES) {
    if (source.includes(candidate)) return { text: candidate };
  }
  return null;
}

const GATE_NAMES = ["sand_grok_main_agent", "sand_grok_force_main_agent_selection"];

export async function applyGrokMainAgentGatePatch({ stageRoot }) {
  const hostBundle = path.join(stageRoot, "dist", "host", "host-main.cjs");
  let source;
  try {
    source = await readFile(hostBundle, "utf8");
  } catch (error) {
    console.log(`Grok main-agent gates: skipped (${path.relative(stageRoot, hostBundle)} unreadable: ${String(error)})`);
    return { mode: "grok-main-agent-gates", applied: false, reason: "host-bundle-unreadable" };
  }
  const result = insertMainAgentGates(source);
  if (!result.applied) {
    console.log(`Grok main-agent gates: skipped (${result.reason})`);
    return { mode: "grok-main-agent-gates", applied: false, reason: result.reason, gates: GATE_NAMES };
  }
  await writeFile(hostBundle, result.text);
  const patchedHash = createHash("sha256").update(result.text).digest("hex");
  console.log(`Grok main-agent gates: inserted ${GATE_NAMES.join(", ")} (default true) into the bundled FLAGS table`);
  const provenancePath = path.join(stageRoot, "dist", "grok-main-agent-gates-extension.json");
  await writeFile(provenancePath, `${JSON.stringify({ mode: "grok-main-agent-gates", gates: GATE_NAMES, default: true, anchor: result.anchor?.text ?? null, patchedSha256: patchedHash }, null, 2)}\n`);
  return { mode: "grok-main-agent-gates", applied: true, gates: GATE_NAMES, patchedSha256: patchedHash, provenancePath };
}
