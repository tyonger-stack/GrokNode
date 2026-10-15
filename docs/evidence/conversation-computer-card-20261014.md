# Conversation computer card: official 0.70.2 port — 2026-10-14

## Revision 5 — canonical cancellation trigger coverage (2026-10-15)

The earlier 7/7 run covered legacy resolution objects only with matching triggers. It did **not** establish that bare cancel/cancelled inputs or conflicting/missing triggers selected the correct resume branch, and must not be treated as an overall Source PASS. Independent source review found that gap; the main thread fixed the service's canonical trigger mapping. This sidecar changes tests and this report only.

The legacy fixture now executes nine inputs through the actual Coordinator dispatch/JSON command parser → Host API → session service → host ended-event listener → real isolated SQLite update. It asserts the complete ended event (agentId, requestId, resolution, trigger), the persisted boxResolution, and the actual arguments delivered to resumeAfterBoxHandoff. Prompt text is a supplementary check, not the branch-selection oracle.

| Input | Persisted boxResolution | ended.trigger and actual resume trigger |
| --- | --- | --- |
| string cancel | dismissed | dismissed |
| string cancelled | dismissed | dismissed |
| object {resolution: cancelled} | dismissed | dismissed |
| object {resolution: cancelled, trigger: button} | dismissed | dismissed |
| object {resolution: cancelled, trigger: dismissed} | dismissed | dismissed |
| object {resolution: completed, trigger: button} | handed_back | button |
| object {resolution: completed, trigger: cancel} | handed_back | button |
| object {resolution: handed_back, trigger: dismissed} | handed_back | button |
| string viewer-closed | handed_back | viewer-closed |

Recovery behavior is selected by the **actual canonical trigger forwarded by the host**, not inferred solely from resolution or from wording in a generated prompt. Every case uses a newly created DB and a request registered through the actual production provider. Case-level events and DB paths are recorded under `legacy-canonical-*` in `R4/registration-observations.json`.

Invocation: `PATH=/Users/Apple/Documents/grokbot/.tools/node-26/bin:$PATH node --test --test-reporter=tap tests/conversation-computer-card-registration.test.mjs`, repository cwd, output `R4/canonical-trigger-tests.tap`. There are seven top-level tests; the final test contains the nine-case canonical-trigger matrix above. The machine verdict's scope remains isolated tested source paths, not exhaustive source review, native UI, actual inference or VNC verification.

## Revision 4 — repaired production source positively connected (2026-10-15)

**The then-covered controlled source-chain scenarios passed.** This was not an overall Source PASS; the missing cancellation-trigger cases are addressed in Revision 5. The main thread repaired the production provider, runner lifecycle fallback and resolution codec. The sidecar executes the current provider and asserts the positive contract; it no longer expects a missing provider or incompatible completed values. Production source was not modified by this sidecar.

Current evidence root (R4): `/Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/.omo/evidence/conversation-computer-card-registration-20261015/`.

Invocation, repository cwd, Node 26.5.1:

```sh
export PATH="/Users/Apple/Documents/grokbot/.tools/node-26/bin:$PATH"
node --test --test-reporter=tap tests/conversation-computer-card-registration.test.mjs \
> .omo/evidence/conversation-computer-card-registration-20261015/tests.tap 2>&1
```

Result: **7 passed, 0 failed, 0 skipped**. `R4/registration-verdict.json` derives its acceptance flags from successfully executed positive scenarios and checks all recorded source hashes again at test end. `productionRegistrationConnected`, `createsCardsFromEmptyTranscript`, `completionWireCompatible`, `englishCatalogCorrect`, `registrationBeforePause`, `staleRequestProtected`, and `legacyInputsCompatible` are true. `overallFeatureAcceptance:true` is explicitly scoped to this isolated checkout-source execution; it is not a native packaged-app/model/VNC acceptance claim.

The fixture transpiles `host-runner-composition.ts`, extracts the actual `createTurnToolsetFactoryProvider` body plus its actual `method` helper, and executes them in a VM. It supplies real session handoff/SQLite/transcript/event/gateway implementations and controlled boundaries for screenshots, lifecycle pause, transport and inference. **There is no hand-written replacement createRequestBoxHelpToolInputs or registration dependency implementation.** The original returned box-help factory is copied by identity into the real per-turn factory projector; unrelated factories are not executed because their separate live services are outside this test.

