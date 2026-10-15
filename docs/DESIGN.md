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

## 9. Computer preview display state
The user-directed Sleep action pauses one Bot's computer preview stream. Awake/asleep state is keyed by the native agentId and kept in the main process. Sleep, Restore and state reads require that ID over IPC; an omitted ID never acts as a global switch. Docker, the host connection, Bot execution and workspace files continue unchanged. Native preview and fullscreen roots provide the owning Bot ID through React context, and the preview frame exposes the same ID for its controls. Pool/viewer wrappers subscribe to that Bot's state, releasing its active previews, warm caches, retained thumbnails and hidden fullscreen viewers. Other Bots' views and visible interactive fullscreen viewers continue. Pools and fullscreen bases reset on owner changes so cached URLs cannot be inherited by another Bot. Switching from sleeping A to awake B shows B normally; returning to A preserves its paused state; restoring A does not wake sleeping B. Stale polling or action replies may update only their captured Bot and cannot cover the newly selected Bot. Restarting the app starts all previews awake.

The asleep stage stays on the preview frame and synchronizes on owner/frame changes so Restore is immediately available. Reuse the shipped asleep-stage surface and tokens, with “电脑预览已关闭” and “恢复预览” labels. The Sleep tooltip identifies the current Bot. Hover preserves the native Open button and derives Sleep from its button/pill classes and moon-z icon; the build rejects missing or ambiguous native anchors. Both actions share the native reveal variable; Sleep sits below Open with the 8px spacing token. Exported asleep-stage styles remain restricted to the stage. This per-Bot preview behavior is a user-directed local adaptation, not a claim about upstream server hibernation.

## 10. Official 0.70.2 avatars and details tabs
Use the hash-verified official yN drawing engine and 13-shape order, arranged as 5+5+3. Preserve all 11 zf colors, shape selection masks, Chinese tooltips and the existing roster save/reset path. Derive idle, sleeping and waking SVGs through that engine, retaining local defs and references. Sleep uses the same Bot body, gray tertiary ink, sleepy expression and the original breathing/Z keyframes; wake uses surprised expression. The old particle burst ref is adapted to bounce. No duplicated fallback silhouettes are accepted.

The right pane has Details, Library, Computer and Other. Other is a Node extension holding description, notifications and model controls. Keep the native navigation and scroll ancestors mounted, split leaf visibility with hidden, and never move Library or VNC nodes. The active tab persists across Bot switches and sleep; arrow/Home/End keys select and focus tabs in narrow panels. Hide the description heading with its editor on Details. Empty routine content keeps its compact layout.

## 11. Conversation computer handoff cards
Port the official PV card's elevated/bubble surfaces, tokens, titlebar, disclosure and waiting/pending/error/resolved states. A request belongs to the transcript owner and optional child Bot, never the globally selected Bot. Takeover selects that owner, waits for readiness, checks supersession and opens the native interactive computer with child focus when present. Done and Skip validate the same pending request before resolving it; retained callbacks cannot complete a newer request.

The production request_box_help tool creates a session handoff, emits durable boxHandoff transcript metadata, then ends the turn awaiting user selection. Canonical resolutions are handed_back and dismissed; legacy completed/cancelled inputs normalize at the session boundary. Skip resumes through the dismissed trigger. The older protocol provides snapshotDataUrl, so card images are request snapshots; a continuous card thumbnail stream is not claimed. Controlled production tests use real host/tool/database/projection code with explicit transport/lifecycle seams, separate from native desktop input and real-model request creation.
