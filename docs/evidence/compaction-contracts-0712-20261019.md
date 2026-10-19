# 0.71.2 compaction contracts port

Date: 2026-10-19

## Reference and scope

The user-selected reference checkout is `/Users/Apple/Documents/grokbot/grok-bot-port-0712`, branch `port/0712`, commit `1832947`. Its readable `source/packages/agent/index.ts` still passes `undefined` as the self-summarizer factory. Copying that file would remove the local self-compaction path, so the factory and delivery behavior were checked against the saved official 0.71.2 host as well.

Official snapshot: `/Users/Apple/Documents/grokbot/rea-grokbot-0712/box/sand-host/host-main.cjs`.

SHA-256: `b92864f495399473531557720188aec5739e828ec7c527ee4dd136755fb9c607`.

The snapshot README identifies this host as build `726deab`. The source anchors below were read directly. REA's whole-bundle analysis timed out after 45 seconds and retained partial evidence `ev_85d1b2206a7771c61892e59dfce04ceb12645b4419ab0d8201c0ffee5c8e0faf`; no complete graph or runtime parity claim is based on that analysis.

## Source correspondence

| Official host anchor | Ported behavior |
| --- | --- |
| `resolveSelfSummaryFlavor`, line 604723 | Resolver callback precedes configured flavor; fallback is `generic`. |
| Agent factory, lines 648102-648147 | Factory exists only with configuration; shared retry defaults and description properties reach the selected handler; startup callback runs for each selection. |
| Factory switch, lines 648113-648140 | xAI, OpenAI, explicit Anthropic and generic branches; provider-specific empty-response retry defaults. |
| `selectUserDeliveryTail`, lines 578436-578485 | Match answered delivery calls by ID, keep the newest configured number, preserve chronological pairs, message ID and privacy mode, unwrap arguments with `PrivacyCapability.UNSAFE_ALWAYS_ALLOWED`. |
| `selectSelfSummaryDeliveryTail`, lines 601683-601689 | Preserve delivery pairs only for configured triggers and only after the last non-summary user message. |
| `XaiCompactionHandler.partitionMessages`, lines 628831-628862 | Skip synthetic wakeups and summary messages; preserve real user or agent-message turns and attach the delivery tail. |

## Contract repairs

The eight compiler diagnostics came from three inconsistent contracts:

1. Host background-compaction overrides were typed as the literal default object (`0.2`, `0.1`, `true`) rather than `BackgroundSummarizationProps`.
2. The orchestrator, factory and handlers declared different state, listener, tool and summary-result interfaces. They now share the real self-summary state/listener/tool contracts and return `SummarizationResult`.
3. Message selectors assumed narrow provider metadata and claimed to synthesize arbitrary caller subtypes. They now consume the actual redacted message carrier, narrow unknown cursor metadata, and return redacted delivery messages without subtype assertions.

The pipeline options no longer require an unrelated arbitrary-property index signature. Explicit fields cover the enrichment data used by the pipeline.

## Local compatibility

The local host explicitly selects xAI with the generalized prompt and supplies `SAND_COMPACTION_DELIVERY_TAIL`. This preserves the existing local choice while the reusable factory follows the official generic default. Existing `self-summary` and `anthropic-compact` flavor aliases remain accepted; `anthropic-explicit` follows the official explicit branch. The existing local provider context-window lookup and oversized-request preflight remain in place.

This port covers the contracts, factory routing, retry configuration and delivery retention involved in the eight diagnostics. It is not a claim that every provider prompt, cloud gate or transport is identical to the official host.

## Validation

- The original full source typecheck reproduced all eight diagnostics before edits.
- `npm run source:typecheck` passes after the port.
- The focused compaction/provider suite passes 38 tests.
- `tests/compaction-contracts.test.mjs` runs all four real compaction handlers through their summary pipelines using a deterministic model-executor boundary. It checks usage, persistence callbacks, description properties, delivery pairing and privacy retention.
- No `as any`, `as unknown`, `@ts-ignore` or `@ts-expect-error` was added to bypass the contract errors.
- Frontend typecheck and the production host build also pass; host activation reports `validated-clean-source`.
- Full test run with local networking allowed: 1,946 tests, 1,926 passed, 19 skipped, 1 failed. The failure is `tests/library-merge.test.mjs:49` (date-group counts: actual `today: 6, week: 1, older: 1`; expected `today: 5, week: 1, older: 2`). That library grouping path was not changed in this compaction port.
- The initial sandboxed `npm run check` encountered `listen EPERM` for loopback servers. The test suite was rerun with local networking allowed and a 60-second test timeout; the completed result above contains no timeout failures.
- This task changes source and produces a validated host bundle at `/private/tmp/eggbot-0712-compaction-fixed/dist/host/host-main.cjs`; it does not replace the installed application.

## Deployment follow-up (2026-10-19)

At the user's explicit request, the updated source was packaged and installed into `/Applications/Grok Node.app`, then the desktop was restarted. Package verification and strict deep signature verification passed; all 101 renderer scripts passed syntax checks.

- Installed ASAR SHA-256: `adaab3bcf3866ae6862bcd0f2fb76770649293370330f48e24ee5981710cf456` (identical to the packaged ASAR).
- Host SHA-256: `3e7b5c42caf6bf50d0f466df2ad453b22a07236e5a6be6eec4fc0d1c052edeab` (identical in the validated build, installed ASAR and running container).
- Previous application backup: `/Users/Apple/Documents/grokbot/backups/Grok Node-before-compaction-contracts-20261019T090448.app`; its ASAR was checked against the previous installed app before replacement.
- Native desktop QA showed the deployment probe and dr eggbot's actual reply `收到` (`t332u` -> `t332s0`). The host health endpoint returned `ok: true`, and the turn report was empty after verification.
- A main-Bot `InstallPlugin` call remained running during the deployment grace period. The application was then restarted to complete the requested deployment. That unfinished plugin-installation workflow needs to be continued in its original chat; this deployment did not replay it.

## Pre-commit verification follow-up (2026-10-19)

When grouping all pending work for commits, the library regression above was traced to timestamp inheritance being applied to every unstamped entry instead of legacy `user-attachment` records only. The fallback now applies only to those uploads, with a regression proving that unstamped Bot artifacts remain undated; the original golden was preserved. Both typechecks pass. The complete suite now reports 1,977 tests: 1,958 passed, 19 skipped, 0 failed (`/private/tmp/groknode-submit-full-tests-20261019.log`). This follow-up validates source changes and does not redeploy the application.
