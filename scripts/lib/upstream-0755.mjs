import { fileURLToPath } from "node:url";
import { createUpstreamAsarIdentity, openUpstreamAsar, upstreamAsarPaths } from "./upstream-asar.mjs";

export const UPSTREAM_0755 = createUpstreamAsarIdentity(
  "0.75.5",
  "12bba50ba6cf12b35132518788610677a3fdc65de4ad849628d757bc7b780e5a",
);

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const { defaultAsar, nativeManifestPath } = upstreamAsarPaths(
  repoRoot,
  "rea-grokbot-0755",
  "manifests/ports/grokbot-0755-unpacked.json",
);

export async function openUpstream0755({ asarPath = process.env.GROK_BOT_0755_ASAR ?? defaultAsar } = {}) {
  return openUpstreamAsar(UPSTREAM_0755, { asarPath, nativeManifestPath });
}