| Positive scenario | Required observable | Captured artifact |
| --- | --- | --- |
| Actual provider on ordinary Bot B | Real request_box_help is offered; explicit agentId B wins over deliberately different factory session.id; shared rooms and subagents exclude it | R4/production-provider.txt, R4/registration-observations.json |
| A/B begin with empty actual SandAgentDb transcripts | Actual tool creates distinct requests, matching pending statuses/snapshots and durable boxRequestId/boxInstruction; protocol projection and PV show waiting cards | R4/registered-A.html, R4/registered-B.html, isolated SQLite DB paths in R4/registration-observations.json |
| Dbn takeover while another Bot was selected | Exact owner selected/ensured; original computer overlay target; zero handoff end events | R4/registration-observations.json |
| Real Coordinator dispatch → command parser → Host API → session service → host event listener → SQLite | Done writes handed_back; Skip writes dismissed; refreshed PV shows 完成/已跳过 rather than 状态不可用; hidden resume targets the correct Bot and carries correct completion/decline prose | R4/resolved-A.html, R4/resolved-B.html, R4/registration-observations.json |
| endRequested, scoped-turn callback and builtRunner fallback | Direct endTurn has zero side effects; first request stages are start/started/emit/persisted/pause; pause asserts the pending request already has a durable transcript entry; ackToken and boxHandoff metadata survive | R4/registration-observations.json, registration-before-pause-turn/fallback scenarios |
| Duplicate request in each pause path | Stages are start/already-pending/pause, no second emit or persistence, exactly one DB entry | Same ordering scenarios |
| Retained callback after a new request | Both old actions return false; second request remains pending | R4/registration-observations.json |
| Legacy completed/cancelled inputs with their matching button/dismissed triggers | Renderer-compatible handed_back/dismissed persistence and matching hidden-resume semantics | R4/registration-observations.json |
| English PV | Actual output contains Action needed/Take over, not Italian | R4/english-catalog-corrected.html |

The producer's `endTurn` now only sets endRequested; `onSendMessage` emits metadata first and pauses afterward. Already-pending requests pause in requestHelp without sending a duplicate card. The fallback invokes the real production method name `builtRunner.endTurnAwaitingUser`; the fixture records that boundary and asserts durable ordering. It does not execute an actual model stream or assert native controller cancellation. Main-thread NativeQA remains responsible for that runtime surface.

The source fixes supersede the historical recommendations below. In particular, the main thread's runner lifecycle fallback is the implemented route; the earlier proposed mandatory adapter callback is **not** an outstanding requirement. English provenance and bilingual verification in Revision 3 remain valid.

## Revision 3 — pre-repair registration audit and English correction (historical, 2026-10-15)

**At this pre-repair snapshot, production acceptance was not satisfied.** The sidecar executed real registration/persistence/projection functions against newly created isolated SQLite databases, not pre-existing user cards. It identified a missing production tool binding and incompatible completion values, subsequently repaired by the main thread and positively verified in Revision 4. This sidecar fixed the separate English-catalog error and verified that all Chinese labels remained unchanged.

### Real Node chain and observed gaps

The actual tool is `request_box_help` / `REQUEST_BOX_HELP`, implemented in `source/host/runner/tools/box-help-tool.ts:75`; the searched source does not use `requestHumanAssistance` or `toolhuman_loop` as this tool's contract. Parameters are instruction plus optional reason/domain/idp_domain. Its `getAgentId()` determines the requester, and it emits a text message with separate `{requestId,instruction}` metadata.

The existing path is:

1. `createTurnToolsetFactoriesForTurn` → `createTurnBoxHelpToolFactory` → `buildTurnTools` (ordinary desktop-enabled parent conversations; shared rooms/subagents are excluded).
2. `BoxHandoffService.start` in `source/host/extensions/session/box-handoff-service.ts`: per-agent pending map, UUID, duplicate suppression, snapshot, lifecycle events.
3. `SandHost.wireBoxHandoffEvents` and `decorateForeverBoxStatus` in `source/host/sand-host.ts`: awaiting state and gateway status `handoff` from the **session service**. The unused transcript-local `BoxHandoffResume.boxHandoffs` map is not the production registration owner.
4. The tool's `onSendMessage` must emit `{type:"send-message",message,timestampMs,boxHandoff}`. `TurnRuntime.handleAgentUpdate` → `stampBoxRequestEntry` → `SendPipeline`/`SessionRuntime` creates a persistent `kind:"send-message"` entry with top-level `boxRequestId` and `boxInstruction`; background sessions write their own DB directly.
5. Coordinator `proxifyForeverBoxStatus` preserves handoff metadata. The transcript card protocol preserves entry fields. Patched `Dbn` → `Obn` → PV consumes the same request and owner.
6. Renderer action → `CoordinatorGatewayClient.dispatchCommand("handBackForeverBox",{id,trigger})` → `SAND_GATEWAY_COMMANDS` → `createHostGatewayApi` → session `endHandoff` → actual host ended-event listener → `resolveBoxRequestEntry` → DB `boxResolution`, followed by status broadcast and hidden resume.

