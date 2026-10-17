// Register the 0.71 documents / pages / multiplayer / canvas feature-gate ecosystem in
// the bundled FLAGS table, at the values the Statsig backend is CURRENTLY serving for
// this account.
//
// Evidence trail and per-gate notes live in
// source/shared/node/grok-bot-0712-gate-ecosystem.ts. Same package-time insertion pattern
// as grok-main-agent-gate-patch.mjs / bot-color-gate-patch.mjs:
//
//   * These names are ABSENT from the frozen 0.18 experiment-config.gen.ts.
//   * The local Statsig stub freezes to {}, so host resolution ends at FLAGS.default.
//   * Multiplayer + draft_revision_highlight → default true (Statsig true).
//   * Documents / pages / canvas / library siblings → default false (Statsig false);
//     still registered so checkFeatureGate is fail-closed and the inventory is one place,
//     but never flipped ON against evidence (PORTING-BACKLOG §排除).
//
// No renderer `??!1`→`??!0` flips: the 0.18 pinned chunks contain 0 occurrences of these
// gate names. Enabling UI would invent surfaces.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Real neighbouring entries in the 0.18 bundled FLAGS table (same candidates as the
// main-agent / bot-color inserts). Previous gate passes insert BEFORE these anchors, so
// the neighbour strings themselves remain unique.
const ANCHOR_CANDIDATES = [
  "  sand_get_grok_bot_ios: {\n    client: true,\n    default: false\n  },",
  "  sand_usage_page: {\n    client: true,\n    default: false\n  },",
  "  sand_multitask: {\n    client: true,\n    default: true\n  },",
];

/** Sentinel: if any of these appear, the ecosystem block was already applied. */
export const GATE_NAMES = Object.freeze([
  "grok_bot_multiplayer",
  "grok_bot_group_chats",
  "grok_bot_canvas_design_mode",
  "grok_bot_documents_ui",
  "grok_bot_library_pages",
  "grok_bot_page_stage_chat",
  "grok_bot_pages_search",
  "grok_bot_files_stage",
  "grok_bot_library_v2",
  "grok_bot_library_external_docs",
  "grok_bot_draft_revision_highlight",
]);

export const GATES_PINNED_ON = Object.freeze(["grok_bot_multiplayer", "grok_bot_draft_revision_highlight"]);

const INSERT = `  // --- 0.71 gate ecosystem (documents / pages / multiplayer / canvas) -----------------
  // Registered from official 0.71.2 host FLAGS + this account's Statsig bootstrap
  // (fetchedAtMs 2026-10-16T19:29Z). See source/shared/node/grok-bot-0712-gate-ecosystem.ts.
  // Grok Bot multiplayer: team-visible bots, Add to Slack, team roster, and the session UI.
  // Pinned default true — Statsig #3562553002 = true (rule 4ccYGpY9uSibHE9tjOpF02:100.00:3).
  grok_bot_multiplayer: {
    client: true,
    default: true
  },
  // Group chats on top of grok_bot_multiplayer. Statsig false — keep OFF.
  grok_bot_group_chats: {
    client: true,
    default: false
  },
  // Grok Bot canvas design mode (pick an element on a page, ask about it). Statsig false.
  grok_bot_canvas_design_mode: {
    client: true,
    default: false
  },
  // Grok Bot documents, Sand side: document card / page viewer / in-place editing.
  // Statsig #1339478571 = false — keep OFF (no invented documents UI).
  grok_bot_documents_ui: {
    client: true,
    default: false
  },
  // Pages section in Sand's Library tab. Statsig false — keep OFF.
  grok_bot_library_pages: {
    client: true,
    default: false
  },
  // Floating chat over an open page (shell-level page stage). Statsig false — keep OFF.
  grok_bot_page_stage_chat: {
    client: true,
    default: false
  },
  // Pages rows in the global search palette. Statsig false — keep OFF
  // (distinct from sand_global_search).
  grok_bot_pages_search: {
    client: true,
    default: false
  },
  // Files on the page stage. Statsig false — keep OFF.
  grok_bot_files_stage: {
    client: true,
    default: false
  },
  // Full Library replacing Media tab. Statsig false — keep OFF.
  grok_bot_library_v2: {
    client: true,
    default: false
  },
  // External connector documents in Library. Statsig false — keep OFF.
  grok_bot_library_external_docs: {
    client: true,
    default: false
  },
  // Draft revision highlight on email/Slack draft cards. Client-only.
  // Pinned default true — Statsig #3976277342 = true (rule 6xKzIAeFhTDWnFVAMDZiS0:100.00:3).
  // 0.18 has no highlight surface yet; FLAGS only.
  grok_bot_draft_revision_highlight: {
    client: true,
    default: true
  },
`;

