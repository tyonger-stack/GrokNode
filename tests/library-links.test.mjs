import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "library-links-"));
test.after(() => rm(temporary, { recursive: true, force: true }));
const output = path.join(temporary, "module.mjs");
await build({ entryPoints: [path.join(repoRoot, "source/shared/library/links.ts")], outfile: output, bundle: true, format: "esm", platform: "node", target: "node22" });
const links = await import(pathToFileURL(output).href);

const config = { nodeOrigin: "https://node-library.test" };
const canvasId = "123e4567-e89b-12d3-a456-426614174000";
const storeId = "store-123e4567-e89b-12d3-a456-426614174000";

test("node document links round-trip through parse and build", () => {
  const url = `https://node-library.test/documents/team-store/my-doc-1`;
  const parsed = links.parseLibraryLink(url, config);
  assert.deepEqual(parsed, { providerOrigin: "https://node-library.test", ref: { kind: "document", storeId: "team-store", documentId: "my-doc-1" } });
  assert.equal(links.buildLibraryLink(parsed, config), url);
});

test("node canvas links round-trip through parse and build", () => {
  const url = `https://node-library.test/canvas/team-store/${canvasId}`;
  const parsed = links.parseLibraryLink(url, config);
  assert.deepEqual(parsed, { providerOrigin: "https://node-library.test", ref: { kind: "canvas", storeId: "team-store", canvasId } });
  assert.equal(links.buildLibraryLink(parsed, config), url);
});

test("original cursor.com links keep their own provider and store bounds", () => {
  const parsed = links.parseLibraryLink(`https://cursor.com/documents/${storeId}/my-doc-1`, config);
  assert.deepEqual(parsed, { providerOrigin: "https://cursor.com", ref: { kind: "document", storeId: storeId, documentId: "my-doc-1" } });
  assert.equal(links.buildLibraryLink(parsed, config), `https://cursor.com/documents/${storeId}/my-doc-1`);
  const canvas = links.parseLibraryLink(`https://www.cursor.com/canvas/${storeId}/${canvasId}`, config);
  assert.deepEqual(canvas?.providerOrigin, "https://www.cursor.com");
  assert.equal(links.parseLibraryLink(`https://cursor.com/documents/not-a-store/my-doc-1`, config), null);
});

test("the same object id under different providers never shares an identity", () => {
  const original = links.parseLibraryLink(`https://cursor.com/documents/${storeId}/my-doc-1`, config);
  const node = links.parseLibraryLink(`https://node-library.test/documents/${storeId}/my-doc-1`, config);
  assert.notEqual(links.libraryIdentityKey(original), links.libraryIdentityKey(node));
  assert.equal(node?.providerOrigin, "https://node-library.test");
});

test("bare user-canvas paths resolve to the active-user-store locator", () => {
  const parsed = links.parseLibraryLink(`/cursor/stores/user/canvases/${canvasId}/source.canvas.tsx`, config);
  assert.deepEqual(parsed, { providerOrigin: "https://cursor.com", ref: { kind: "active-user-store-canvas", canvasId } });
  assert.deepEqual(links.canvasLocatorToRef({ kind: "active-user-store", canvasId }), parsed.ref);
  assert.deepEqual(links.canvasLocatorToRef({ kind: "store", storeId: "s", canvasId }), { kind: "canvas", storeId: "s", canvasId });
});

test("malformed, foreign and traversal links are rejected", () => {
  const bad = [
    `https://node-library.test/documents/team-store/UPPER`,
    `https://node-library.test/canvas/team-store/not-a-uuid`,
    `https://node-library.test/canvas/team-store/${canvasId}?rev=1`,
    `https://node-library.test/documents/a/b/c`,
    `http://node-library.test/documents/team-store/my-doc-1`,
    `https://evil.test/documents/team-store/my-doc-1`,
    `https://node-library.test/documents/../canvas/team-store/${canvasId}`,
    `https://node-library.test/documents/a%2Fb/my-doc-1`,
    `javascript:https://node-library.test/documents/team-store/my-doc-1`,
    "notaurl",
    "",
  ];
  for (const url of bad) assert.equal(links.parseLibraryLink(url, config), null, url);
  assert.throws(() => links.normalizeLibraryOrigin("http://node-library.test"));
  assert.throws(() => links.buildLibraryLink({ providerOrigin: "https://evil.test", ref: { kind: "document", storeId: "s", documentId: "my-doc-1" } }, config));
});

test("text and attachment messages extract each real reference once", () => {
  const doc = `https://node-library.test/documents/team-store/my-doc-1`;
  const canvas = `https://node-library.test/canvas/team-store/${canvasId}`;
  const fromText = links.extractLibraryRefs({ type: "text", content: `see [doc](${doc}) and ${canvas} plus ${doc} again and https://evil.test/x` }, config);
  assert.equal(fromText.length, 2);
  assert.deepEqual(links.buildLibraryLink(fromText[0], config), doc);
  assert.deepEqual(links.buildLibraryLink(fromText[1], config), canvas);
  const fromAttachment = links.extractLibraryRefs({ type: "attachment", url: doc }, config);
  assert.equal(fromAttachment.length, 1);
  assert.equal(links.extractLibraryRefs({ type: "text", content: "no links here" }, config).length, 0);
});
