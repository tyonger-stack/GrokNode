import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCleanDistribution as buildBaseCleanDistribution,
  buildFidelityDistribution as buildBaseFidelityDistribution,
  buildReconstructedAsar as buildBaseReconstructedAsar,
  cleanBuildDir,
  fidelityCleanBuildDir,
  fidelityRuntimeComposition,
  overlayCleanDistribution,
  packStagedAppWithIntegrity,
  runtimeComposition,
} from "./lib/clean-build.mjs";
import { buildAsar } from "./lib/build-asar.mjs";
import {
  builtAsar,
  builtAsarUnpacked,
  fidelityBuildDir,
  fidelityBuiltAsar,
  fidelityBuiltAsarUnpacked,
  fidelityStagedAppDir,
  repoRoot,
  stagedAppDir,
} from "./lib/config.mjs";
import { compositionAuditPath, writeRuntimeCompositionAudit } from "./audit-runtime-composition.mjs";
import {
  buildProductionHostIfSupplied,
  hostBindingProvenancePath,
} from "./host-production-activation.mjs";
import {
  buildProductionElectronMainIfSupplied,
  electronMainBindingProvenancePath,
} from "./electron-main-production-activation.mjs";
import { applyOriginalRendererRouterPatch } from "./lib/router-renderer-patch.mjs";
import { applyOriginalRendererMemoryImport } from "./lib/agent-memory-import-renderer-patch.mjs";
import { applyOriginalRendererLibraryStageClose } from "./lib/library-stage-close-renderer-patch.mjs";
import { applyOriginalRendererSidebarTopBarSearch } from "./lib/sidebar-search-renderer-patch.mjs";
import { applyOriginalRendererChatHeaderIdentity } from "./lib/chat-header-identity-renderer-patch.mjs";
import { applyOriginalRendererActivityLabelVisibility } from "./lib/activity-label-visibility-renderer-patch.mjs";
import { applyOriginalRendererSelectionAddToPrompt } from "./lib/selection-add-to-prompt-renderer-patch.mjs";
import { applyOriginalRendererSkillDetail } from "./lib/skill-detail-renderer-patch.mjs";
import { applyOriginalRendererTeachSuccessPath } from "./lib/teach-success-path-renderer-patch.mjs";
import { applyOriginalRendererInfoPaneSplit } from "./lib/info-pane-split-renderer-patch.mjs";
import { applyOriginalRendererAgentModel } from "./lib/agent-model-renderer-patch.mjs";
import { applyOriginalRendererAgentDataCards } from "./lib/agent-data-cards-renderer-patch.mjs";
import { applyOriginalRendererComputerUpdate } from "./lib/computer-update-renderer-patch.mjs";
import { applyOriginalRendererLanguagePatch } from "./lib/language-renderer-patch.mjs";
import { applyHardwareAccelerationSettingsPatch } from "./lib/hardware-acceleration-settings-patch.mjs";
import { applyOriginalRendererSettingsI18n } from "./lib/settings-i18n-patch.mjs";
import { applySettingsUpdate0753Patch } from "./lib/settings-update-0753-patch.mjs";
import { applyMessageCopy0753Patch } from "./lib/message-copy-0753-patch.mjs";
import { applyReplyComposer0753Patch } from "./lib/reply-composer-0753-patch.mjs";
import { applyReplyTarget0753Patch } from "./lib/reply-target-0753-patch.mjs";
import { applyEmojiLocale0753Patch } from "./lib/emoji-i18n-0753-patch.mjs";
import { applyPromptCta0753Patch } from "./lib/prompt-cta-0753-patch.mjs";
import { applyVaultSettingsRenderer0721 } from "./lib/vault-settings-renderer-patch.mjs";
import { applyRecipientPicker0755Patch } from "./lib/recipient-picker-0755-patch.mjs";
import { applyGroupAuthor0755Patch } from "./lib/group-author-0755-patch.mjs";
import { applyOriginalRendererMainI18n } from "./lib/main-i18n-patch.mjs";
import { applyOriginalRendererExtraI18n } from "./lib/extra-i18n-patch.mjs";
import { applyUpdatePillCopy0755Patch } from "./lib/update-pill-copy-0755-patch.mjs";
import { applyTeachGateRestorePatch } from "./lib/teach-gate-restore-patch.mjs";
import { applyGrokMainAgentGatePatch } from "./lib/grok-main-agent-gate-patch.mjs";
import { applyBotColorGatePatch } from "./lib/bot-color-gate-patch.mjs";
import { apply0712GateEcosystemPatch } from "./lib/0712-gate-ecosystem-patch.mjs";
import { applyMainAgentRendererPatch } from "./lib/main-agent-renderer-patch.mjs";
import { applyBotCreateDialogRendererExtension } from "./lib/bot-create-dialog-renderer-extension.mjs";
import { applySearchPaletteRendererPatch } from "./lib/search-palette-renderer-patch.mjs";
import { applyBotColorRendererPatch } from "./lib/bot-color-renderer-patch.mjs";
import { applyBotColorSettingsPatch } from "./lib/bot-color-settings-patch.mjs";
import { applyComputerSleepRendererPatch } from "./lib/computer-sleep-renderer-patch.mjs";
import { applyComputerControlRendererPatch } from './lib/computer-control-renderer-patch.mjs';
import { applyShapePickerPatch } from "./lib/shape-picker-patch.mjs";
import { applyOriginalRendererConversationComputerCard } from "./lib/conversation-computer-card-renderer-patch.mjs";
import { applyOriginalRendererAppLinkCards } from "./lib/app-link-card-renderer-patch.mjs";
import { applyOriginalRendererServerPortCards } from "./lib/server-port-cards-renderer-patch.mjs";
import { applyOriginalRendererWaitingOnResults } from "./lib/waiting-on-results-renderer-patch.mjs";
import { applyOriginalRendererViewUnread } from "./lib/view-unread-renderer-patch.mjs";
import { applyOriginalRendererScrollToBottom } from "./lib/scroll-to-bottom-renderer-patch.mjs";
import { applyOriginalRendererDownloadAll } from "./lib/download-all-renderer-patch.mjs";
import { applyOriginalRendererUndeliveredSend } from "./lib/undelivered-send-renderer-patch.mjs";
import { applyOriginalRendererReadFailureRetry } from "./lib/read-failure-retry-renderer-patch.mjs";
import { applyOriginalRendererSidebarRenameMenu } from "./lib/sidebar-rename-menu-renderer-patch.mjs";
import { applyDesktopMountRenderer0721 } from "./lib/desktop-mount-renderer-0721.mjs";
import { applyPort0750RendererPatch } from "./lib/port-0750-renderer-patch.mjs";
import { applyOriginalRendererSidebarHiddenSection } from "./lib/sidebar-hidden-section-renderer-patch.mjs";
import { applyOriginalRendererFailureCopy } from "./lib/failure-copy-renderer-patch.mjs";
import { applyOriginalRendererCouldntReachComfort } from "./lib/couldnt-reach-comfort-renderer-patch.mjs";
import { applyOriginalRendererWidgetMultiselect } from "./lib/widget-multiselect-renderer-patch.mjs";
import { applyOriginalRendererWorkingStatusPhrases } from "./lib/working-status-phrases-renderer-patch.mjs";
import { applyOriginalRendererPromptAutoLists } from "./lib/prompt-auto-lists-renderer-patch.mjs";

