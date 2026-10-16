import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(repoRoot, ".omo", "tmp"), { recursive: true });
const outRoot = mkdtempSync(path.join(repoRoot, ".omo", "tmp", "library-chain-bundle-"));
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
const NOW = Date.now();
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

test("publish, transcript reference, resolve, merge and group close the loop", async () => {
  const dir = mkdtempSync(path.join(repoRoot, ".omo", "tmp", "library-chain-"));
  const extension = await loadModule("extension.ts");
  const media = await loadModule("transcript-media.ts");
  const merge = await loadModule("library-merge.ts");
  const agentId = "agent-chain";
  const service = extension.createLibraryHostService({ dataRoot: dir, providerOrigin: ORIGIN, transcript: { listAgentIds: () => [agentId], getAgentTranscriptPage: () => ({ entries: [] }) } });
  try {
    const credential = service.mainCredential();
    const signal = AbortSignal.timeout(30000);
    const storeId = "node-local-store";
    const publish = await service.publishNativeArtifact({
      input: { kind: "document", source: "# Chain report\nbody", assets: [{ name: "fig.png", bytes: PNG }] },
      execution: { credential, agentId, storeId, toolCallId: "tc-1", idempotencyKey: "native:tc-1" },
    }, signal);
    assert.match(publish.url, new RegExp(`^${ORIGIN.replace(/\//g, "\\/")}/documents/`));
    const pending = service.pendingPublications({ credential, agentId, storeId }, signal);
    assert.equal(pending.length, 1);
    const entries = [
      { id: "m1", kind: "send-message", timestampMs: NOW - 3600000, message: { type: "text", content: `see ${publish.url} plus shot`, images: [{ url: "file:///a/shot.png", alt: "Shot" }] } },
    ];
    const acked = service.acknowledgePublishedLinks({ credential, agentId, storeId, messageId: "msg-1", content: `see ${publish.url} plus shot`, publishedAtMs: NOW }, signal);
    assert.deepEqual(acked, [publish.eventId]);
    assert.equal(service.pendingPublications({ credential, agentId, storeId }, signal).length, 0);
    const rows = merge.mergeLibrarySources({
      pages: [],
      docs: [],
      media: media.extractTranscriptMedia(entries),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "media");
    const groups = merge.groupLibraryRows(rows, NOW);
    assert.deepEqual(groups.map((group) => group.key), ["today"]);
    assert.equal(groups[0].items.length, 1);
    const resolved = await service.resolveLibraryPages({ refs: [{ kind: "document", storeId, documentId: publish.identity.ref.documentId }], includeDocuments: true, credential }, signal);
    assert.equal(resolved[0].status, "found");
    assert.equal(resolved[0].page.title, "Chain report");
    const read = await service.getDocument({ locator: { storeId, documentId: publish.identity.ref.documentId }, credential }, signal);
    assert.equal(read.source, "# Chain report\nbody");
    const assets = await service.getDocumentAssets({ locator: { storeId, documentId: publish.identity.ref.documentId }, names: ["fig.png"], credential }, signal);
    assert.equal(assets.assets[0].status, "ready");
  } finally {
    service.dispose();
  }
});
