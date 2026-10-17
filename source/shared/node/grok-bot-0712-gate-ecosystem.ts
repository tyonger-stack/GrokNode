/**
 * 0.71 documents / pages / multiplayer / canvas feature-gate ecosystem inventory.
 *
 * Evidence (byte-sourced 2026-10-17):
 *   * Official 0.71.2 host FLAGS table in
 *     `rea-grokbot-0712/box/sand-host/host-main.cjs` (git-sha 726deab) — every entry
 *     is `{ client: true, default: false }` with the upstream comments quoted below.
 *   * Official renderer gate names appear in `index-wlkGG389.js` / main-core name list
 *     (see `rea-grokbot-0712/复核报告-20261015.md` §官方 0.71.2 新旗帜清单).
 *   * This machine's Statsig bootstrap
 *     (`~/Library/Application Support/Grok Bot/sand-statsig-bootstrap.json`,
 *     fetchedAtMs ≈ 2026-10-16T19:29Z) — keys are Statsig djb2 (seed 0, ×31, int32).
 *
 * Pinning rule (same as teach-gate / main-agent / bot-color): this local-only build's
 * Statsig stub freezes to `{}`, so host resolution ends at the bundled FLAGS default.
 * Defaults below match what the backend currently serves for this account — NOT the
 * upstream off-default. Gates that Statsig serves false stay false (no invented UI).
 *
 * 0.18 renderer baseline has zero occurrences of these gate names, so there is no
 * `??!1`→`??!0` reader flip to apply. Surfaces that only exist in 0.71 chunks remain
 * blocked until a later evidence-anchored UI port.
 */

/** Statsig djb2 used by the official bootstrap cache (seed 0, ×31, int32 truncate). */
export function statsigDjb2(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (Math.imul(hash, 31) + name.charCodeAt(i)) | 0;
  return hash >>> 0;
}

export type GrokBot0712GateCluster =
  | "multiplayer"
  | "documents_pages_canvas"
  | "library_siblings"
  | "draft_revision";

export type GrokBot0712GateEvidence = {
  name: string;
  cluster: GrokBot0712GateCluster;
  /** Upstream bundled FLAGS default (always false in 0.71.2 host registry). */
  upstreamDefault: false;
  /**
   * Bundled default this port ships after the package-time FLAGS insert.
   * Matches Statsig on this account so the local stub reproduces official behaviour.
   */
  pinnedDefault: boolean;
  statsigHash: number;
  statsigValue: boolean;
  statsigRuleId: string;
  /** Upstream FLAGS comment (verbatim from host-main.cjs), truncated to the lead sentence. */
  upstreamComment: string;
  /**
   * Why a true pin still may not surface UI: 0.18 has no reader / no stage surface, or
   * the feature is server-RPC only.
   */
  surfaceNote: string;
};

/**
 * Core 0.71 gate ecosystem for documents / pages / multiplayer / canvas (+ clear siblings).
 * Order matches the official FLAGS neighbourhood around the documents block where possible.
 */
