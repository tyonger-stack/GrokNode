// Shared loader for the local web tools tests.
//
// Bundles source/host/extensions/inference/local-web-tools.ts on demand with
// esbuild, resolving the repo's `.js`-suffixed relative imports back to their
// `.ts` sources. Lives outside the `*.test.mjs` glob so `node --test
// tests/*.test.mjs` never treats it as a suite.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function load(out) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", out);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, "source/host/extensions/inference/local-web-tools.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    packages: "external",
    banner: { js: "import { createRequire as __cr } from \"node:module\"; const require = __cr(import.meta.url);" },
    plugins: [{
      name: "js-to-ts",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
          const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
          if (!candidate.startsWith(repoRoot + "/source")) return null;
          return existsSync(candidate) ? { path: candidate } : null;
        });
      }
    }],
  });
  return import(pathToFileURL(outfile).href);
}
