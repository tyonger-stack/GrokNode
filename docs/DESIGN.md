# Grok Node UI extensions

## 1. Reference and scope
The immutable 0.18 renderer is the component system. The main Bot extension ports the behavior and labels observed in the official app at 0.63.0 (the 04:00 chooser rollout) and re-read against 0.66.0 for the reference implementation: gate `sand_grok_main_agent` / `sand_grok_force_main_agent_selection`, the `get`/`set`/`ensure` facade, the `isMain` rule, the main-Bot badge, and the `replace_main_agent` menu row. The extracted artifacts that back those claims are machine-local and deliberately not in this repository — `reports/` is gitignored — so they live in `~/grokbot-investigation/` (`official-063/`, `official-066/`, `extract-asar.mjs`, `ctx.py`) and must be re-extracted from `/Applications/Grok Bot.app` to re-verify. Preserve the rest of the application.

## 2. Color tokens
Reuse `--sand-bg-elevated`, `--sand-text-primary`, `--sand-text-secondary`, `--sand-text-on-color`, `--sand-fill-warning`, `--sand-border-weak`, `--sand-fill-secondary`, and `--sand-fill-accent`. The main Bot marker uses the warning fill and on-color foreground.

## 3. Typography
Use the existing renderer font and native Dialog/Action/Menu typography. Candidate descriptions use the existing secondary text color. Chinese labels must remain readable without truncation.

## 4. Spacing and geometry
The upstream intro and picker widths are 360px and 400px, capped to viewport width. 0.18's dialog kit has no 400px entry in its width table (`{360, 380, 440, 460, 480, 500, 520, 608}`) and a miss renders at the default width rather than failing, so the picker takes 440px, the next size the kit ships. Use an 8px spacing unit, 16px dialog content spacing, and a bounded scrolling candidate list. The marker is a 20px pinned-avatar or 16px row-avatar circle with a 2px surface ring.

## 5. Primitives and states
Reuse `Gt.Root/Header/Title/Description/Body/ActionBar/Action`, `Qs`, `It.Item/Section`, and the original agent item. Main Bot states: unresolved, none, selected, creating, saving, failed. Forced introduction cannot close through background/Escape; manual replacement can. Confirm stays disabled until a candidate is selected.

## 6. Interaction
Intro offers creating the default main Bot or choosing an existing owned non-group Bot. The replacement menu opens the existing-Bot picker. A running or attention marker retains priority over the main marker according to the shipped layout resolver; collapsed rows suppress it. Canceling pinning does not remove main identity.

## 7. Accessibility and resize
Use the native dialog focus trap and menu keyboard handling. Label the main marker `主 Bot`, the search input, and candidate selections. Cap dialogs and lists at the viewport edges and preserve native sidebar collapse behavior.

## 8. Evidence and accepted limits
This is a local host implementation, without the official account service or a simulated 04:00 rollout. Initial proactive work uses the existing introduction mechanism after explicit creation. The old renderer kit supplies the dialog surface; behavior and main-marker semantics follow the observed newer application.