**Gap A:** `source/host/host-runner-composition.ts:2057` defines `createTurnToolsetFactoryProvider`, but its returned object lacks `createRequestBoxHelpToolInputs`. The test transpiles and executes that actual producer, records its returned keys, and runs the actual relevant factory projection/builder. The tool is absent without that input and present when the dependency slot is explicitly supplied. The existing `runnerOptions.boxHandoff.requestHelp` at ~1439 does not populate this slot. **No new server registration service is needed.**

**Gap B:** `source/host/extensions/session/box-handoff-service.ts:17` maps both `button` and `dismissed` to `completed`. Actual coordinator → host → service execution persisted `completed` for both actions. Reloaded PV renders 状态不可用. Renderer/transcript contract is `handed_back` for completion, `dismissed` for skip (and `replied` for reply-based resolution); `completed/cancelled` are not valid persisted card states. The correct mapping already exists in `source/shared/forever-box.ts`; this session service duplicates it incorrectly. Hidden resume still receives the original trigger and correctly distinguishes decline from completion, so fix the resolution codec without changing trigger semantics.

**Waiting-control prerequisite:** `TurnToolsetTurnInput.endThisRunAwaitingUser` is optional and currently only copied through the scope. `source/host/runner/production-turn-run-shell-adapter.ts` does not supply it when it calls `input.createOwner`. The capability probe records `endTurn` at a controlled boundary; it does not claim an actual model stream was suspended. Production must wire this callback instead of using a no-op.

### Minimal production diff recommendations (not applied by this sidecar)

In `host-runner-composition.ts`, add one property to `createTurnToolsetFactoryProvider`:

```ts
createRequestBoxHelpToolInputs: turn => {
  const start = method(extensions.api("session"), "startHandoff");
  const end = turn.endThisRunAwaitingUser;
  const emit = turn.emitUpdate;
  if (start === undefined || end === undefined || emit === undefined) {
    throw new TypeError("scoped box handoff inputs are not bound");
  }
  return { dependencies: {
    getAgentId: () => agentId,
    endTurn: () => end("box-help"),
    requestHelp: async request => start(request),
    onSendMessage: (message, timestampMs, boxHandoff) => emit({
      type: "send-message", message, timestampMs, boxHandoff,
      ...(turn.ackToken === undefined ? {} : { ackToken: turn.ackToken }),
    }),
  } };
},
```

In `production-turn-run-shell-adapter.ts`, extend the `createOwner` input with `endThisRunAwaitingUser`. Supply a closure over that preparation's `updateRelay` that verifies `activePrepared === updateRelay.prepared` and callbacks exist, then calls `updateRelay.callbacks.pauseForUser(reason)`. Forward it after `...createAgentOwnerInput(...)` into `createProductionTurnAgentOwner`. The existing owner/scope/tool-hook forwarding already carries the field. Do not borrow a mutable selected runner's pause callback. These provider and waiting-control changes must land together.

In `box-handoff-service.ts`, normalize output resolutions at the service boundary while retaining the original trigger:

```ts
const triggerName = typeof trigger === "string" ? trigger : trigger.trigger ?? "unknown";
const declined = typeof trigger === "string"
  ? trigger === "dismissed" || trigger === "cancel"
  : trigger.resolution === "cancelled" || triggerName === "dismissed";
return {
  kind: "end", requestId: pending.requestId,
  resolution: declined ? "dismissed" : "handed_back",
  trigger: triggerName,
};
```

Keep the existing `pending == null` early return. No coordinator RPC/schema addition is needed: the actual command route already exists and was executed. These are source-backed proposed diffs, not a claim that the production run/pause integration has been tested after applying them.

