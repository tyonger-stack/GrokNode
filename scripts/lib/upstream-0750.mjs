import { fileURLToPath } from "node:url";
import { createUpstreamAsarIdentity, openUpstreamAsar, upstreamAsarPaths } from "./upstream-asar.mjs";

export const UPSTREAM_0750 = createUpstreamAsarIdentity(
  "0.75.0",
  "1035db7b1f77974c78e6c18a4426a5fe16c639946335f7d57badfd0761971a5e",
);

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const { defaultAsar, nativeManifestPath } = upstreamAsarPaths(
  repoRoot,
  "rea-grokbot-0750",
  "manifests/ports/grokbot-0750-unpacked.json",
);

export async function openUpstream0750({ asarPath = process.env.GROK_BOT_0750_ASAR ?? defaultAsar } = {}) {
  return openUpstreamAsar(UPSTREAM_0750, { asarPath, nativeManifestPath });
}

