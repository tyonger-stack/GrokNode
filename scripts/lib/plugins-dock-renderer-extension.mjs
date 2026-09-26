import path from "node:path";
import { build } from "esbuild";
import { repoRoot } from "./config.mjs";

export async function buildPluginsDockRendererExtension() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "frontend/src/extensions/plugins-dock-entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome142",
    minify: true,
  });
  const output = result.outputFiles[0];
  if (output == null) throw new Error("Plugins dock renderer extension was not built.");
  return output.text;
}
