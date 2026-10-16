import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const docRef = { kind: "document", storeId: "node-store:a", documentId: "doc-1" };
const canvasRef = { kind: "canvas", storeId: "node-store:a", canvasId: "123e4567-e89b-42d3-a456-426614174000" };
const userCanvasRef = { kind: "active-user-store-canvas", canvasId: "123e4567-e89b-42d3-a456-426614174001" };
function context(accountId = "acc-1") {
  return { principal: { accountId, principalId: "p-1", teamIds: [] }, providerOrigin: "https://library.example.test", signal: AbortSignal.timeout(5000) };
}
function pageFor(ref) {
  return { ...ref, title: "T", createdAtMs: null, updatedAtMs: 7, visibility: "private", canShareToTeam: false };
}

test("resolve maps every input ref and skips documents when excluded", async () => {
  const { createPageResolveCache } = await loadModule("page-cache.ts");
  let calls = 0;
  const cache = createPageResolveCache({ async fetchPage(ref) { calls += 1; return ref.kind === "active-user-store-canvas" ? { status: "absent" } : { status: "found", page: pageFor(ref) }; } });
  const ctx = context();
  const rows = await cache.resolveRefs({ refs: [docRef, canvasRef, userCanvasRef, docRef], includeDocuments: true }, ctx);
  assert.equal(calls, 3);
  assert.deepEqual(rows.map((row) => row.status), ["found", "found", "absent", "found"]);
  assert.equal(rows[0].ref.documentId, "doc-1");
  assert.equal(rows[3].ref.documentId, "doc-1");
  assert.equal(rows[0].page.title, "T");
  const excluded = await cache.resolveRefs({ refs: [docRef], includeDocuments: false }, ctx);
  assert.deepEqual(excluded.map((row) => row.status), ["absent"]);
  assert.equal(calls, 3);
});

test("a wrong page identity echo resolves failed", async () => {
  const { createPageResolveCache } = await loadModule("page-cache.ts");
  const cache = createPageResolveCache({
    async fetchPage(ref) {
      return { status: "found", page: pageFor({ ...ref, documentId: "wrong" }) };
    },
  });
  const rows = await cache.resolveRefs({ refs: [docRef], includeDocuments: true }, context());
  assert.deepEqual(rows.map((row) => row.status), ["failed"]);
});

test("absent, failed and retry behave per ref", async () => {
  const { createPageResolveCache } = await loadModule("page-cache.ts");
  const seen = new Map();
  const cache = createPageResolveCache({
    async fetchPage(ref) {
      const key = ref.kind + ":" + (ref.documentId ?? ref.canvasId);
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (key.startsWith("canvas:")) return { status: "absent" };
      if (key.startsWith("active")) throw new Error("boom");
      if (count === 1) throw new Error("flaky");
      return { status: "found", page: pageFor(ref) };
    },
  });
  const ctx = context();
  const first = await cache.resolveRefs({ refs: [docRef, canvasRef, userCanvasRef], includeDocuments: true }, ctx);
  assert.deepEqual(first.map((row) => row.status), ["failed", "absent", "failed"]);
  const retried = await cache.retryFailed(ctx);
  assert.equal(retried.length, 2);
  const second = await cache.resolveRefs({ refs: [docRef, canvasRef, userCanvasRef], includeDocuments: true }, ctx);
  assert.deepEqual(second.map((row) => row.status), ["found", "absent", "failed"]);
});

test("late responses never roll back invalidated state", async () => {
  const { createPageResolveCache } = await loadModule("page-cache.ts");
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = createPageResolveCache({ async fetchPage(ref) { await gate; return { status: "found", page: pageFor(ref) }; } });
  const ctx = context();
  const pending = cache.resolveRefs({ refs: [docRef], includeDocuments: true }, ctx);
  cache.invalidateScope(ctx);
  release();
  const rows = await pending;
  assert.equal(rows[0].status, "failed");
  assert.equal(cache.peek(docRef, ctx), null);
});

test("scopes stay isolated and concurrent identical refs share one fetch", async () => {
  const { createPageResolveCache } = await loadModule("page-cache.ts");
  let calls = 0;
  const cache = createPageResolveCache({ async fetchPage(ref) { calls += 1; return { status: "found", page: pageFor(ref) }; } });
  const [a, b] = await Promise.all([
    cache.resolveRefs({ refs: [canvasRef], includeDocuments: true }, context()),
    cache.resolveRefs({ refs: [canvasRef], includeDocuments: true }, context()),
  ]);
  assert.equal(calls, 1);
  assert.equal(a[0].status, "found");
  assert.equal(b[0].status, "found");
  await cache.resolveRefs({ refs: [canvasRef], includeDocuments: true }, context("acc-2"));
  assert.equal(calls, 2);
});

