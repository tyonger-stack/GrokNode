// Restore "Teach a task" (教它做一项任务 / teach-by-demonstration) in this local-only
// build, by flipping its single feature gate to the value the Statsig backend is
// CURRENTLY serving for this account.
//
// Evidence (byte-sourced 2026-09-29 from this repo's pinned bundles, the deployed
// /Applications/Grok Node.app asar, and the official Grok Bot 0.61.0 app):
//
//   * The whole feature keys off ONE gate, `sand_teach_by_demonstration` —
//     experiment-config.gen.ts:412 says so in the upstream's own words: the box screen
//     recorder, the teach entry points, the recording HUD, the stop-and-learn synthetic
//     message and the learn-from-demonstration managed skill "all key off this one gate,
//     so a bad rollout is a single kill switch. Default OFF."
//
//   * The renderer hides every entry when the gate is false. Both UI entries funnel
//     through one reader in the pinned chunk (ENe, one occurrence of the gate name in the
//     whole chunk):
//         function ENe(){return es(Qe().experiments.snapshots)?.featureGates
//            ?.sand_teach_by_demonstration??!1}
//       - the computer pane's top-bar button (pbn) renders only when
//         `de = A && e!=null && P.state!=="recording" && ue && N==="preview"`, A = ENe();
//       - the composer "+" menu item renders only when `v && f!=null`, v = ENe().
//
//   * The HOST runs the real teach-recording extension behind the same gate:
//         isEnabled: () => context2.deps.experiments.checkFeatureGate("sand_teach_by_demonstration")
//     Its gate resolution ends at the bundled FLAGS default when no override channel is
//     usable, so the host side needs the default flipped, not just the renderer.
//
//   * Why not let the server feed the gate (the "proper" Statsig path)? This build cannot
//     receive it, by design:
//       - The electron main ships `createElectronProductionExperimentsBinding()` — a
//         local-only stub whose snapshot is `Object.freeze({})`, `checkFeatureGate` is
//         `() => false`, and override commands are no-ops. The real adapter
//         (createProductionExperimentsAdapter, with the Statsig client and the
//         BootstrapStatsig fetch) is not in the shipped bundle at all. The renderer's
//         snapshot therefore has no featureGates at all — every gate reads `??!1`.
//       - The app is logged in as the local-only account (authId "local",
//         local@localhost — the preload calls this build "local-only"), so there is no
//         real backend credential to bootstrap with; the host's override channels
//         (file/env/IPC) are all behind `canUseFeatureFlagOverrides()`
//         (= isDevBuild || isAnysphereUser), which is false for a packaged build.
//       - The coordinator resync pushes the desktop's (empty) override record to the host
//         via `replaceFeatureFlagOverrides`, which CLEARS host overrides on every resync —
//         so a host-side override file would not survive either.
//     For reference, the backend IS currently serving the gate: the official 0.61 app's
//     Statsig bootstrap cache (same machine, same account) contains
//     sand_teach_by_demonstration = true (looked up by Statsig's djb2 — seed 0, ×31,
//     int32-truncated — not the folk 5381×33).
//
//   * The two flips below are the minimal change that turns the feature on end-to-end in
//     this build. The bundled-default flip is immune to the resync wipe above because it
//     changes FLAGS[name].default, not the override store. Recording itself additionally
//     requires the agent to sit on a fork window (window index ≥
//     SAND_BOX_FIRST_FORK_WINDOW_INDEX=2): the shared-desktop box path assigns those
//     (takeFreeForkIndex), while the standalone loopback box hardwires window 1 and will
//     fail a start with "Teach recording requires a private desktop monitor." — a runtime
//     capability question, intentionally left to the runtime rather than patched here.
//
// Polarity note (the !1 → !0 flip): `??!1` is `?? false` and `??!0` is `?? true`. The
// tests evaluate the patched ENe for real instead of trusting string equality, because a
// polarity mistake compiles fine, passes node --check, and just keeps the feature off —
// the same class of bug the chat-header patch hit with `!1?null:X` vs `!0?null:X`.

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// The gate reader's fallback in the pinned renderer chunk. Unique: the gate name occurs
// exactly once in the whole chunk (verified against src/app/dist pristine).
const RENDERER_GATE_BEFORE = "featureGates?.sand_teach_by_demonstration??!1";
const RENDERER_GATE_AFTER = "featureGates?.sand_teach_by_demonstration??!0";

// The bundled FLAGS table entry in the host bundle. The gate name occurs twice there —
// this table form and the teach-recording extension's checkFeatureGate string — so the
// multi-line table anchor is what makes the flip unambiguous.
const HOST_GATE_BEFORE =
  "sand_teach_by_demonstration: {\n    client: true,\n    default: false\n  },";
