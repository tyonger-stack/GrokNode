import path from "node:path";
import { build } from "esbuild";
import { repoRoot } from "./config.mjs";

export async function buildChannelStatusRendererExtension() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "frontend/src/extensions/channel-status-entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome142",
    minify: true,
  });
  const output = result.outputFiles[0];
  if (output == null) throw new Error("Channel status renderer extension was not built.");
  return output.text;
}