/**
 * Picks a real neighbour in the bundled table and inserts the ecosystem block before it.
 * Kept pure so tests can drive fixtures without a 29 MB host bundle.
 */
export function insert0712GateEcosystem(source, pickAnchor = defaultAnchorPicker) {
  if (GATE_NAMES.some((name) => source.includes(`${name}: {`))) {
    return { text: source, applied: false, reason: "already-present" };
  }
  const anchor = pickAnchor(source);
  if (anchor == null) return { text: source, applied: false, reason: "anchor-missing" };
  const occurrences = source.split(anchor.text).length - 1;
  if (occurrences !== 1) return { text: source, applied: false, reason: `anchor-ambiguous:${occurrences}` };
  return { text: source.replace(anchor.text, INSERT + anchor.text), applied: true, reason: "inserted", anchor };
}

function defaultAnchorPicker(source) {
  for (const candidate of ANCHOR_CANDIDATES) {
    if (source.includes(candidate)) return { text: candidate };
  }
  return null;
}

export async function apply0712GateEcosystemPatch({ stageRoot }) {
  const hostBundle = path.join(stageRoot, "dist", "host", "host-main.cjs");
  let source;
  try {
    source = await readFile(hostBundle, "utf8");
  } catch (error) {
    console.log(`0712 gate ecosystem: skipped (${path.relative(stageRoot, hostBundle)} unreadable: ${String(error)})`);
    return { mode: "0712-gate-ecosystem", applied: false, reason: "host-bundle-unreadable" };
  }
  const result = insert0712GateEcosystem(source);
  if (!result.applied) {
    console.log(`0712 gate ecosystem: skipped (${result.reason})`);
    return { mode: "0712-gate-ecosystem", applied: false, reason: result.reason, gates: [...GATE_NAMES] };
  }
  await writeFile(hostBundle, result.text);
  const patchedHash = createHash("sha256").update(result.text).digest("hex");
  const onList = GATES_PINNED_ON.join(", ");
  console.log(`0712 gate ecosystem: inserted ${GATE_NAMES.length} gates (pinned ON: ${onList}) into the bundled FLAGS table`);
  const provenancePath = path.join(stageRoot, "dist", "0712-gate-ecosystem-extension.json");
  await writeFile(
    provenancePath,
    `${JSON.stringify(
      {
        mode: "0712-gate-ecosystem",
        gates: [...GATE_NAMES],
        pinnedOn: [...GATES_PINNED_ON],
        keptOff: GATE_NAMES.filter((name) => !GATES_PINNED_ON.includes(name)),
        anchor: result.anchor?.text ?? null,
        patchedSha256: patchedHash,
        evidence: {
          officialHost: "rea-grokbot-0712/box/sand-host/host-main.cjs",
          statsigBootstrap: "~/Library/Application Support/Grok Bot/sand-statsig-bootstrap.json",
          statsigFetchedAt: "2026-10-16T19:29:13.613Z",
          inventoryModule: "source/shared/node/grok-bot-0712-gate-ecosystem.ts",
        },
      },
      null,
      2,
    )}\n`,
  );
  return {
    mode: "0712-gate-ecosystem",
    applied: true,
    gates: [...GATE_NAMES],
    pinnedOn: [...GATES_PINNED_ON],
    patchedSha256: patchedHash,
    provenancePath,
  };
}