const scriptPath = fileURLToPath(import.meta.url);
export const defaultElectronMainBindingManifestPath = path.join(repoRoot, "manifests/reconstruction/electron-main-production-bindings-manifest.json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function compositionWithProductionActivations(hostActivation, electronMainActivation, composition = runtimeComposition) {
  return composition.map(runtime => {
    if (runtime.runtime === "host") return hostActivation.clean ? {
      runtime: "host", path: "dist/host/host-main.cjs", mode: "clean-source", source: "source/host/main.ts", bindingManifest: hostBindingProvenancePath,
    } : { ...runtime, reason: hostActivation.blocker };
    if (runtime.runtime === "electron-main") return electronMainActivation.clean ? {
      runtime: "electron-main", path: "dist/electron-main/main.cjs", mode: "clean-source", source: "source/electron-main/main.ts", bindingManifest: electronMainBindingProvenancePath,
      runtimePackageFiles: electronMainActivation.runtimePackageFiles,
    } : { ...runtime, reason: electronMainActivation.blocker };
    return runtime;
  });
}

export function fallbackSourcesReplacedByActivations(hostActivation, electronMainActivation) {
  const cleanRuntimes = new Set([
    ...(hostActivation.clean ? ["host"] : []),
    ...(electronMainActivation.clean ? ["electron-main"] : []),
  ]);
  return runtimeComposition
    .filter(({ runtime, mode, sourceBundle }) => cleanRuntimes.has(runtime) && mode === "artifact-fallback" && typeof sourceBundle === "string")
    .map(({ sourceBundle }) => sourceBundle);
}