const HOST_GATE_AFTER =
  "sand_teach_by_demonstration: {\n    client: true,\n    default: true\n  },";
// The other occurrence must survive untouched: it is the read side.
const HOST_EXTENSION_READ = 'checkFeatureGate("sand_teach_by_demonstration")';

// --- Localise the top-bar button's visible label -------------------------------------------
//
// The gate flip resurrects the button, but 0.18 upstream renders its VISIBLE text as a
// raw "Teach a task" literal — only the aria-label/title go through RLocT, so a Chinese
// UI shows an English pill (the screen-reader label is Chinese, and the composer "+"
// menu item is fully localised; this one literal is the odd one out). Wrap it with the
// same RLocT pair the aria-label already uses, so the pill reads 「教它做一项任务」.
// The anchor is the trailing literal of the button's children — `,"Teach a task"]` is
// unique in the chunk (the other three occurrences sit inside RLocT calls).
const RENDERER_LABEL_BEFORE = ',"Teach a task"]';
const RENDERER_LABEL_AFTER = ',(RLocT("Teach a task","教它做一项任务"))]';

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Teach-gate restore ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/**
 * Pure transform, exercised directly by the tests against the pristine bundles.
 * Flips the renderer's gate-reader fallback and the host's bundled FLAGS default, and
 * localises the computer-view button's visible label — nothing else changes; every other
 * gate keeps its bundled default.
 */
export function patchTeachGateRestore({ rendererSource, hostSource }) {
  let patchedRenderer = replaceExactlyOnce(
    rendererSource,
    RENDERER_GATE_BEFORE,
    RENDERER_GATE_AFTER,
    "renderer gate-reader fallback",
  );
  patchedRenderer = replaceExactlyOnce(
    patchedRenderer,
    RENDERER_LABEL_BEFORE,
    RENDERER_LABEL_AFTER,
    "renderer visible teach label",
  );
  let patchedHost = replaceExactlyOnce(
    hostSource,
    HOST_GATE_BEFORE,
    HOST_GATE_AFTER,
    "host bundled FLAGS default",
  );
  if (!patchedHost.includes(HOST_EXTENSION_READ)) {
    throw new Error("Teach-gate restore lost the host extension's gate read.");
  }
  if (patchedHost.includes(HOST_GATE_BEFORE)) {
    throw new Error("Teach-gate restore left the host FLAGS default unflipped.");
  }
  return { patchedRenderer, patchedHost };
}

export async function applyTeachGateRestorePatch({ stageRoot }) {
  const rendererAssetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const hostBundlePath = path.join(stageRoot, "dist", "host", "host-main.cjs");
  // The chunk name is checksum-pinned today, but anchor on content, not the file name:
  // exactly one chunk in the staged assets may carry the gate, or this patch refuses to
  // guess — same discipline as the chat-header patch.
  const candidates = [];
  for (const name of await readdir(rendererAssetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const source = await readFile(path.join(rendererAssetsRoot, name), "utf8");
    if (source.includes("sand_teach_by_demonstration")) candidates.push({ name, source });
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Teach-gate restore expected exactly one renderer chunk carrying the gate, found ${candidates.length}.`,
    );
  }
  const rendererSource = candidates[0].source;
  const hostSource = await readFile(hostBundlePath, "utf8");
  const { patchedRenderer, patchedHost } = patchTeachGateRestore({ rendererSource, hostSource });
  await writeFile(path.join(rendererAssetsRoot, candidates[0].name), patchedRenderer);
  await writeFile(hostBundlePath, patchedHost);
  const record = {
    schemaVersion: 1,
    mode: "teach-gate-restore",
    files: [
      {
        role: "renderer-gate-reader",
        path: `dist/renderer/assets/${candidates[0].name}`,
        original: { bytes: Buffer.byteLength(rendererSource), sha256: createHash("sha256").update(rendererSource).digest("hex") },
        patched: { bytes: Buffer.byteLength(patchedRenderer), sha256: createHash("sha256").update(patchedRenderer).digest("hex") },
      },
      {
        role: "host-bundled-flags-default",
        path: "dist/host/host-main.cjs",
        original: { bytes: Buffer.byteLength(hostSource), sha256: createHash("sha256").update(hostSource).digest("hex") },
        patched: { bytes: Buffer.byteLength(patchedHost), sha256: createHash("sha256").update(patchedHost).digest("hex") },
      },
    ],
    features: ["teach-by-demonstration-entry-points", "teach-recording-extension-enabled", "teach-button-localised-label"],
    transformations: [
      "renderer-gate-reader-fallback-false-to-true",
      "host-flags-default-false-to-true",
      "renderer-visible-teach-label-rlot-wrapped",
    ],
  };
  const provenancePath = path.join(stageRoot, "dist", "teach-gate-restore-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
