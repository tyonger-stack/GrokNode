import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry, prefix) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), prefix));
  const output = path.join(temporary, "module.mjs");
  await build({ entryPoints: [path.join(repoRoot, entry)], outfile: output, bundle: true, format: "esm", platform: "node", target: "node22" });
  return { module: await import(pathToFileURL(output).href), dispose: () => rm(temporary, { recursive: true, force: true }) };
}

const contracts = await bundle("source/shared/library-contracts.ts", "library-contracts-");
const library = await bundle("source/shared/library/schemas.ts", "library-schemas-");
const errors = await bundle("source/shared/library/errors.ts", "library-errors-");
const provider = await bundle("source/shared/library/provider.ts", "library-provider-");
test.after(() => Promise.all([contracts.dispose(), library.dispose(), errors.dispose(), provider.dispose()]));

const { DOCUMENT_ASSET_LIMITS } = contracts.module;
const args = library.module.libraryArgsSchemas;
const results = library.module.libraryResultSchemas;
const refs = library.module.libraryPageRefSchema;

const locator = { storeId: "store-alpha", documentId: "doc-1" };

test("all ten original methods accept their exact argument shapes", () => {
  assert.ok(args.resolveLibraryPages.safeParse({ refs: [{ kind: "document", ...locator }], includeDocuments: true }).success);
  assert.ok(args.listLibraryPages.safeParse({ includeDocuments: false }).success);
  assert.ok(args.listLibraryDocs.safeParse({ agentId: "agent-1" }).success);
  assert.ok(args.getDocument.safeParse({ locator }).success);
  assert.ok(args.getDocument.safeParse({ locator, groupChatId: "group-7" }).success);
  assert.ok(args.getDocumentEditRight.safeParse({ locator }).success);
  assert.ok(args.saveDocument.safeParse({ locator, source: "# hi" }).success);
  assert.ok(args.setDocumentVisibility.safeParse({ locator, visibility: "team-view" }).success);
  assert.ok(args.getDocumentAssets.safeParse({ locator, names: ["a.png"] }).success);
  assert.ok(args.getCanvasShare.safeParse({ locator: { kind: "active-user-store", canvasId: "123e4567-e89b-12d3-a456-426614174000" } }).success);
  assert.ok(args.setCanvasVisibility.safeParse({ locator: { kind: "store", storeId: "s", canvasId: "123e4567-e89b-12d3-a456-426614174000" }, visibility: "private" }).success);
});

test("malformed locators and stray fields are rejected at the boundary", () => {
  assert.equal(args.getDocument.safeParse({ locator: { storeId: "", documentId: "doc-1" } }).success, false);
  assert.equal(args.getDocument.safeParse({ locator: { storeId: "s", documentId: "UPPER" } }).success, false);
  assert.equal(args.getDocument.safeParse({ locator, agentId: "injected" }).success, false);
  assert.equal(args.getCanvasShare.safeParse({ locator: { kind: "store", storeId: "s", canvasId: "not-a-uuid" } }).success, false);
  assert.equal(refs.safeParse({ kind: "document", storeId: "s", documentId: "doc-1", providerOrigin: "https://x.test" }).success, false);
  assert.equal(args.listLibraryDocs.safeParse({ agentId: "" }).success, false);
});

test("asset results cover all five original variants with no invented fields", () => {
  const ok = (asset) => library.module.documentAssetSchema.safeParse(asset).success;
  assert.ok(ok({ name: "a.png", status: "ready", bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png", etag: null }));
  assert.ok(ok({ name: "a.png", status: "missing" }));
  assert.ok(ok({ name: "a.png", status: "failed", reason: "HTTP 500" }));
  assert.ok(ok({ name: "a.png", status: "too_large", sizeBytes: 9000000 }));
  assert.ok(ok({ name: "a.png", status: "not_image" }));
  assert.equal(ok({ name: "a.png", status: "missing", bytes: new Uint8Array() }), false);
  assert.equal(ok({ name: "a.png", status: "too_large" }), false);
  assert.equal(ok({ name: "a.png", status: "ready", bytes: new Uint8Array([1]), contentType: "image/tiff", etag: null }), false);
});

test("visibility setters echo only the two writable values", () => {
  assert.ok(results.setDocumentVisibility.safeParse("team-view").success);
  assert.equal(results.setDocumentVisibility.safeParse("public").success, false);
  assert.equal(results.setCanvasVisibility.safeParse("unknown").success, false);
  assert.ok(library.module.libraryShareSchema.safeParse({ visibility: "private", canShareToTeam: true }).success);
  assert.equal(library.module.libraryShareSchema.safeParse({ visibility: "public", canShareToTeam: true }).success, false);
});

test("document reads carry the group-chat echo only when the caller supplied it", () => {
  assert.ok(results.getDocument.safeParse({ locator, source: "x", share: null }).success);
  assert.ok(results.getDocument.safeParse({ locator, groupChatId: "group-7", source: "x", share: null }).success);
  assert.ok(results.getDocumentEditRight.safeParse({ locator, canEdit: true }).success);
  assert.ok(results.saveDocument.safeParse({ locator, title: "Title" }).success);
});

test("asset limits match the recovered original bounds", () => {
  assert.deepEqual({ ...DOCUMENT_ASSET_LIMITS }, { names: 20, concurrency: 4, bytes: 5242880, timeoutMs: 10000, cacheBytes: 67108864 });
});

test("error names preserve the original domain names and codes", () => {
  const cases = [
    ["DocumentNotFoundError", "not-found"], ["DocumentReadOnlyError", "read-only"],
    ["DocumentRejectedError", "rejected"], ["DocumentVisibilityEchoError", "visibility-echo"],
    ["CanvasStoreUnavailableError", "store-unavailable"], ["CanvasPayloadIdentityError", "identity-mismatch"],
    ["CanvasShareIdentityError", "identity-mismatch"], ["CanvasVisibilityEchoError", "visibility-echo"],
  ];
  for (const [name, code] of cases) {
    const error = new errors.module[name]("probe");
    assert.equal(error.name, name);
    assert.equal(error.code, code);
    assert.ok(error instanceof errors.module.LibraryContractError);
  }
});

test("the provider module carries no runtime loader; trust lives in types only", () => {
  assert.deepEqual(Object.keys(provider.module), []);
});
