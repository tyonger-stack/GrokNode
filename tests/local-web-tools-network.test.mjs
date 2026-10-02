// Real-network coverage for the local web tools.
//
// Excluded from the CI check job on purpose (see local-web-tools.test.mjs):
// these three call the public internet, and runner-network wobble is enough to
// fail them. Run them locally with `npm test`, or on demand with
// `gh workflow run repository checks` — the `network` job below is
// workflow_dispatch-only.
//
// The loader's cache filename is deliberately NOT shared with local-web-tools.test.mjs:
// `node --test` runs test files in parallel, and both files rebuilding the same outfile
// means one can import the other's half-written bundle and see missing exports.
import assert from "node:assert/strict";
import test from "node:test";

import { load } from "./support/local-web-tools-loader.mjs";

test("the local web search service returns real documents", async () => {
  const mod = await load("local-web-tools-network.mjs");
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
  const mod = await load("local-web-tools-network.mjs");
  const service = mod.createLocalWebSearchService();
  const result = await service({}, { searchTerm: "阶跃星辰 大模型" });
  assert.ok(result.documents.length > 0, "a Chinese query must return documents");
  assert.ok(result.documents.every((d) => d.url.startsWith("http")));
});

test("the local web fetch service reads a real page and strips markup", async () => {
  const mod = await load("local-web-tools-network.mjs");
  const service = mod.createLocalWebFetchService();
  const result = await service({}, "https://example.com/");
  assert.ok(!("error" in result), `fetch must succeed: ${JSON.stringify(result)}`);
  assert.ok("content" in result);
  assert.ok(result.content.includes("Example"), "the page text must contain the heading");
  assert.ok(!result.content.includes("<html"), "the markup must be stripped");
});
