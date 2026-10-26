// Builds the agents-list scroll-fade runtime extension: official Grok Bot 0.75.8's
// inline mask on the left-rail avatar list, replicated by
// frontend/src/extensions/agents-list-fade-entry.ts (logic in
// agents-list-fade-core.ts, recovered verbatim from official's index.eager-platform
// chunk). The IIFE is appended to the registry chunk next to the other runtime
// extensions by router-renderer-patch.mjs.

import path from "node:path";
import { build } from "esbuild";
import { repoRoot } from "./config.mjs";

export async function buildAgentsListFadeRendererExtension() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "frontend/src/extensions/agents-list-fade-entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome142",
    minify: true,
  });
  const output = result.outputFiles[0];
  if (output == null) throw new Error("Agents-list fade renderer extension was not built.");
  const text = output.text;
  // Fail closed on the two literals the runtime cannot work without: the official
  // gradient's variable references and the viewport selector.
  for (const marker of ["--scroll-fade-top-size", "ui-scroll-area__viewport", "sand-agents-list"]) {
    if (!text.includes(marker)) throw new Error(`Agents-list fade extension lost its "${marker}" literal.`);
  }
  return text;
}