test("index pages canvases, caps documents and degrades on partial failure", async () => {
  const { createPageIndex } = await loadModule("page-index.ts");
  const canvasPages = Array.from({ length: 25 }, (_, i) => [{ ...canvasRef, canvasId: `123e4567-e89b-42d3-a456-42661417${String(4000 + i).padStart(4, "0")}`, title: `C${i}`, createdAtMs: null, updatedAtMs: i, visibility: "private", canShareToTeam: false }]);
  let now = 1000000;
  let canvasCalls = 0;
  let active = 0;
  let maxActive = 0;
  const index = createPageIndex({
    async listCanvasSummaries({ pageToken }) {
      canvasCalls += 1;
      const n = pageToken === undefined ? 0 : Number(pageToken);
      return { pages: canvasPages[n] ?? [], nextPageToken: n + 1 < canvasPages.length ? String(n + 1) : undefined };
    },
    ownedDocumentStores: () => ["s1", "s2"],
    async listDocumentSummaries({ storeId }) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (storeId === "s2") throw new Error("dir unreadable");
        return { pages: [{ ...docRef, storeId, title: "D", createdAtMs: null, updatedAtMs: 1, visibility: "private", canShareToTeam: false }] };
      } finally {
        active -= 1;
      }
    },
  }, () => now);
  const ctx = context();
  const first = await index.list({ includeDocuments: true }, ctx);
  assert.equal(canvasCalls, 20);
  assert.equal(first.pages.length, 20 + 1);
  assert.equal(first.isComplete, false);
  assert.equal(first.isDegraded, true);
  assert.ok(maxActive <= 8);
  const revisit = await index.list({ includeDocuments: true }, ctx);
  assert.equal(canvasCalls, 40);
  assert.ok(revisit.listedAtMs >= first.listedAtMs);
  now += 31000;
  await index.list({ includeDocuments: false }, ctx);
  assert.equal(canvasCalls, 60);
});

test("index serves a healthy listing from the 30s cache", async () => {
  const { createPageIndex } = await loadModule("page-index.ts");
  let now = 2000000;
  let canvasCalls = 0;
  const index = createPageIndex({
    async listCanvasSummaries() { canvasCalls += 1; return { pages: [] }; },
    ownedDocumentStores: () => [],
    async listDocumentSummaries() { return { pages: [] }; },
  }, () => now);
  const ctx = context();
  const first = await index.list({ includeDocuments: false }, ctx);
  assert.equal(first.isComplete, true);
  assert.equal(canvasCalls, 1);
  const cached = await index.list({ includeDocuments: false }, ctx);
  assert.equal(canvasCalls, 1);
  assert.equal(cached.listedAtMs, first.listedAtMs);
  now += 31000;
  await index.list({ includeDocuments: false }, ctx);
  assert.equal(canvasCalls, 2);
});

test("index canvas failure fails the listing instead of faking empty", async () => {
  const { createPageIndex } = await loadModule("page-index.ts");
  const index = createPageIndex({
    async listCanvasSummaries() { throw new Error("canvas list down"); },
    ownedDocumentStores: () => [],
    async listDocumentSummaries() { return { pages: [] }; },
  });
  await assert.rejects(index.list({ includeDocuments: true }, context()), /canvas list down/);
});

test("index enforces page-size and global summary caps", async () => {
  const { createPageIndex } = await loadModule("page-index.ts");
  const canvas = { ...canvasRef, title: "C", createdAtMs: null, updatedAtMs: 1, visibility: "private", canShareToTeam: false };
  const document = { ...docRef, storeId: "store", title: "D", createdAtMs: null, updatedAtMs: 1, visibility: "private", canShareToTeam: false };
  const index = createPageIndex({
    async listCanvasSummaries() { return { pages: Array.from({ length: 51 }, () => canvas) }; },
    ownedDocumentStores: () => ["store"],
    async listDocumentSummaries() { return { pages: Array.from({ length: 201 }, (_, i) => ({ ...document, documentId: uuidForIndex(i) })) }; },
  }, () => 0);
  const result = await index.list({ includeDocuments: true }, context());
  assert.equal(result.pages.filter(page => page.kind === "canvas").length, 50);
  assert.equal(result.pages.filter(page => page.kind === "document").length, 200);
  assert.equal(result.isDegraded, true);
});

function uuidForIndex(index) {
  return `12345678-1234-4234-8234-${String(1000 + index).padStart(12, "0")}`;
}
