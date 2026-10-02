/**
 * Grok Bot "main bot" (主 Bot) contract — ported from the official client.
 *
 * Evidence (byte-sourced 2026-10-02 from the official Grok Bot 0.63.0 / 0.66.0 app
 * asar and from the VM host bundle the official app actually runs,
 * /opt/sand/sand-host/host-main.cjs):
 *
 *   * The gate registry entry and its own comment live in the host bundle. Upstream
 *     words: "The user's main bot: SetGrokBotMainAgent and EnsureGrokBotDefaultMainAgent
 *     (server-side admission) and the Sand desktop's main-bot roster treatment, the
 *     replace-main-bot menu item and picker. The only main bot the server sets on its own
 *     is a new user's onboarding bot (sand_grok_onboarding_main_agent); an existing user
 *     with none picks one, or adds Grok Bot, in the client's chooser. When OFF (the
 *     default) both RPCs are refused and the desktop shows every bot the same way;
 *     main_agent_id still rides GetGrokBotUserRuntimeSettings so a client can read it
 *     without the gate."
 *       -> two properties this port keeps: the WRITE path is gate-gated ("both RPCs are
 *          refused"), the READ path is not ("a client can read it without the gate").
 *   * The forced chooser is gated separately, upstream words: "Opens the primary-bot
 *     chooser only together with sand_grok_main_agent, and keeps it open until a main
 *     agent is selected."
 *   * The client-side chooser decision is a four-way AND (official renderer hook a3e(),
 *     function Zge / eligibility):
 *         onboardingFinished && mainAgentEnabled && forceSelection && pointerIsResolvedAndEmpty
 *     where the pointer is the server's main_agent_id, and "resolved but empty" means
 *     kind === "known" && agentId === null. An unresolved pointer is kind === "unknown"
 *     and can never open the chooser. isGrokBotMainAgentSelectionEligible() states that rule
 *     so it is testable without a renderer. Note it is the RULE, not the wiring: the shipped
 *     renderer hard-codes the two gate terms to satisfied (see the scope note below).
 *   * The desktop-side facade is three methods (official 0.66 electron-main/main-app.cjs):
 *         get()    -> { agentId: (await getGrokBotUserRuntimeSettings()).settings?.mainAgentId ?? null }
 *         set(id)  -> { agentId: (await setGrokBotMainAgent({agentId})).settings?.mainAgentId ?? null }
 *         ensure() -> { agentId, outcome } from ensureGrokBotDefaultMainAgent
 *   * ensure's outcome enum, from the official proto mapper (electron-main/proto.cjs):
 *         created | present | hasMainAgent | tombstoned | pinnedFull | busy
 *
 * Scope note for this local-only build, corrected 2026-10-02 after reading the service:
 * an earlier version of this comment claimed `ensure` "never returns `created`, and never
 * invents a bot on the user's behalf". That is false. Upstream puts Set/Ensure admission
 * on the SERVER, which in this rebuild is the Sand host (the box), and
 * source/host/main-agent-service.ts `MainAgentService.ensureOnce()` does exactly what
 * upstream describes: with no main agent and no recorded defaultMainAgentId it calls
 * `ports.createDefault()` — which creates a real Bot through
 * `createBackgroundAgent(MAIN_AGENT_PROFILE, …)`, seeds two transcript lines and returns
 * `created`. A fresh user who answers the introduction with 「创建主 Bot」 therefore gets a
 * genuinely new Bot, and this build is not an exception to upstream's rule.
 *
 * Because of that, the pure helpers below are NOT the production decision point and must
 * not be read as one:
 *   * the chooser's real condition is the injected renderer block in
 *     scripts/lib/main-agent-renderer-components.mjs (`RMainRoot`), which polls every 5s
 *     and opens the forced introduction when `agentId === null && seen === true`;
 *   * the write path's real gate check is `MainAgentService.assertEnabled()`.
 * The helpers here are the readable form of the contract, exercised by
 * tests/grok-bot-main-agent.test.mjs, so the rules can be asserted without a box. Keep them
 * in step with the service rather than treating them as the implementation.
 *
 * One gap worth knowing: the renderer does not consult either gate. Official's four-way AND
 * includes `mainAgentEnabled && forceSelection`, and this build collapses them to `true` by
 * pinning both flags to `default: true` at packaging time
 * (scripts/lib/grok-main-agent-gate-patch.mjs). That is equivalent while the flags stay on,
 * but turning either off would stop the host from accepting writes without stopping the
 * dialog from appearing. Gating the renderer is the fix if that ever matters.
 */