export const GROK_BOT_0712_GATE_ECOSYSTEM: readonly GrokBot0712GateEvidence[] = Object.freeze([
  {
    name: "grok_bot_multiplayer",
    cluster: "multiplayer",
    upstreamDefault: false,
    pinnedDefault: true,
    statsigHash: 3562553002,
    statsigValue: true,
    statsigRuleId: "4ccYGpY9uSibHE9tjOpF02:100.00:3",
    upstreamComment:
      "Grok Bot multiplayer: team-visible bots, Add to Slack, team roster, and the session UI.",
    surfaceNote:
      "Pinned ON. Most TEAM share RPCs are server-side; 0.18 has no rn(\"grok_bot_multiplayer\") reader. Sidebar rename (P1-4) was ported ungated (official rename prop does not depend on this gate).",
  },
  {
    name: "grok_bot_group_chats",
    cluster: "multiplayer",
    upstreamDefault: false,
    pinnedDefault: false,
    statsigHash: 4087051179,
    statsigValue: false,
    statsigRuleId: "6soER3OtWYixqSkivrLZX9",
    upstreamComment:
      "Group chats on top of grok_bot_multiplayer: a room with several people and up to three team-shared bots.",
    surfaceNote: "Statsig false — keep OFF. No 0.18 group-room UI surface.",
  },
  {
    name: "grok_bot_canvas_design_mode",
    cluster: "documents_pages_canvas",
    upstreamDefault: false,
    pinnedDefault: false,
    statsigHash: 2567909325,
    statsigValue: false,
    statsigRuleId: "Ea2BTSUHr8PQRr5sHl5CR",
    upstreamComment:
      "Grok Bot canvas design mode (pick an element on a page, ask about it).",
    surfaceNote: "Statsig false — keep OFF. No 0.18 canvas design-mode UI.",
  },
  {
    name: "grok_bot_documents_ui",
    cluster: "documents_pages_canvas",
    upstreamDefault: false,
    pinnedDefault: false,
    statsigHash: 1339478571,
    statsigValue: false,
    statsigRuleId: "1wsTynlzLA2bsQgrZfEphn",
    upstreamComment:
      "Grok Bot documents, Sand side: the document card in the chat, the page viewer on the stage and in-place editing.",
    surfaceNote:
      "Statsig false — keep OFF (PORTING-BACKLOG exclude: page find/rename/share). No 0.18 documents stage.",
  },
  {
    name: "grok_bot_library_pages",
    cluster: "documents_pages_canvas",
    upstreamDefault: false,
    pinnedDefault: false,
    statsigHash: 4098885776,
    statsigValue: false,
    statsigRuleId: "5ysUNtPrFVpNXw1bEHRWIY",
    upstreamComment:
      "Pages section in Sand's Library tab: the signed-in user's canvases and (with grok_bot_documents_ui) documents from their store.",
    surfaceNote: "Statsig false — keep OFF.",
  },
  {
    name: "grok_bot_page_stage_chat",
    cluster: "documents_pages_canvas",
    upstreamDefault: false,
    pinnedDefault: false,
    statsigHash: 2628714745,
    statsigValue: false,
    statsigRuleId: "17nEmjKjN8TUsTz80RdQUG",
    upstreamComment:
      "Floating chat over an open page in Sand: a canvas opened from the chat takes the shell-level page stage.",
    surfaceNote: "Statsig false — keep OFF.",
  },
  {
    name: "grok_bot_pages_search",
    cluster: "documents_pages_canvas",
    upstreamDefault: false,
    pinnedDefault: false,
    statsigHash: 1310079795,
    statsigValue: false,
    statsigRuleId: "4pjzo9stS9KoMPtunJyAdn",
    upstreamComment:
      "Lists every canvas and document in the user's own USER store by title in the Sand global search palette.",
    surfaceNote:
      "Statsig false — keep OFF. Distinct from sand_global_search (P1-8, separate agent).",
  },
  {
    name: "grok_bot_files_stage",
    cluster: "library_siblings",
    upstreamDefault: false,
    pinnedDefault: false,
    statsigHash: 752568454,
    statsigValue: false,
    statsigRuleId: "1iVoDEAPu212GnkMDuFXDj",
    upstreamComment:
      "Files on the page stage in Sand: a markdown or delimited-table attachment opens on the same full-screen stage pages use.",
    surfaceNote: "Statsig false — keep OFF. Related stage sibling of documents/pages.",
  },
  {
    name: "grok_bot_library_v2",
    cluster: "library_siblings",
    upstreamDefault: false,
    pinnedDefault: false,
    statsigHash: 1601145136,
    statsigValue: false,
    statsigRuleId: "52TRwK2cuDv0kFQq6wRrWb",
    upstreamComment:
      "Full Library replacing Sand's Media tab: pages, bot-sent media, files and links interleaved under Today / This week / Older.",
    surfaceNote: "Statsig false — keep OFF. Library v2 sibling of pages.",
  },
  {
    name: "grok_bot_library_external_docs",
    cluster: "library_siblings",
    upstreamDefault: false,
    pinnedDefault: false,
    statsigHash: 111586043,
    statsigValue: false,
    statsigRuleId: "1KZsprYkg1wBOJl5jK1uAV",
    upstreamComment:
      "Library: record the documents, drafts, events, messages and pull requests a Grok Bot turn created or edited through a connector.",
    surfaceNote: "Statsig false — keep OFF. Requires library_v2 as well per upstream comment.",
  },
  {
    name: "grok_bot_draft_revision_highlight",
    cluster: "draft_revision",
    upstreamDefault: false,
    pinnedDefault: true,
    statsigHash: 3976277342,
    statsigValue: true,
    statsigRuleId: "6xKzIAeFhTDWnFVAMDZiS0:100.00:3",
    upstreamComment:
      "Grok Bot draft cards: when an email or Slack draft revises an earlier draft, show added words in accent text and removed words struck through for 5 s.",
    surfaceNote:
      "Pinned ON (Statsig true, client-only). 0.18 has no draft-revision highlight renderer surface — host FLAGS only until a later UI port.",
  },
] as const);

export const GROK_BOT_0712_GATE_NAMES = GROK_BOT_0712_GATE_ECOSYSTEM.map((gate) => gate.name);

/** Gates this port pins ON (Statsig true on this account). */
export const GROK_BOT_0712_GATES_PINNED_ON = GROK_BOT_0712_GATE_ECOSYSTEM.filter((gate) => gate.pinnedDefault).map(
  (gate) => gate.name,
);

/** Gates registered but kept OFF (Statsig false — evidence forbids inventing the surface). */
export const GROK_BOT_0712_GATES_KEPT_OFF = GROK_BOT_0712_GATE_ECOSYSTEM.filter((gate) => !gate.pinnedDefault).map(
  (gate) => gate.name,
);