### English locale correction — implemented

The old extraction incorrectly selected the first locale with `9lzViG = Computer`, which also matches Italian. This was an error in the earlier English evidence claim. Official English is embedded in **`dist/renderer/assets/index.eager-app-fbmFpqqH.js`**, not in the translated `chunk-core-*` files.

- Source: `/Applications/Grok Bot.app/Contents/Resources/app.asar` → `dist/renderer/assets/index.eager-app-fbmFpqqH.js`, 1,769,318 bytes, SHA-256 **`c154230504706d39146b2f5795cff412b51a195526236a487f1097e7a3ce750f`**.
- Chinese source: `dist/renderer/assets/chunk-core-DLLz6F9_.js`, 79,362 bytes, SHA-256 **`9db595068d6ac32dc2ee8d885f4f9bee0d5f77e66b101dc9bcfc81977664e4a6`**.
- Corrected all 13 English entries from those exact installed bytes; all 13 Chinese values compared equal before/after. Repeated English message IDs were accepted only when every occurrence had the same value.
- Key English byte anchors: yqwjpd=Take over @152226; 7U5F+i=Action needed @84101; s8Hj9A=I'm done @143933; D2AZQg=Something went wrong. Try again. @13313/40196/90610; PS2Itk=Status unavailable @47808/106481.
- Evidence: `E/english-locale-correction.json` contains every msgid, exact English/Chinese value, offsets and member hashes. `E/locale-dom-states.json` contains six actual SSR outputs covering both languages. `E/english-fix-tests.tap` records **16 passed, 0 failed, 0 skipped** for the card and preview suites.

### Registration execution evidence and limits

New test: `/Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/tests/conversation-computer-card-registration.test.mjs`.
Registration evidence root (R): `/Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/.omo/evidence/conversation-computer-card-registration-20261014/`.

Invocation: `PATH=/Users/Apple/Documents/grokbot/.tools/node-26/bin:$PATH node --test --test-reporter=tap tests/conversation-computer-card-registration.test.mjs`, repository cwd. The current five probes pass as **diagnostic/capability tests**, not as proof of complete production feature acceptance. `R/registration-verdict.json` explicitly records `overallFeatureAcceptance:false` until the main-thread source repairs land.

| Executed scenario | Binary observable | Artifact |
| --- | --- | --- |
| Actual production provider body and tool projection | Missing requestBoxHelp property; empty handoff tool slot; explicit slot produces the tool; shared-room/subagent gates exclude it | R/production-provider.txt, R/registration-observations.json |
| Actual request_box_help invocation from empty A/B SQLite DBs | Two distinct request IDs; real persisted boxRequestId/boxInstruction; matching pending status/snapshot; both PV waiting cards render; duplicate A request emits no extra entry | R/isolated-*/A/store.db, R/isolated-*/B/store.db, R/registered-A.html, R/registered-B.html |
| Actual Dbn takeover after B selected | Select/ensure exact owner; no handoff end event | R/registration-observations.json |
| Actual Coordinator command parser → Host API → session service → host listener → DB update | Both triggers currently persist completed; expected handed_back/dismissed comparison is false; refreshed PV shows 状态不可用 | R/resolved-A-contract-mismatch.html, R/resolved-B-contract-mismatch.html, R/registration-observations.json |
| Actual hidden-resume function with recording runner boundary | Done says handed back; Skip says dismissed/declined, with the correct agent ID | R/registration-observations.json |
| Old callback after second real registration | Both old actions return false; second request stays pending | R/registration-observations.json |
| Corrected English PV | Action needed and Take over, no Italian labels | R/english-catalog-corrected.html |

The probe bundles the real checkout modules into `R/registration-source.cjs`. It executes the actual service, event bus/host listeners, tool/factory code, TurnRuntime/SendPipeline/SessionRuntime, SandAgentDb, coordinator dispatch and parser, card projection and PV. Transport, screenshots, inference, and roster notifications are controlled recording boundaries. No real model request, user transcript, UI, container, packaging, installation or Git mutation occurs. Source hashes are captured and checked again at test end to detect concurrent edits. The test deliberately fails its diagnostic assertions if main-thread production repairs change the observed defect; then promote those assertions to the repaired contract rather than interpreting the old defect snapshot as current evidence.

## Revision 2 result