/** Feature gate that admits the main-bot WRITE path. OFF means every set/ensure is refused. */
export const GROK_BOT_MAIN_AGENT_GATE = "sand_grok_main_agent";

/** Feature gate for the client chooser that opens by itself. Requires GROK_BOT_MAIN_AGENT_GATE. */
export const GROK_BOT_FORCE_MAIN_AGENT_SELECTION_GATE = "sand_grok_force_main_agent_selection";

/** Upstream's server-side onboarding gate — the only path that mints a main bot by itself. */
export const GROK_BOT_ONBOARDING_MAIN_AGENT_GATE = "sand_grok_onboarding_main_agent";

export const GROK_BOT_DEFAULT_MAIN_AGENT_OUTCOMES = [
  "created",
  "present",
  "hasMainAgent",
  "tombstoned",
  "pinnedFull",
  "busy",
] as const;

export type GrokBotDefaultMainAgentOutcome = (typeof GROK_BOT_DEFAULT_MAIN_AGENT_OUTCOMES)[number];

export function isGrokBotDefaultMainAgentOutcome(value: unknown): value is GrokBotDefaultMainAgentOutcome {
  return typeof value === "string" && (GROK_BOT_DEFAULT_MAIN_AGENT_OUTCOMES as readonly string[]).includes(value);
}

/** Thrown by the host when a main-bot write is attempted while its gate is off. */
export class GrokBotMainAgentRefusedError extends Error {
  constructor() {
    super("The main-bot feature is not enabled for this build, so the main agent cannot be changed.");
    this.name = "GrokBotMainAgentRefusedError";
  }
}

/** The server's main_agent_id as the client sees it: unresolved, resolved-empty, or resolved-set. */
export type GrokBotMainAgentPointer =
  | { readonly kind: "unknown" }
  | { readonly kind: "known"; readonly agentId: string | null };

/** Normalizes a main_agent_id from settings, a wire payload, or a bridge call. */
export function normalizeGrokBotMainAgentId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pointerIsResolvedAndEmpty(pointer: GrokBotMainAgentPointer): boolean {
  return pointer.kind === "known" && pointer.agentId === null;
}

/**
 * Port of the official chooser's eligibility test (renderer hook a3e, function Zge).
 * Every input is ANDed: an unfinished onboarding, a missing gate, or an unresolved
 * pointer all keep the chooser shut. Deliberately free of UI and of timers so the rule
 * can be asserted directly.
 */
export function isGrokBotMainAgentSelectionEligible(args: {
  readonly onboardingFinished: boolean;
  readonly mainAgentEnabled: boolean;
  readonly forceSelection: boolean;
  readonly pointer: GrokBotMainAgentPointer;
}): boolean {
  return args.onboardingFinished && args.mainAgentEnabled && args.forceSelection && pointerIsResolvedAndEmpty(args.pointer);
}

/** The chooser's own state machine, ported so the dismissal latch is testable without React. */
export type GrokBotMainAgentChooserState =
  | { readonly kind: "closed"; readonly reason: "ineligible" | "dismissed" | "completed"; readonly sawPointer: boolean }
  | { readonly kind: "open"; readonly step: { readonly step: "intro" | "chooser"; readonly pickedId?: string | null }; readonly busy: null | "set"; readonly error: unknown };

export const GROK_BOT_MAIN_AGENT_CHOOSER_CLOSED: GrokBotMainAgentChooserState = { kind: "closed", reason: "ineligible", sawPointer: false };

/**
 * Mirrors the official reducer's `eligible` case: open unless the user already dismissed,
 * already completed, or already saw a resolved pointer with nothing set. The dismissed
 * latch is what stops the forced chooser from re-arming on every app start.
 */
