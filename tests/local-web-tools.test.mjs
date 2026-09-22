import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(out) {
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
    }]
  });
  return import(pathToFileURL(outfile).href);
}

test("the local web search service returns real documents", async () => {
  const mod = await load("local-web-tools.mjs");
  const service = mod.createLocalWebSearchService();
  const result = await service({}, { searchTerm: "codex cli" });
  assert.ok(Array.isArray(result.documents), "documents must be an array");
  assert.ok(result.documents.length > 0, "the search must return at least one document");
  for (const document of result.documents) {
    assert.equal(typeof document.url, "string");
    assert.equal(typeof document.title, "string");
    assert.equal(typeof document.text, "string");
    assert.ok(document.url.startsWith("http"), `url must be absolute: ${document.url}`);
  }
  assert.ok(result.documents.some((d) => d.title.length > 0), "at least one document must carry a title");
  assert.ok(result.answer.length > 0, "the answer must summarize the hits");
});

test("the local web search service also answers a Chinese query", async () => {
  const mod = await load("local-web-tools.mjs");
  const service = mod.createLocalWebSearchService();
  const result = await service({}, { searchTerm: "阶跃星辰 大模型" });
  assert.ok(result.documents.length > 0, "a Chinese query must return documents");
  assert.ok(result.documents.every((d) => d.url.startsWith("http")));
});

test("the local web fetch service reads a real page and strips markup", async () => {
  const mod = await load("local-web-tools.mjs");
  const service = mod.createLocalWebFetchService();
  const result = await service({}, "https://example.com/");
  assert.ok(!("error" in result), `fetch must succeed: ${JSON.stringify(result)}`);
  assert.ok("content" in result);
  assert.ok(result.content.includes("Example"), "the page text must contain the heading");
  assert.ok(!result.content.includes("<html"), "the markup must be stripped");
});

test("the local web fetch service reports a clear error for an unreachable host", async () => {
  const mod = await load("local-web-tools.mjs");
  const service = mod.createLocalWebFetchService();
  const result = await service({}, "https://this-host-does-not-exist.invalid/");
  assert.ok("error" in result, "an unreachable host must surface an error");
  assert.equal(result.isTimeout, undefined);
});

