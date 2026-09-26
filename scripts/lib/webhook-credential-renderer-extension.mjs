import path from "node:path";
import { build } from "esbuild";
import { repoRoot } from "./config.mjs";

export async function buildWebhookCredentialRendererExtension() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "frontend/src/extensions/webhook-credential-entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome142",
    minify: true,
  });
  const output = result.outputFiles[0];
  if (output == null) throw new Error("Webhook credential renderer extension was not built.");
  return output.text;
}