This revision supersedes the initial owner-only report. The implementation now ports the actual official PV card and the card/button/text/icon-container/spinner recipes it consumes. **Elevated surface, button hierarchy, pending/failed feedback, completion disclosure, bubble status presentation, and light/dark declarations are implemented.** They are no longer remaining differences.

Implementation paths:

- /Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/scripts/lib/conversation-computer-card-renderer-patch.mjs
- /Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/tests/conversation-computer-card.test.mjs
- /Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/docs/evidence/conversation-computer-card-20261014.md

Evidence root (E): /Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/.omo/evidence/conversation-computer-card-20261014/.
The stop-hook receipt must instead be under the task cwd: /Users/Apple/Documents/grokbot/.omo/evidence/. The earlier invalid receipts were a directory mismatch, not missing test output. No active attempt exists; see E/loop-status.json.

## Official behavior now present

The default transcript card uses the elevated surface selected by official Ig when sand_widget_v0 is enabled. The outer existing Lve changes from tab to question, as official UV does. Old y1.questionCardWrap and official questionCardWrap have identical recipes.

Waiting elevated card:

1. Laptop/titlebar label 电脑.
2. Needs-action heading and supplied instruction.
3. Full-width 16:9 computer thumbnail, black frame, desktop-icon fallback, click-to-open.
4. Footer in official order: 跳过 secondary, 我完成了 secondary, 接管 primary.
5. Pending completion disables Done and Skip, gives Done an aria-busy spinner, and leaves takeover available.
6. Failed completion shows 出错了，请重试。 in a role=alert; actions become available for retry.

Successful completion locally resolves to handed_back or dismissed. The resolved elevated card collapses into the official titlebar summary; its native disclosure button exposes aria-expanded / aria-controls and expands the instruction and 打开电脑 action. Replied uses the quiet instruction summary. Unknown status uses the official unavailable badge/summary.

The bubble branch also follows PV: waiting uses primary Take over, outlined Done, ghost Skip; pending disables Done/Skip, failure shows its alert, resolved states remove the thumbnail and show Open computer. Replied is quiet rather than an Answered badge. The auth explanation uses official iMe and its official message.

Official CSS includes the 24px elevated radius, card shadow, frame inset/ratio, title/header/footer spacing, large button geometry, hover/active/focus declarations, pending content/spinner declarations, typography and status colors. All style rules are scoped under .r-conversation-computer-card; declarations are copied from the official stylesheet. Existing global renderer styles remain untouched. Light/dark semantic values are evaluated from the official pure theme functions, and the four referenced legacy --cursor text aliases are copied from official VO. Old app theme names cursor-light/cursor-dark select these values. Shared runtime font weights remain user-controlled through the old Lzn path.

## Ownership and protocol semantics

The original renderer already had Hbn's basic snapshot card. Its Dbn contextual branch returned no-op actions; the alternate Yte registry was published from the currently selected chat. The replacement uses Mee(), the actual transcript context agentId, then existing NTn(owner), MTn(owner), and Obn. There is no pee()/selected-Bot fallback.

Takeover captures owner and subagentId, selects the owner, waits for readiness, verifies selection was not superseded, opens the original Dzn interactive overlay with the subagent focus, and ensures that target. It does not complete a request or change sleep state.

Done and Skip retain foreverBox.handBack(target, "button" | "dismissed"). Before dispatch they compare the live handoff requestId with the captured card requestId. A stale request returns false and cannot locally complete a newer request. Rejections reach the card feedback state instead of being swallowed. Local attempt/resolution state is keyed by owner + subagentId + requestId, so a late result from unmounted A cannot resolve B. The waiting-state guard and pending ref prevent repeated dispatch. Recorded transcript resolution takes precedence over a stale pending handoff, as in official vqe.

The CIn memo now observes the card object rather than only its instruction; owner/request/reason changes therefore reach Hbn. The old Hbn body remains under RConversationLegacyCard only to preserve the existing fail-closed i18n literal anchors. The live callsite uses the new Hbn. Card-label transforms have been run against the real i18n patch engine.

## Thumbnail decision

Old handoffs carry snapshotDataUrl. Obn preserves the exact request snapshot, and the new PV bridge displays that same image without rewriting the URL. The bridge records the actual target owner on the frame. Missing image data still uses the official desktop icon.

