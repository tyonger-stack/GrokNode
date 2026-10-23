import { fileURLToPath } from "node:url";
import { createUpstreamAsarIdentity, openUpstreamAsar, upstreamAsarPaths } from "./upstream-asar.mjs";

export const UPSTREAM_0721 = createUpstreamAsarIdentity(
  "0.72.1",
  "b272ee13db0fb9106f9276a46a8e47baf688c8d5ac1b1dc400df6fcba9e76996",
);

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const { defaultAsar, nativeManifestPath } = upstreamAsarPaths(
  repoRoot,
  "rea-grokbot-0721",
  "manifests/ports/grokbot-0721-unpacked.json",
);

export async function openUpstream0721({ asarPath = process.env.GROK_BOT_0721_ASAR ?? defaultAsar } = {}) {
  return openUpstreamAsar(UPSTREAM_0721, { asarPath, nativeManifestPath });
}

