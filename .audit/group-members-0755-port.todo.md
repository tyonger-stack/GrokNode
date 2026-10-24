# Restore verified group-members overlay

## Design decision (2026-10-25)

- `session-summaries.ts` remains the single source of persisted group identity. `buildSummary` inherits `isGroup`, `memberIds`, and `remoteMembers` from `minimalAgentSummary`; explicit caller values keep precedence. Malformed or missing `group.json` stays private.
- The info-pane extension receives a one-bit boundary marker, `data-r-info-pane-group`, from the existing native component patch. A pure `officialOverviewTabs0755` adapter maps the official group order to the local tab IDs. Private and group selections use separate storage keys.
- The official 0.75.5 author-name component and palette stay a renderer artifact patch. The host fallback uses an idempotent pure roster patch plus an apply wrapper that records source and patched hashes in provenance. Both patches run before the final package audit.
- Rejected alternative: adding a cross-bundle context bridge for one boolean. It would create a second state owner and a larger public surface without changing the behavior.

- [x] Reproduce it yourself on the matching surface via the driver skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
- [x] Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Claude Code's `loop` skill. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
- [x] Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default in poteto-mode's Models section) with a specific scope.
- [ ] Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
- [x] Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
- [ ] Run **Opening a PR**. skip: the user has not requested publication.

## Port checks

- [x] Preserve the verified group roster projection from `session-summaries.ts`.
- [x] Port the official 0.75.5 group tab policy without regressing private Bot tabs.
- [x] Wire the verified group author colors and host roster patch into the full build. The author patch mounts in `clean-build.mjs` after the recipient picker; the host projection compiles from source and `patchGroupRosterHost` stays as the idempotent shipped-delta verifier (same wiring as `.wt-recipient-picker-0755`).
- [x] Bring only group-specific tests and provenance from `.wt-recipient-picker-0755`. Restored the two pieces the first copy dropped: the `no-single-chat-preview-in-group-compose` provenance feature and its `HDn`/`de` VM test; the two official-fingerprint tests now version-gate against 0.75.5 because the on-disk official app auto-updated to 0.75.8.
- [x] Run focused group and info-pane tests, typechecks, and diff checks. 2026-10-25: group-author 4/4 (+1 skipped fingerprint), roster-host 1/1, roster-summary 4/4, recipient-picker 10/10 (+1 skipped fingerprint, incl. restored group-draft guard), info-pane tabs 10/10, search-menu 5/5, agent-avatar-commit 7/7; both typechecks green; `git diff --check` clean.
- [ ] Package, install, and verify a real group in the installed app.
- [ ] Merge the verified branch into `integration/app-0753-running`.
