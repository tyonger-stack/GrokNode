import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after } from "node:test";
import { build } from "esbuild";

export async function bundleServerPort(modules, plugins = []) {
  const directory = await mkdtemp(path.join(tmpdir(), "server-port-test-"));
  after(() => rm(directory, { recursive: true, force: true }));
  const result = await build({ stdin: { resolveDir: new URL("..", import.meta.url).pathname,
    contents: modules.map(module => `export * from "./source/${module}.ts";`).join("\n") },
    bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", mainFields: ["module", "main"], plugins,
    banner: { js: `import { createRequire as createServerPortRequire } from "node:module"; const require = createServerPortRequire(${JSON.stringify(new URL("../package.json", import.meta.url).href)});` } });
  const file = path.join(directory, "bundle.mjs");
  await writeFile(file, result.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}
