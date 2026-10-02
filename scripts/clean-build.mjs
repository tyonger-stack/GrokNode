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
import { applyOriginalRendererSidebarTopBarSearch } from "./lib/sidebar-search-renderer-patch.mjs";
import { applyOriginalRendererChatHeaderIdentity } from "./lib/chat-header-identity-renderer-patch.mjs";
import { applyOriginalRendererActivityLabelVisibility } from "./lib/activity-label-visibility-renderer-patch.mjs";
import { applyOriginalRendererSelectionAddToPrompt } from "./lib/selection-add-to-prompt-renderer-patch.mjs";
import { applyOriginalRendererSkillDetail } from "./lib/skill-detail-renderer-patch.mjs";
import { applyOriginalRendererTeachSuccessPath } from "./lib/teach-success-path-renderer-patch.mjs";
import { applyOriginalRendererInfoPaneSplit } from "./lib/info-pane-split-renderer-patch.mjs";
import { applyOriginalRendererAgentModel } from "./lib/agent-model-renderer-patch.mjs";
import { applyOriginalRendererLanguagePatch } from "./lib/language-renderer-patch.mjs";
import { applyOriginalRendererSettingsI18n } from "./lib/settings-i18n-patch.mjs";
import { applyOriginalRendererMainI18n } from "./lib/main-i18n-patch.mjs";
import { applyOriginalRendererExtraI18n } from "./lib/extra-i18n-patch.mjs";
import { applyTeachGateRestorePatch } from "./lib/teach-gate-restore-patch.mjs";
import { applyGrokMainAgentGatePatch } from "./lib/grok-main-agent-gate-patch.mjs";
import { applyMainAgentRendererPatch } from "./lib/main-agent-renderer-patch.mjs";

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
  await applyMainAgentRendererPatch({ stageRoot });
  await applyOriginalRendererSettingsI18n({ stageRoot });
  await applyOriginalRendererMainI18n({ stageRoot });
  await applyOriginalRendererExtraI18n({ stageRoot });
  await applyOriginalRendererLanguagePatch({ stageRoot });
  // Last among the chunk-mutating passes: the flip touches one gate-fallback token in the
  // renderer chunk and the host bundle's bundled FLAGS default, neither of which the i18n
  // passes read or write. It must land before the packaging audit snapshots the stage.
  await applyTeachGateRestorePatch({ stageRoot });
  // Also last: registers two NEW entries in the same bundled FLAGS table the pass above
  // touches. Independent anchors, and the two passes do not read each other's output.
  await applyGrokMainAgentGatePatch({ stageRoot });
  await overlayAuditMetadata(clean, { stageRoot });
  await packStagedAppWithIntegrity({ stageRoot, archivePath, unpackedRoot });
  console.log(`Fidelity hybrid ASAR ready: ${archivePath}`);
  console.log(`Fail-closed composition audit embedded: ${compositionAuditPath} (${sha256(await readFile(clean.compositionAuditPath))})`);
  return { ...fallback, ...clean, builtAsar: archivePath, builtAsarUnpacked: unpackedRoot };
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === scriptPath) {
  await buildReconstructedAsar();
}