async function outputRecord(outputRoot, relative) {
  const target = path.join(outputRoot, relative);
  return { path: relative, bytes: (await stat(target)).size, sha256: sha256(await readFile(target)) };
}

async function prepareProductionActivations(clean, hostBindingManifest, electronMainBindingManifest, composition = runtimeComposition, { reconstructedPackage = false } = {}) {
  const [hostActivation, electronMainActivation] = await Promise.all([
    buildProductionHostIfSupplied({ outputRoot: clean.outputRoot, manifestPath: hostBindingManifest }),
    buildProductionElectronMainIfSupplied({ outputRoot: clean.outputRoot, manifestPath: electronMainBindingManifest, reconstructedPackage }),
  ]);
  const activatedComposition = compositionWithProductionActivations(hostActivation, electronMainActivation, composition);
  const excludedFallbacks = new Set(fallbackSourcesReplacedByActivations(hostActivation, electronMainActivation));
  let outputs = clean.buildManifest.outputs.filter(output => !excludedFallbacks.has(output.path));
  const replacements = new Set([
    ...(hostActivation.clean ? ["dist/host/host-main.cjs", hostBindingProvenancePath] : []),
    ...(electronMainActivation.clean ? ["dist/electron-main/main.cjs", electronMainBindingProvenancePath] : []),
  ]);
  if (replacements.size > 0) {
    outputs = outputs.filter(output => !replacements.has(output.path));
    for (const relative of replacements) outputs.push(await outputRecord(clean.outputRoot, relative));
    outputs.sort((left, right) => left.path.localeCompare(right.path));
  }
  if (electronMainActivation.clean) {
    for (const relative of electronMainActivation.runtimePackageFiles ?? []) outputs.push(await outputRecord(clean.outputRoot, relative));
    outputs.sort((left, right) => left.path.localeCompare(right.path));
  }
  return {
    ...clean,
    hostActivation,
    electronMainActivation,
    buildManifest: { ...clean.buildManifest, runtimeComposition: activatedComposition, outputs },
  };
}

