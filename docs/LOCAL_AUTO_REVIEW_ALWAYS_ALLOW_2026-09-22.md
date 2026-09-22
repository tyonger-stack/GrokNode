# Local Always allow repair — 2026-09-22

## Cause

The local classifier returned BLOCK for every action and supplied no proposedAllowRule. The renderer silently mapped Always allow to approved when a rule was missing or saving failed. The host persisted only approved, so reloaded cards displayed Allowed once. Saved rules were never consulted by the local classifier.

## Change

- Local shell review proposes a deterministic scoped rule. Matching binds the command, working directory, host/box surface, background/sandbox policy and executable-content enrichment. An implicit working directory additionally binds the conversation. Descriptions and timeouts do not widen the grant.
- Rules use the existing Auto-review settings store. The classifier reads live settings on each call. Removing the rule revokes it. Ask-first rules take priority; local review does not attempt to guess the meaning of natural-language exceptions.
- The desktop verifies the VM's settings echo before confirming persistence; failed writes remain actionable instead of granting allow-once.
- The approval service accepts always only when the pending request's rule is saved, then writes always into the transcript. The packaged renderer keeps Always allowed after reopening the conversation and reports save errors.
- No global Auto-review or local execution setting is disabled. Historical once-only cards cannot be converted into standing grants because the old implementation did not record which button was chosen.

## Evidence

Failing-first test: tests/local-always-allow.test.mjs initially failed for missing proposed rule and silent allow-once fallback. It now covers actual file persistence, simulated restart, different command/directory/surface/content, revocation, deny-first and persistence failures. The renderer's actual checksum-pinned approval functions are exercised in tests/auto-review-renderer-patch.test.mjs.

npm run check passed all 108 tests including the settings-echo regression. Frontend build, package checks and installed code signature passed. The build still verifies the upstream inventory and records original/patched hashes; the new approval chunk is explicitly allowlisted as assets/view-QqBtBG74.js.

Installed candidate: /Applications/Grok Node.app. Backup: the pre-change app bundle kept beside this repository. The final native UI check is pending: during restart macOS was locked, the main thread was waiting in SecItemCopyMatching, and the container still had the previous host hash. Unlock is required before claiming live Always allow validation. Do not confuse passing tests or updated app.asar with a running updated VM.
