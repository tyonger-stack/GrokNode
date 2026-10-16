import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "library-parity-golden.json"), "utf8"));
const rawFixture = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "library-parity-raw-transcript.json"), "utf8"));
async function loadModule(name) {
  const result = await build({
    entryPoints: [path.join(repoRoot, "source/host/extensions/library/" + name)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}

test("v2 tie keeps page, external-doc, media, then key order", async () => {
  const merge = await loadModule("library-merge.ts");
  const tie = rawFixture.v2tie;
  const rows = merge.mergeLibrarySources({
    pages: tie.pages.map((page) => ({ ...page, title: "P", createdAtMs: null, visibility: "private", canShareToTeam: false })),
    docs: tie.externalDocs,
    media: tie.media,
  });
  assert.deepEqual(rows.map((row) => row.key), golden.v2tieExpectedKeys);
});

test("media groups follow local midnights with null in older", async () => {
  const merge = await loadModule("library-merge.ts");
  const media = await loadModule("transcript-media.ts");
  const now = Date.now();
  const entries = rawFixture.entries.map((entry) => ({
    ...entry,
    timestampMs: entry.tsOffsetMs == null ? null : now + entry.tsOffsetMs,
  }));
  const rows = merge.mergeLibrarySources({ pages: [], docs: [], media: media.extractTranscriptMedia(entries) });
  const groups = merge.groupLibraryRows(rows, now);
  assert.deepEqual(groups.map((group) => group.key), golden.derivedGolden.groupKeys);
  const counts = Object.fromEntries(groups.map((group) => [group.key, group.items.length]));
  assert.deepEqual(counts, golden.derivedGolden.groupCounts);
  assert.deepEqual(merge.visibleGroupItems([1, 2, 3], 0).length, 3);
  assert.equal(merge.visibleGroupItems([1, 2, 3, 4, 5, 6, 7], 0).length, 5);
  assert.equal(merge.GROUP_REVEAL, 5);
  assert.deepEqual(merge.visibleGroupItems([1, 2, 3, 4, 5, 6, 7], 5).length, 5);
  assert.deepEqual(merge.visibleGroupItems([1, 2, 3, 4, 5, 6, 7], 6).length, 6);
});

test("history loader caps calls and surfaces failure for retry", async () => {
  const merge = await loadModule("library-merge.ts");
  let batches = 0;
  const loader = merge.createHistoryLoader(async () => { batches += 1; return batches < 3; });
  assert.equal(loader.state, "loadable");
  assert.equal(await loader.loadOlder(), "loadable");
  assert.equal(await loader.loadOlder(), "loadable");
  assert.equal(await loader.loadOlder(), "exhausted");
  assert.equal(batches, 3);
  const failing = merge.createHistoryLoader(async () => { throw new Error("net down"); });
  assert.equal(await failing.loadOlder(), "failed");
  assert.equal(failing.calls, 1);
  assert.equal(await failing.retry(), "failed");
  assert.equal(failing.calls, 2);
  let capped = 0;
  const cappedLoader = merge.createHistoryLoader(async () => { capped += 1; return true; });
  for (let i = 0; i < 12; i += 1) await cappedLoader.loadOlder();
  assert.equal(capped, 10);
  assert.equal(cappedLoader.state, "exhausted");
});