Official 0.70.2 instead reads retained frames keyed by [agentId, src] through bqe/ife and registers frames through hqe. **A new stream is unnecessary to retain the old card's existing image-data semantics.** This port intentionally uses the supplied request snapshot; it does not claim a continuously refreshing thumbnail. No global stream or new preview subscription is introduced, and no sleep exception is needed. Existing visible interactive sessions continue while per-Bot preview sleep remains in effect.

## Direct installed-source evidence

All reference members were read with @electron/asar from /Applications/Grok Bot.app/Contents/Resources/app.asar into E/official/. Version is 0.70.2. The new audit re-extracts the selected installed members and verifies their full bytes, then checks **103 exact source spans and 388 original CSS rules**. It also re-evaluates official theme functions and checks the emitted theme/legacy declarations.

- E/provenance.json: original ASAR identity, member hashes, old/new binding anchors.
- E/pv-port-provenance.json: full source-span identities and CSS declaration excerpts.
- E/pv-source-audit.json and E/pv-source-audit.log: fresh installed-ASAR checks and theme values.
- E/official/index-Dve5Ol5U.css: actual installed stylesheet.
- E/rea-complete.json: previous complete 101 MB REA static analysis of the selected extracted subset.
- E/rea-summary.json: retained REA limitations.
- REA ID: ev_ba8e2231b17f9da01db3637c2a9f37d99df719a74c87f9d70cf040dc70a1e7c7.

Offsets below are zero-based UTF-8 bytes, not JavaScript character indices:

| File | Symbol / call | Offset | Bytes |
| --- | --- | ---: | ---: |
| index-CjjO5fU0.js | PV | 1339134 | 8193 |
| index-CjjO5fU0.js | vi card surface | 261981 | 660 |
| index-CjjO5fU0.js | vr header | 266371 | 2143 |
| index-CjjO5fU0.js | hp footer | 272270 | 676 |
| index-CjjO5fU0.js | mp titlebar/disclosure | 263300 | 2921 |
| index-CjjO5fU0.js | zn native kit button | 282495 | 2389 |
| index-CjjO5fU0.js | Hn bubble button | 250467 | 2957 |
| index-CjjO5fU0.js | _a card recipes | 260451 | 1019 |
| index-CjjO5fU0.js | cs button recipes | 278940 | 2600 |
| index-CjjO5fU0.js | sMe scoped binding | 1336701 | see provenance |
| index-CjjO5fU0.js | sMe(c,u,d.handoffActions) | 1369193 | see provenance |
| index.eager-app-fbmFpqqH.js | Yc typography | 570501 | 891 |
| index.eager-app-fbmFpqqH.js | XX spinner | 677904 | 925 |
| index.eager-app-fbmFpqqH.js | vqe resolution precedence | 970864 | see provenance |
| index.eager-app-fbmFpqqH.js | bqe / ife / hqe frame pool | 970656 / 970228 / 969167 | see provenance |

Official labels come from installed English and Simplified Chinese core catalogs, including 9lzViG, 7U5F+i, yqwjpd, s8Hj9A, 6Uau97, D2AZQg, DPfwMq, 9NyAH9 and PS2Itk. The complete label table is carried inside the factory. The native old icon renderer is the adapter for matching laptop/device-desktop/chevrons-up-down glyphs; no invented SVG is used.

Pinned baseline: /Users/Apple/Documents/grokbot/.tmp-app-verify-20261013/src/app/dist/renderer/assets/index-UbX-y3il.js.
SHA-256: ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa.

## Validation and artifacts

Run from /Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed with Node 26.5.1:

```sh
export PATH="/Users/Apple/Documents/grokbot/.tools/node-26/bin:$PATH"
COMPUTER_CARD_BASELINE=/Users/Apple/Documents/grokbot/.tmp-app-verify-20261013/src/app/dist/renderer/assets/index-UbX-y3il.js \
COMPUTER_CARD_EVIDENCE=.omo/evidence/conversation-computer-card-20261014 \
node --test --test-reporter=tap tests/conversation-computer-card.test.mjs tests/computer-preview-stream.test.mjs \
> .omo/evidence/conversation-computer-card-20261014/pv-tests.tap 2>&1
node .omo/evidence/conversation-computer-card-20261014/audit-port.mjs --verify-only \
> .omo/evidence/conversation-computer-card-20261014/pv-source-audit.log 2>&1
```

