import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { repoRoot } from "./config.mjs";

export async function buildBotTemplateRendererExtension() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "frontend/src/extensions/bot-template-entry.ts")],
    bundle: true, write: false, format: "iife", platform: "browser", target: "chrome142", minify: true,
    plugins: [{
      name: "inline-template-styles",
      setup(build) {
        build.onResolve({ filter: /\.css\?inline$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?inline$/, "")), namespace: "template-styles" }));
        build.onLoad({ filter: /.*/, namespace: "template-styles" }, async args => ({ contents: await readFile(args.path, "utf8"), loader: "text" }));
      },
    }],
  });
  const output = result.outputFiles[0];
  if (output == null) throw new Error("Bot template renderer extension was not built.");
  return output.text;
}