async function attachCompositionAudit(clean) {
  const composition = clean.buildManifest.runtimeComposition;
  const auditHostActivation = clean.hostActivation.clean ? {
    status: clean.hostActivation.status,
    clean: true,
    requiredBindings: clean.hostActivation.requiredBindings,
    boundBindings: clean.hostActivation.boundBindings,
    unboundBindings: clean.hostActivation.unboundBindings,
    inventory: clean.hostActivation.inventory ?? clean.hostActivation.provenance.inventory,
    activationEvidence: clean.hostActivation.activationEvidence ?? clean.hostActivation.provenance.activationEvidence,
    provenance: clean.hostActivation.provenance,
  } : clean.hostActivation;
  const result = await writeRuntimeCompositionAudit({
    outputRoot: clean.outputRoot,
    requireOutputs: true,
    composition,
    hostActivation: auditHostActivation,
    electronMainActivation: clean.electronMainActivation.clean ? {
      status: clean.electronMainActivation.status,
      clean: true,
      provenance: clean.electronMainActivation.provenance,
    } : clean.electronMainActivation,
  });
  const auditStat = await stat(result.path);
  const outputs = clean.buildManifest.outputs
    .filter(output => output.path !== compositionAuditPath)
    .concat({ path: compositionAuditPath, bytes: auditStat.size, sha256: result.sha256 })
    .sort((left, right) => left.path.localeCompare(right.path));
  const buildManifest = {
    ...clean.buildManifest,
    schemaVersion: 2,
    deterministicInputs: [...new Set([
      ...clean.buildManifest.deterministicInputs,
      "manifests/reconstruction/runner-parity-audit.json",
      "scripts/audit-runtime-composition.mjs",
      "scripts/build-box-exec-daemon.mjs",
      "scripts/host-production-activation.mjs",
      "scripts/electron-main-production-activation.mjs",
      "scripts/lib/server-port-cards-renderer-patch.mjs",
      "frontend/src/production/server-port-card-entry.tsx",
      "frontend/src/recovered/features/conversation/cards/transcript-card/server-port-utilities.css",
      "frontend/src/recovered/features/conversation/cards/transcript-card/server-port-utilities.manifest.json",
      "source/shared/external-drafts.ts",
      "source/shared/user-forms.ts",
      "package.json",
      "package-lock.json",
      "src/app/package.json",
      ...(clean.hostActivation.clean ? [clean.hostActivation.provenance.manifestPath] : []),
      ...(clean.electronMainActivation.clean ? [clean.electronMainActivation.provenance.manifestPath] : []),
    ])],
    hostActivation: clean.hostActivation.clean ? {
      status: clean.hostActivation.status,
      bindingManifest: hostBindingProvenancePath,
      manifestSha256: clean.hostActivation.provenance.manifestSha256,
      outputSha256: clean.hostActivation.provenance.output.sha256,
    } : {
      status: clean.hostActivation.status,
      blocker: clean.hostActivation.blocker,
      requiredBindings: clean.hostActivation.requiredBindings,
      boundBindings: clean.hostActivation.boundBindings,
      unboundBindings: clean.hostActivation.unboundBindings,
      inventory: clean.hostActivation.inventory,
      activationEvidence: clean.hostActivation.activationEvidence,
    },
    electronMainActivation: clean.electronMainActivation.clean ? {
      status: clean.electronMainActivation.status,
      bindingManifest: electronMainBindingProvenancePath,
      manifestSha256: clean.electronMainActivation.provenance.manifestSha256,
      outputSha256: clean.electronMainActivation.provenance.output.sha256,
      runtimePackageFiles: clean.electronMainActivation.runtimePackageFiles ?? [],
    } : {
      status: clean.electronMainActivation.status,
      blocker: clean.electronMainActivation.blocker,
      requiredBindings: clean.electronMainActivation.requiredBindings,
    },
    compositionAudit: {
      path: compositionAuditPath,
      sha256: result.sha256,
      cleanAccepted: result.audit.summary.cleanAccepted,
      blockedFallbacks: result.audit.summary.blockedFallbacks,
    },
    outputs,
  };
  await writeFile(clean.manifestPath, `${JSON.stringify(buildManifest, null, 2)}\n`);
  return { ...clean, buildManifest, compositionAudit: result.audit, compositionAuditPath: result.path };
}

