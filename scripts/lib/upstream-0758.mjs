import { fileURLToPath } from "node:url";
import { createUpstreamAsarIdentity, openUpstreamAsar, upstreamAsarPaths } from "./upstream-asar.mjs";

export const UPSTREAM_0758 = createUpstreamAsarIdentity(
  "0.75.8",
  "7d6fe1a476e2c575c11429772959728333eb9d3d442f71f89bbd9c6f180dd779",
);

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const { defaultAsar, nativeManifestPath } = upstreamAsarPaths(
  repoRoot,
  "rea-grokbot-0758",
  "manifests/ports/grokbot-0758-unpacked.json",
);

export async function openUpstream0758({ asarPath = process.env.GROK_BOT_0758_ASAR ?? defaultAsar } = {}) {
  return openUpstreamAsar(UPSTREAM_0758, { asarPath, nativeManifestPath });
}
