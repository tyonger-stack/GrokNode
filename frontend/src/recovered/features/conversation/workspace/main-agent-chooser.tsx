// Ported: the primary-bot chooser ("主 Bot 会主动做事…"), opened from a main bot's
// "Replace with different Bot" row action.
//
// @port /Applications/Grok Bot.app (CFBundleShortVersionString 0.66.0, built
// @port 2026-10-01T18:23:52Z) → renderer/assets/index.eager-app-Cj5f8Gby.js and
// @port index-ZYxf-aBb.js. The dialog shell, its two steps and the reducer that drives them
// @port are recovered in index.eager-app (component a3e / reducer Qge / projection Zge);
// @port the shared copy in source/shared/node/grok-bot-main-agent.ts carries the rules so
// @port they stay assertable without a renderer.
// @port Labels: "主 Bot 会主动做事。它是日常任务的首选，会解开卡住的工作，并在需要你帮忙时来确认。"
// @port (i18n QKU8bg), 「选择主 Bot」/ "Select main Bot" (EE2rtW), 「创建主 Bot」
// @port / "Create main Bot" (3VAome), 「替换为其他 Bot」/ "Replace with different Bot" (EmmHd+).
// @port Absent from this build's 0.18 baseline: all four ids have 0 hits in src/app/dist/renderer.
//
// Shape kept faithful to the recovered reducer: intro → chooser, the confirm button stays
// disabled until something is picked, and going back from the chooser returns to intro rather
// than committing. The dismissal latch lives in the reducer, not here. The dialog chrome is
// this build's OverlayDialog + SandButton primitives — the official 0.66 dialog kit (Pt.*) has
// no counterpart in the 0.18 recovery, so only the behaviour is ported, not the skin.

import { useState } from "react";

import { OverlayDialog } from "../../../ui/overlay-primitives";
import { SandButton } from "../../../ui/sand-kit-primitives";
import {
  reduceGrokBotMainAgentChooser,
  type GrokBotMainAgentChooserState
} from "../../../../../../source/shared/node/grok-bot-main-agent";

export interface MainAgentChooserCandidate {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface MainAgentChooserDialogProps {
  readonly open: boolean;
  readonly candidates: readonly MainAgentChooserCandidate[];
  /** The bot the user came from — named in the "create another" affordance. */
  readonly originAgentName?: string;
  readonly busy?: boolean;
  readonly error?: string | null;
  onConfirm(agentId: string): void;
  /** "Create main Bot" — adds a new bot and makes it the main one. */
  onCreate?(): void;
  onClose(): void;
}

function pickedIdOf(state: GrokBotMainAgentChooserState): string | null {
  return state.kind === "open" && state.step.step === "chooser" ? state.step.pickedId ?? null : null;
}

export function MainAgentChooserDialog({ open, candidates, originAgentName, busy = false, error = null, onConfirm, onCreate, onClose }: MainAgentChooserDialogProps) {
  const [state, setState] = useState<GrokBotMainAgentChooserState>({ kind: "closed", reason: "ineligible", sawPointer: false });
  // Entering the dialog IS the "eligible" event upstream dispatches when it opens the chooser.
  const shown = open ? reduceGrokBotMainAgentChooser(state, { type: "eligibleNow" }) : state;
  const step = shown.kind === "open" ? shown.step : { step: "intro" as const };
  const pickedId = pickedIdOf(shown);

  if (!open) return null;

  const dismiss = () => {
    setState(reduceGrokBotMainAgentChooser(shown, { type: "dismiss" }));
    onClose();
  };

  return <OverlayDialog
    label={step.step === "chooser" ? "Select main Bot" : "Create main Bot"}
    onClose={dismiss}
    open
  >
    <h2>{step.step === "chooser" ? "Select main Bot" : "Create main Bot"}</h2>
    <p>{step.step === "chooser"
      ? "Pick the bot that should act as the main one."
      : "The main bot acts on its own. It is the first choice for everyday work, it unblocks stuck work, and it comes to you when it needs confirmation."}</p>
    {step.step === "chooser" ? <ul aria-label="Candidate bots" role="listbox">
      {candidates.map((candidate) => <li aria-selected={candidate.id === pickedId} key={candidate.id} role="option">
        <SandButton
          aria-pressed={candidate.id === pickedId}
          onClick={() => setState({ kind: "open", step: { step: "chooser", pickedId: candidate.id }, busy: null, error: null })}
          size="sm"
          variant={candidate.id === pickedId ? "primary" : "secondary"}
        >{candidate.name}</SandButton>
        {candidate.description == null || candidate.description.length === 0 ? null : <small>{candidate.description}</small>}
      </li>)}
    </ul> : null}
    {error == null ? null : <p role="alert">{error}</p>}
    <div>
      {step.step === "chooser"
        ? <SandButton disabled={busy} onClick={() => setState({ kind: "open", step: { step: "intro" }, busy: null, error: null })} size="sm" variant="secondary">Back</SandButton>
        : null}
      {onCreate == null || step.step !== "intro" ? null : <SandButton disabled={busy} onClick={() => { dismiss(); onCreate(); }} size="sm" variant="secondary">{originAgentName == null ? "Create main Bot" : `Create another like ${originAgentName}`}</SandButton>}
      <SandButton
        disabled={step.step !== "chooser" || pickedId === null || busy}
        onClick={() => { if (pickedId == null) return; setState({ kind: "closed", reason: "completed", sawPointer: true }); onConfirm(pickedId); }}
        pending={busy}
        size="sm"
        variant="primary"
      >Confirm</SandButton>
    </div>
  </OverlayDialog>;
}