export async function overlayAuditMetadata(clean, { stageRoot = stagedAppDir } = {}) {
  const relativePaths = [compositionAuditPath, "dist/reconstruction-build.json"];
  if (clean.hostActivation.clean) relativePaths.push("dist/host/host-main.cjs", hostBindingProvenancePath);
  if (clean.electronMainActivation.clean) relativePaths.push("dist/electron-main/main.cjs", electronMainBindingProvenancePath);
  for (const relative of relativePaths) {
    const destination = path.join(stageRoot, relative);
    await rm(destination, { recursive: true, force: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(clean.outputRoot, relative), destination, {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
    });
  }
  for (const relative of clean.electronMainActivation.runtimePackageFiles ?? []) {
    const destination = path.join(stageRoot, relative);
    await rm(destination, { recursive: true, force: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(clean.outputRoot, relative), destination, {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
    });
  }
  for (const relative of fallbackSourcesReplacedByActivations(clean.hostActivation, clean.electronMainActivation)) {
    await rm(path.join(stageRoot, relative), { recursive: true, force: true });
  }
}

export { cleanBuildDir, fidelityCleanBuildDir, fidelityRuntimeComposition, runtimeComposition };

export async function buildCleanDistribution(options = {}) {
  const {
    hostBindingManifest = process.env.GROK_BOT_HOST_BINDINGS_MANIFEST?.trim() || null,
    electronMainBindingManifest = process.env.GROK_BOT_ELECTRON_MAIN_BINDINGS_MANIFEST?.trim()
      || (existsSync(defaultElectronMainBindingManifestPath) ? defaultElectronMainBindingManifestPath : null),
    ...baseOptions
  } = options;
  const base = await buildBaseCleanDistribution(baseOptions);
  return attachCompositionAudit(await prepareProductionActivations(base, hostBindingManifest, electronMainBindingManifest));
}

export async function buildFidelityDistribution(options = {}) {
  const {
    hostBindingManifest = process.env.GROK_BOT_HOST_BINDINGS_MANIFEST?.trim() || null,
    electronMainBindingManifest = process.env.GROK_BOT_ELECTRON_MAIN_BINDINGS_MANIFEST?.trim()
      || (existsSync(defaultElectronMainBindingManifestPath) ? defaultElectronMainBindingManifestPath : null),
    ...baseOptions
  } = options;
  const base = await buildBaseFidelityDistribution(baseOptions);
  return attachCompositionAudit(await prepareProductionActivations(base, hostBindingManifest, electronMainBindingManifest, fidelityRuntimeComposition));
}

export async function buildReconstructedAsar({
  hostBindingManifest = process.env.GROK_BOT_HOST_BINDINGS_MANIFEST?.trim() || null,
  electronMainBindingManifest = process.env.GROK_BOT_ELECTRON_MAIN_BINDINGS_MANIFEST?.trim()
    || (existsSync(defaultElectronMainBindingManifestPath) ? defaultElectronMainBindingManifestPath : null),
} = {}) {
  const built = await buildBaseReconstructedAsar({ pack: false });
  const prepared = await prepareProductionActivations(built, hostBindingManifest, electronMainBindingManifest, runtimeComposition, { reconstructedPackage: true });
  const clean = await attachCompositionAudit(prepared);
  await overlayAuditMetadata(clean);
  await packStagedAppWithIntegrity({ stageRoot: stagedAppDir, archivePath: builtAsar, unpackedRoot: builtAsarUnpacked });
  console.log(`Fail-closed composition audit embedded: ${compositionAuditPath} (${sha256(await readFile(clean.compositionAuditPath))})`);
  return { ...built, ...clean };
}

export async function buildFidelityReconstructedAsar({
  hostBindingManifest = process.env.GROK_BOT_HOST_BINDINGS_MANIFEST?.trim() || null,
  electronMainBindingManifest = process.env.GROK_BOT_ELECTRON_MAIN_BINDINGS_MANIFEST?.trim()
    || (existsSync(defaultElectronMainBindingManifestPath) ? defaultElectronMainBindingManifestPath : null),
  buildRoot = fidelityBuildDir,
  stageRoot = fidelityStagedAppDir,
  archivePath = fidelityBuiltAsar,
  unpackedRoot = fidelityBuiltAsarUnpacked,
  cleanOutputRoot = fidelityCleanBuildDir,
} = {}) {
  const fallback = await buildAsar({
    pack: false,
    buildRoot,
    stageRoot,
    archivePath,
    unpackedRoot,
  });
  const base = await buildBaseFidelityDistribution({ outputRoot: cleanOutputRoot });
  const prepared = await prepareProductionActivations(base, hostBindingManifest, electronMainBindingManifest, fidelityRuntimeComposition, { reconstructedPackage: true });
  const clean = await attachCompositionAudit(prepared);
  await overlayCleanDistribution(clean.outputRoot, { stageRoot, composition: clean.buildManifest.runtimeComposition });
  await applyOriginalRendererRouterPatch({ stageRoot });
  // Settings → 记忆: Muse-style memory import (dialog distillation to the MAIN bot).
  // Anchors on the router patch's OUTPUT (registry entry list + panel switch), so it must
  // run immediately after it — and, like the router patch, before the i18n passes below
  // (its labels resolve through the RLocT runtime settings-i18n appends later).
  await applyOriginalRendererMemoryImport({ stageRoot });
  await applyOriginalRendererLibraryStageClose({ stageRoot });
  // Must run after the renderer extension (it patches the same chunk) and before the
  // i18n passes (its "Search" label is localised by main-i18n's existing pair).
  await applyOriginalRendererSidebarTopBarSearch({ stageRoot });
  // Must run before the i18n passes (it resolves its label through RLocT, which
  // main-i18n appends to this chunk later — function declarations hoist).
  await applyOriginalRendererChatHeaderIdentity({ stageRoot });
  // Independent of the header patches (it rewrites the transcript's activity mark, not the
  // chat header) and touches no string literal, so it is order-free against the passes
  // around it. It is kept here, ahead of the i18n passes, with the rest of the renderer
  // extensions so the i18n passes stay last.
  await applyOriginalRendererActivityLabelVisibility({ stageRoot });
  // 0.62.0's selection toolbar. Same chunk as every pass above, and like them it must
  // land before the i18n passes: its three labels ("Add to prompt", "Selection actions",
  // "Add selection to prompt") are raw literals that main-i18n localises through the
  // pairs added for it there.
  await applyOriginalRendererSelectionAddToPrompt({ stageRoot });
  // 0.62.0's skill-detail pane (the "Learn from demonstration" popup). Own chunk
  // (view-B5Ug8wEm.js), so it is order-free against the passes above, and like them it
  // must land before the i18n passes: it keeps the raw "Save" / "Name" / "Description" /
  // "Instructions" literals those passes localise, and rewrites the surrounding layout
  // without touching any of them.
  await applyOriginalRendererSkillDetail({ stageRoot });
  // The rest of 0.62.0's "Learn from demonstration" round trip: the publish-gate flip
  // that brings back the header's Publish trigger, the teach-recording message
  // classifier plus the contentBeforeRichText line it gates, and the managed-skill
  // chip label. It edits the MAIN chunk (index-UbX-y3il.js), which the sidebar-search
  // / chat-header / activity-label / selection / router passes above all edit too, so
  // order matters — and it must still land before the i18n passes, because it emits
  // RLocT pairs the main-i18n pass then wraps.
  await applyOriginalRendererTeachSuccessPath({ stageRoot });
  // 0.62.0's info-pane split sizing: the right-hand column is no longer capped at 480px, so
  // the 电脑 (VNC) column widens with the window. It edits the MAIN chunk's layout constant
  // block and five clamps, adds and removes no string literal and touches no JSX, so it is
  // order-free against both the header passes above and the i18n passes below.
  await applyOriginalRendererInfoPaneSplit({ stageRoot });
  // Experimental per-bot model card in the bot properties panel (h3n). Its labels are
  // already RLocT calls, so it needs the RLocT runtime that main-i18n appends below.
  await applyOriginalRendererAgentModel({ stageRoot });
  // Settings → 更新 → "Grok Node 的电脑": this build runs the box from a digest-pinned
  // image, so no newer image can ever be offered and the section always shows official's
  // up-to-date card (primary-coloured title, the shared-computer sentence, the blue
  // check-circle banner). It pins the two inputs that decide that card and rewrites the
  // group's strings through RLocT, so — like every pass that emits RLocT — it must land
  // before the i18n passes below, which append the RLocT runtime to this same chunk.
  // Experimental read-only bot data cards (soul / memory journal / user profile / audit /
  // workflows) in the same panel. Anchors on the agent-model patch's OUTPUT, so it must
  // run immediately after it — and, like every pass that emits RLocT literals, before the
  // i18n passes below, which append the RLocT runtime to this same chunk.
  await applyOriginalRendererAgentDataCards({ stageRoot });
  await applyOriginalRendererComputerUpdate({ stageRoot });
  await applyMainAgentRendererPatch({ stageRoot });
  // 0.75.3 sidebar search presentation and its Create new Bot host. Both depend on
  // the main-agent wrapper and the sidebar top-bar injection above. They emit
  // RLocT calls, so they must land before the i18n passes.
  await applySearchPaletteRendererPatch({ stageRoot });
  await applyBotCreateDialogRendererExtension({ stageRoot });
  // 强调色 = Bot 颜色 (bot color in chat): appends a self-starting IIFE to the ENTRY
  // chunk (not the sidebar chunk the pass above edits), so the two never touch the same
  // bytes and the order here is documentary, not load-bearing. The IIFE emits no RLocT
  // calls and no i18n strings, so the i18n passes below ignore it.
  await applyBotColorRendererPatch({ stageRoot });
  // Phase 2 of the same feature: the Settings → Appearance accent dropdown, patched into
  // the lazy settings chunk (identified by its theme palette table, not its filename).
  // Order-free against the pass above (different chunk); must precede the i18n passes
  // only in the sense that it, too, emits no RLocT calls — it appends English strings that
  // match the settings surface's own hardcoded English.
  await applyBotColorSettingsPatch({ stageRoot });
  // 电脑休眠/唤醒 (computer sleep/wake): appends the sleep overlay runtime to the ENTRY
  // chunk and its stylesheet to the main CSS. Order-free against the passes above
  // (appended bytes only); emits no RLocT and carries its own bilingual labels.
  await applyShapePickerPatch({ stageRoot });
  await applyComputerSleepRendererPatch({ stageRoot });
  // 电脑控制条 official 0.70.2 view-only/take-control/stop overlay. Appended bytes only;
  // own labels, no RLocT: order-free against the passes above.
  await applyComputerControlRendererPatch({ stageRoot });
  await applyOriginalRendererConversationComputerCard({ appRoot: stageRoot });
  await applyOriginalRendererAppLinkCards({ stageRoot });
  await applyOriginalRendererServerPortCards({ stageRoot });
  // 0.71.2 View → "View Unread": MAIN chunk roster filter + menu event subscribe. No RLocT.
  // Must precede i18n only so later passes see a stable chunk; anchors do not overlap them.
  await applyOriginalRendererViewUnread({ stageRoot });
  // 0.71.2 transcript "Scroll to bottom" button: edits the MAIN chunk's view builder and
  // transcript plane, and emits an RLocT call, so it must precede the i18n passes.
  await applyOriginalRendererScrollToBottom({ stageRoot });
  // 0.71.2 "Download" / "Download all" message action: edits the MAIN chunk's hover actions,
  // message wrapper and image-group host, and emits RLocT calls, so it must precede i18n.
  await applyOriginalRendererDownloadAll({ stageRoot });
  // 0.71.2's "Not delivered yet": MAIN chunk send journal, transcript overlay and user-row
  // footer. Its one label is an RLocT call, so it must precede main-i18n (which appends
  // the RLocT runtime); none of its anchors overlap the passes above.
  await applyOriginalRendererUndeliveredSend({ stageRoot });
  await applyOriginalRendererReadFailureRetry({ stageRoot });
  // 0.71.2 "Rename chat / Rename Bot" sidebar context-menu entry. Emits RLocT calls, so it
  // must land before main-i18n appends the RLocT runtime.
  await applyOriginalRendererSidebarRenameMenu({ stageRoot });
  await applyDesktopMountRenderer0721({ stageRoot });
  // 0.71.2 inline Hidden Bots section + "Show in sidebar". Depends on the rename pass's
  // post-patch fcn/udn memo sizes; emits RLocT, so it must precede main-i18n.
  await applyOriginalRendererSidebarHiddenSection({ stageRoot });
  // Its RLocT calls rely on the runtime main-i18n appends to the main chunk.
  await applyOriginalRendererFailureCopy({ stageRoot });
  // P0-5: align couldnt-reach dialog comfort (LDzo5u / wUMeMd / Vi957D) to official
  // Bot wording BEFORE main-i18n pairs match the patched English literals.
  await applyOriginalRendererCouldntReachComfort({ stageRoot });
  // Widget view chunk (view-CIFdOvCz.js); order-free vs main-chunk failure-copy. Must precede extra-i18n (keeps its English anchors).
  await applyOriginalRendererWidgetMultiselect({ stageRoot });
  // Replaces gJn before main-i18n; MAIN_I18N_LOCAL_ANCHORED no longer owns gJn.
  await applyOriginalRendererWorkingStatusPhrases({ stageRoot });
  // P2-2 MsZyH5: Ja("waiting") literal → Waiting on results (before main-i18n table).
  await applyOriginalRendererWaitingOnResults({ stageRoot });
  // 0.71.2 prompt `-` / `1.` auto-lists (hft StarterKit). No RLocT; must stay before i18n
  // only for ordering consistency with other 0712 UI patches. Strips list Enter shortcuts.
  await applyOriginalRendererPromptAutoLists({ stageRoot });
  await applyOriginalRendererSettingsI18n({ stageRoot });
  await applyOriginalRendererMainI18n({ stageRoot });
  await applyOriginalRendererExtraI18n({ stageRoot });
  await applyMessageCopy0753Patch({ stageRoot });
  // The 0.18 renderer already has the footer update pill and Update-ready
  // modal; port the official 0.75.5 copy now that RLocT exists.
  await applyUpdatePillCopy0755Patch({ stageRoot });
  // After i18n so the injected host source is not rewritten. The general-panel
  // anchor survives the router patch, and the plugins-list anchor is untouched
  // by the view-chunk passes above.
  await applyPort0750RendererPatch({ stageRoot });
  await applyOriginalRendererLanguagePatch({ stageRoot });
  // Hardware acceleration toggle: lands in Sa()'s `r` slot after Language (Fragment).
  // Depends on the Language Sa slot rewrite above; independent of i18n (bilingual inline).
  await applyHardwareAccelerationSettingsPatch({ stageRoot });
  // Settings → Updates: port the official 0.75.3 Automatic Updates + Version
  // card over the 0.18 update pane. Uses the settings kit and RLocT runtime
  // already present; run after all i18n and settings-row passes.
  await applySettingsUpdate0753Patch({ stageRoot });
  // Last among the chunk-mutating passes: the flip touches one gate-fallback token in the
  // renderer chunk and the host bundle's bundled FLAGS default, neither of which the i18n
  // passes read or write. It must land before the packaging audit snapshots the stage.
  await applyTeachGateRestorePatch({ stageRoot });
  // Also last: registers two NEW entries in the same bundled FLAGS table the pass above
  // touches. Independent anchors, and the two passes do not read each other's output.
  await applyGrokMainAgentGatePatch({ stageRoot });
  // Also also last: one more NEW entry in the same bundled FLAGS table, with its own
  // anchor check. Independent of both passes above (they assert on their own gate names).
  await applyBotColorGatePatch({ stageRoot });
  // 0.71 documents/pages/multiplayer/canvas FLAGS ecosystem: inserts 11 entries (2 pinned
  // ON from Statsig, 9 kept OFF). Same table, own gate-name already-present guard; must
  // run after the three passes above so their names are not mistaken for ours.
  await apply0712GateEcosystemPatch({ stageRoot });
  await applyReplyComposer0753Patch({ stageRoot });
  await applyReplyTarget0753Patch({ stageRoot });
  await applyEmojiLocale0753Patch({ stageRoot });
  await applyPromptCta0753Patch({ stageRoot });
  await applyRecipientPicker0755Patch({ stageRoot });
  await applyGroupAuthor0755Patch({ stageRoot });
  await applyVaultSettingsRenderer0721({ stageRoot });
  await overlayAuditMetadata(clean, { stageRoot });
  await packStagedAppWithIntegrity({ stageRoot, archivePath, unpackedRoot });
  console.log(`Fidelity hybrid ASAR ready: ${archivePath}`);
  console.log(`Fail-closed composition audit embedded: ${compositionAuditPath} (${sha256(await readFile(clean.compositionAuditPath))})`);
  return { ...fallback, ...clean, builtAsar: archivePath, builtAsarUnpacked: unpackedRoot };
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === scriptPath) {
  await buildReconstructedAsar();
}
