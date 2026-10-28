import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUpstreamAsarIdentity, openUpstreamAsar } from "./upstream-asar.mjs";

export const UPSTREAM_0781 = createUpstreamAsarIdentity(
  "0.78.1",
  "e8d5e10f94f8b52cd02f696599c8e6503420ad85ceed7b41a27bbff7bff22f4d",
);

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export async function openUpstream0781({ asarPath = process.env.GROK_BOT_0781_ASAR } = {}) {
  const resolved = asarPath ?? path.resolve(repoRoot, "..", "rea-grokbot-0781", "asar", "app.asar");
  return openUpstreamAsar(UPSTREAM_0781, { asarPath: resolved });
}
