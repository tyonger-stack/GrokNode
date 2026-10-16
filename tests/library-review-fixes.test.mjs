import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(repoRoot, ".omo", "tmp"), { recursive: true });
const outRoot = mkdtempSync(path.join(repoRoot, ".omo", "tmp", "library-review-"));
test.after(() => rmSync(outRoot, { recursive: true, force: true }));
let bundleCount = 0;
async function loadModule(name) {
  const outfile = path.join(outRoot, `bundle-${bundleCount += 1}.mjs`);
  await build({
    entryPoints: [path.join(repoRoot, "source/host/extensions/library/" + name)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    outfile,
    logLevel: "silent",
    external: ["undici"],
  });
  return import(outfile);
}
const ORIGIN = "https://library.example.test";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
function tempRoot() {
  return mkdtempSync(path.join(outRoot, "db-"));
}
async function serviceIn(dir) {
  const extension = await loadModule("extension.ts");
  const service = extension.createLibraryHostService({ dataRoot: dir, providerOrigin: ORIGIN });
  const credential = service.mainCredential();
  const signal = AbortSignal.timeout(30000);
  return { service, credential, signal };
}

test("transcript reads authorize existing agents without enrollment", async () => {
  const { service, credential, signal } = await serviceIn(tempRoot());
  try {
    const seen = [];
    const withTranscript = { listAgentIds: () => ["bot-9"], getAgentTranscriptPage: async (agentId, query) => { seen.push([agentId, query]); return { entries: [] }; } };
    const extension = await loadModule("extension.ts");
    const withService = extension.createLibraryHostService({ dataRoot: tempRoot(), providerOrigin: ORIGIN, transcript: withTranscript });
    withService.mainCredential();
    const page = await withService.readTranscriptEntries({ agentId: "bot-9", credential: withService.mainCredential(), limit: 10 }, signal);
    assert.deepEqual(page, { entries: [] });
    assert.deepEqual(seen, [["bot-9", { limit: 10 }]]);
    await assert.rejects(withService.readTranscriptEntries({ agentId: "bot-9", credential: "bogus", limit: 10 }, signal));
    await assert.rejects(withService.readTranscriptEntries({ agentId: "", credential, limit: 10 }, signal), /agent id/);
    withService.dispose();
  } finally {
    service.dispose();
  }
});

test("mutations invalidate the page caches", async () => {
  const { service, credential, signal } = await serviceIn(tempRoot());
  try {
    const agentId = "agent-inv";
    const storeId = "node-local-store";
    service.catalog.identity.assignAgent({ ...service.catalog.identity.resolveCredential(credential, signal).principal, agentId }, true);
    const published = await service.publishNativeArtifact({
      input: { kind: "document", source: "# First\nbody", assets: [{ name: "a.png", bytes: PNG }] },
      execution: { credential, agentId, storeId, toolCallId: "t1", idempotencyKey: "native:t1" },
    }, signal);
    const ref = { kind: "document", storeId, documentId: published.identity.ref.documentId };
    const first = await service.resolveLibraryPages({ refs: [ref], includeDocuments: true, credential }, signal);
    assert.equal(first[0].status, "found");
    assert.equal(first[0].page.title, "First");
    await service.saveDocument({ locator: { storeId, documentId: published.identity.ref.documentId }, source: "# Second\nbody", credential }, signal);
    const second = await service.resolveLibraryPages({ refs: [ref], includeDocuments: true, credential }, signal);
    assert.equal(second[0].page.title, "Second");
    await assert.rejects(service.setDocumentVisibility({ locator: { storeId, documentId: published.identity.ref.documentId }, visibility: "team-view", credential }, signal));
    const third = await service.resolveLibraryPages({ refs: [ref], includeDocuments: true, credential }, signal);
    assert.equal(third[0].page.visibility, "private");
  } finally {
    service.dispose();
  }
});

test("index invalidations win over late flights", async () => {
  const indexModule = await loadModule("page-index.ts");
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const context = { principal: { accountId: "a", principalId: "p", teamIds: [] }, providerOrigin: ORIGIN, signal: AbortSignal.timeout(30000) };
  const index = indexModule.createPageIndex({
    async listCanvasSummaries() { calls += 1; await gate; return { pages: [] }; },
    ownedDocumentStores: () => [],
    async listDocumentSummaries() { return { pages: [] }; },
  });
  const flight = index.list({ includeDocuments: false }, context);
  index.invalidateAll();
  release();
  const first = await flight;
  assert.equal(first.isComplete, false);
  assert.deepEqual(first.pages, []);
  await index.list({ includeDocuments: false }, context);
  assert.equal(calls, 2);
});

test("reveal batch stays five per the golden contract", async () => {
  const golden = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "library-parity-golden.json"), "utf8"));
  assert.equal(golden.v1media.groups.constants, "TS=5 initial reveal, OS=5 pages reveal, c7=5 v2 reveal (E mUe=5 exported as c7)");
  const merge = await loadModule("library-merge.ts");
  assert.equal(merge.GROUP_REVEAL, 5);
});