export function reduceGrokBotMainAgentChooser(
  state: GrokBotMainAgentChooserState,
  event: { readonly type: "eligible" } | { readonly type: "dismiss" } | { readonly type: "completed"; readonly sawPointer: boolean } | { readonly type: "eligibleNow" },
): GrokBotMainAgentChooserState {
  switch (event.type) {
    case "eligible":
      if (state.kind !== "closed" || state.reason === "dismissed" || (state.reason === "completed" && !state.sawPointer)) return state;
      return { kind: "open", step: { step: "intro" }, busy: null, error: null };
    case "eligibleNow":
      return state.kind === "closed" && state.reason !== "dismissed" ? { kind: "open", step: { step: "intro" }, busy: null, error: null } : state;
    case "dismiss":
      // `sawPointer` only carries meaning for `completed` upstream (it records whether a
      // resolved-but-empty pointer was ever observed), so a dismissal just latches the
      // reason — no pointer bookkeeping is invented here.
      return state.kind === "open" ? { kind: "closed", reason: "dismissed", sawPointer: false } : state;
    case "completed":
      return { kind: "closed", reason: "completed", sawPointer: event.sawPointer };
    default:
      return state;
  }
}

/**
 * Whether one specific agent is the user's main bot — the predicate behind BOTH of the
 * official app's main-agent UI affordances, ported from official 0.66.0
 * (renderer index-ZYxf-aBb.js, sidebar context-menu component xA):
 *
 *     const y = F3();                                    // the main_agent_id pointer
 *     const x = U9(m, y);                                // other candidates
 *     const v = y.kind === "known" && y.agentId === n.id && x.length === 0;
 *     // … later, in the same menu:
 *     ie = v ? <bA onReplace={...} />                    // 「替换为其他 Bot」, icon arrow-swap
 *            : x.length > 0 ? <kA .../> : null;
 *
 * and the sidebar row takes the same flag as an `isMain` prop (row component J4), which
 * appends 「主 Bot」 to the row's accessible name and sets the avatar corner marker to
 * "main" (accessibility-name builder DI; marker resolver s1e).
 *
 * Note the `otherCandidateCount === 0` clause: upstream shows 「替换为其他 Bot」 only while
 * this agent is the main one AND there is nothing else to replace it with — that is why
 * the same slot renders a batch-delete item instead when other candidates exist.
 *
 * Do not confuse this with pinning. Pinning is a separate, already-ported concept in this
 * build (pinnedAgentIds, rendered by the 0.18 baseline with its own pin / pin-slash menu
 * items); the star in the official sidebar is the MAIN BOT badge, which 0.18 has no notion
 * of at all (isMain: 0 hits across the pristine renderer).
 */
export function isGrokBotMainAgent(args: {
  readonly pointer: GrokBotMainAgentPointer;
  readonly agentId: string;
  readonly otherCandidateCount: number;
}): boolean {
  return args.pointer.kind === "known" && args.pointer.agentId === args.agentId && args.otherCandidateCount === 0;
}

export interface GrokBotDefaultMainAgentResolution {
  readonly agentId: string | null;
  readonly outcome: GrokBotDefaultMainAgentOutcome;
}

/**
 * A readable form of the outcome table `MainAgentService.ensureOnce()` implements, kept
 * beside the contract so it can be asserted without a box. It is deliberately NOT that
 * method: the service mints a Bot when nothing is recorded, so its `created` branch is
 * reachable and this model stops at `present` because it has no port to create one with.
 * When the two disagree, the service is right and this needs updating.
 */
export function resolveGrokBotDefaultMainAgentOutcome(args: {
  readonly gateEnabled: boolean;
  readonly mainAgentId: string | null;
  readonly busy?: boolean;
}): GrokBotDefaultMainAgentResolution {
  if (args.busy === true) return { agentId: args.mainAgentId, outcome: "busy" };
  if (args.mainAgentId !== null) return { agentId: args.mainAgentId, outcome: "hasMainAgent" };
  if (!args.gateEnabled) return { agentId: null, outcome: "present" };
  return { agentId: null, outcome: "present" };
}