**15 passed, 0 failed, 0 skipped.** Twelve card tests and three existing preview tests. DOM tests run actual React/compiler-runtime with Happy DOM and the pinned renderer's real styleq/Fe implementation; service boundaries and native icon output are stubbed. No actual desktop UI, browser, container, message, package build or Git operation is involved.

| Criterion / exact scenario | Binary observable | Artifact |
| --- | --- | --- |
| Two mounted conversations, identical entry IDs; invoke B then retained A callback | distinct image URLs; exact B then A select/ready/open/ensure calls | E/scenarios.json; E/pv-tests.tap |
| Child card under parent | select parent, focus child, ensure child; zero completion on takeover | E/scenarios.json |
| Context card; stale request vs matching request | zero stale handBack calls; exact button/dismissed calls for matching request | E/scenarios.json |
| Missing owner / ordinary message / superseded or failed selection | null non-card; no incorrect overlay open | E/scenarios.json |
| Recorded resolution with lingering handoff | handed_back remains resolved; no completion dispatch | E/scenarios.json |
| Elevated waiting DOM | title/description/image, Skip/Done/Take over order and secondary/secondary/primary variants | E/dom-states.json: elevated-waiting-light |
| Pending, rejection, retry | Done busy+disabled; Skip disabled; Take over enabled; one dispatch; alert on rejection; retry resolves | E/dom-states.json: elevated-pending, elevated-failed |
| Resolved disclosure | collapsed false → expanded true, valid controls ID, instruction and Open computer | E/dom-states.json: elevated-completed-collapsed/expanded |
| A pending then B mount then A resolves | B image/owner remain B; B stays waiting and enabled | E/dom-states.json: owner-change-late-A-result |
| Skip on B | dismissed trigger; collapsed 已跳过 summary | E/dom-states.json: elevated-skipped-dark |
| Bubble pending/failure/fallback/statuses | primary/outline/ghost hierarchy; correct disabling, alert; no resolved thumbnail; replied quiet | E/dom-states.json: bubble-* |
| Official visual declarations | computed radius 24px, frame ratio 16 / 9, light #ffffff, dark #1f1f1f; scoped stylesheet | E/dom-states.json; E/scenarios.json |
| Scope, drift, composition, i18n | anchors fail closed; unrelated bytes preserved; preview composition byte-identical; real i18n transforms parse | E/scenarios.json; E/pv-tests.tap |
| Staged adapter | emitted JS/CSS bytes and both input/output hashes verified | E/staged/dist/renderer-conversation-computer-card-extension.json; E/staged/dist/renderer/assets/ |
| Installed reference audit | 103 span hashes, 388 stylesheet rules, both palettes and four legacy mappings match installed source | E/pv-source-audit.json; E/pv-source-audit.log |

Happy DOM caches ancestor selectors after a theme attribute change, so dark computed values are asserted on a fresh mounted tree. This validates both initial palettes, not native live theme-switch rendering. Browser pixel/layout/input verification is intentionally outside this user's no-UI/no-package authorization.

## Main-thread integration

The existing API is retained:

```js
await applyOriginalRendererConversationComputerCard({ appRoot: stageRoot });
```

The adapter now also requires exactly one main index-*.css beside the pinned entry and appends the scoped official CSS. Run before i18n and final hash accounting. The version-2 provenance includes originalSha256/patchedSha256 for JS and a css object with the stylesheet path and its two hashes. Include both in final renderer hash accounting. Pure JS API remains patchConversationComputerCard(source); the exported CONVERSATION_COMPUTER_CARD_CSS is available to a caller that stages files itself.

No edits to clean-build, preview/sleep scripts, or avatar work are required by this port. The wrapper preserves visible interactive VNC sessions through the existing overlay. The native old title/disclosure parent lacks the new optional header-registration context, so the port supplies local unique accessible IDs and native disclosure state without introducing a second transcript navigation system.

## Actual protocol/data limits

- Old handoffs provide request snapshots, not the official held-frame screen source; continuously refreshing previews are not represented by this snapshot contract. Existing image semantics are retained as described above.
- A historical record that has lost subagent identity cannot reconstruct that identity from the old protocol. It reopens its known transcript owner; it never guesses the currently selected Bot.
- Native coordinator/VNC reachability and pixel output have not been exercised under the explicit no-UI/no-package constraint. Supported style/state behavior is ported and tested, rather than left as an unknown implementation gap.
