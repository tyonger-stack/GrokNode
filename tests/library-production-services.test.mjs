import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(repoRoot, "node_modules/.cache"), { recursive: true });
const temporary = await mkdtemp(path.join(repoRoot, "node_modules/.cache/library-production-"));
test.after(() => rm(temporary, { recursive: true, force: true }));

async function load(entry, name) {
  const output = path.join(temporary, `${name}.mjs`);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node26",
    external: ["electron", "undici"],
    logLevel: "silent",
  });
  return import(pathToFileURL(output).href);
}

const extension = await load("source/host/extensions/library/extension.ts", "extension");
const links = await load("source/shared/library/links.ts", "links");
const bytes = await load("source/shared/library/json-bytes.ts", "json-bytes");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const signal = () => AbortSignal.timeout(5000);

test("native publish survives restart, ack, and a foreign credential", async () => {
  const dataRoot = path.join(temporary, "catalog");
  const first = extension.createLibraryHostService({ dataRoot });
  const credential = first.mainCredential();
  const agentId = "agent-production";
  const storeId = extension.LIBRARY_MAIN_STORE;
  first.catalog.identity.assignAgent({ ...first.catalog.identity.resolveCredential(credential, signal()).principal, agentId }, true);
  const published = await first.publishNativeArtifact({
    input: {
      kind: "document",
      source: "# Field notes\n\n![pixel](pixel.png)\n",
      assets: [{ name: "pixel.png", bytes: new Uint8Array(PNG) }],
    },
    execution: { credential, agentId, storeId, toolCallId: "call-1", idempotencyKey: "native-artifact:call-1" },
  }, signal());
  assert.match(published.url, /^https:\/\/groknode\.local\/documents\/node-local-store\/[0-9a-f-]{36}$/);
  const pending = first.pendingPublications({ credential, agentId, storeId }, signal());
  assert.equal(pending.length, 1);
  assert.equal(pending[0].event.url, published.url);
  const refs = links.extractLibraryRefs({ type: "text", content: `see ${published.url}` }, { nodeOrigin: "https://groknode.local" });
  assert.equal(refs.length, 1);
  assert.equal(refs[0].ref.kind, "document");
  const documentId = published.url.split("/").at(-1);
  const replay = await first.publishNativeArtifact({
    input: { kind: "document", source: "# Other\n", assets: [] },
    execution: { credential, agentId, storeId, toolCallId: "call-1", idempotencyKey: "native-artifact:call-1" },
  }, signal());
  assert.equal(replay.url, published.url);
  first.dispose();

  const restarted = extension.createLibraryHostService({ dataRoot });
  assert.equal(restarted.mainCredential(), credential);
  const stillPending = restarted.pendingPublications({ credential, agentId, storeId }, signal());
  assert.equal(stillPending.length, 1);
  const document = await restarted.getDocument({ credential, locator: { storeId, documentId } }, signal());
  assert.match(document.source, /Field notes/);
  const assets = await restarted.getDocumentAssets({ credential, locator: { storeId, documentId }, names: ["pixel.png"] }, signal());
  assert.equal(Buffer.from(assets.assets[0].bytes).equals(PNG), true);
  await assert.rejects(() => restarted.getDocument({ credential: "forged-credential", locator: { storeId, documentId } }, signal()));
  const acked = restarted.acknowledgePublishedLinks({
    credential, agentId, storeId, messageId: "message-1", content: `opened ${published.url}`, publishedAtMs: 1_700_000_000_000,
  }, signal());
  assert.deepEqual(acked, [pending[0].event.eventId]);
  assert.deepEqual(restarted.pendingPublications({ credential, agentId, storeId }, signal()), []);

  const bundle = gzipSync(Buffer.from("bundle-bytes"));
  const dataJson = Buffer.from('{"cells":[]}');
  const canvas = await restarted.publishNativeArtifact({
    input: { kind: "canvas", title: "Board", renderBundleGzip: new Uint8Array(bundle), dataJson: new Uint8Array(dataJson) },
    execution: { credential, agentId, storeId, toolCallId: "call-2", idempotencyKey: "native-artifact:call-2" },
  }, signal());
  const canvasId = canvas.url.split("/").at(-1);
  const payload = await restarted.getCanvasPayload({ credential, locator: { kind: "store", storeId, canvasId } }, signal());
  assert.equal(Buffer.from(payload.renderBundleGzip).equals(bundle), true);
  assert.equal(Buffer.from(payload.dataJson).equals(dataJson), true);
  restarted.dispose();
});

test("gateway byte codec round-trips nested binary fields", () => {
  const encoded = bytes.encodeLibraryJson({ assets: [{ bytes: new Uint8Array([1, 2, 3]) }], title: "notes" });
  assert.equal(encoded.assets[0].bytes.$b64, Buffer.from([1, 2, 3]).toString("base64"));
  const decoded = bytes.decodeLibraryJson(encoded);
  assert.ok(decoded.assets[0].bytes instanceof Uint8Array);
  assert.deepEqual([...decoded.assets[0].bytes], [1, 2, 3]);
  assert.equal(decoded.title, "notes");
});
