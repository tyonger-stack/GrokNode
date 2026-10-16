import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const libraryRoot = path.join(repoRoot, "source/host/extensions/library");
mkdirSync(path.join(repoRoot, "node_modules/.cache"), { recursive: true });
const outRoot = mkdtempSync(path.join(repoRoot, "node_modules/.cache/library-recovery-"));
test.after(() => rmSync(outRoot, { recursive: true, force: true }));
let bundleCount = 0;

async function loadLibrary(entryName, mutate) {
  const entry = path.join(libraryRoot, entryName);
  const target = mutate == null ? null : path.join(libraryRoot, mutate.file);
  const outfile = path.join(outRoot, `bundle-${bundleCount += 1}.cjs`);
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    outfile,
    logLevel: "silent",
    plugins: [{
      name: "library-recovery-mutation",
      setup(build) {
        build.onLoad({ filter: /\.ts$/ }, (args) => {
          if (target == null || args.path !== target) return null;
          const source = readFileSync(args.path, "utf8");
          assert.equal(source.split(mutate.from).length - 1, 1, `expected unique anchor in ${mutate.file}`);
          return { contents: source.replace(mutate.from, mutate.to), loader: "ts" };
        });
      },
    }],
  });
  return createRequire(import.meta.url)(outfile);
}

test("dropping the reveal step of five hides rows the original still shows", async () => {
  const items = [1, 2, 3, 4, 5, 6, 7];
  const original = await loadLibrary("library-merge.ts");
  const mutant = await loadLibrary("library-merge.ts", {
    file: "library-merge.ts", from: "export const GROUP_REVEAL = 5;", to: "export const GROUP_REVEAL = 4;",
  });
  assert.equal(original.visibleGroupItems(items, 0).length, 5);
  assert.equal(mutant.visibleGroupItems(items, 0).length, 4);
});

test("dropping external docs removes the third source from the merge", async () => {
  const doc = { key: "n1", provider: "notion", externalId: "x", url: "https://notion.so/x", title: "Notes", createdByBot: true, lastAction: "created", firstTouchedAtMs: 1, lastTouchedAtMs: 2 };
  const original = await loadLibrary("library-merge.ts");
  const mutant = await loadLibrary("library-merge.ts", {
    file: "library-merge.ts",
    from: `...args.docs.map((doc): LibraryRow => ({
      kind: "external-doc", key: \`doc:\${doc.key}\`,
      timestampMs: doc.lastTouchedAtMs, doc,
    })),`,
    to: "",
  });
  assert.deepEqual(original.mergeLibrarySources({ pages: [], docs: [doc], media: [] }).map((row) => row.kind), ["external-doc"]);
  assert.deepEqual(mutant.mergeLibrarySources({ pages: [], docs: [doc], media: [] }).map((row) => row.kind), []);
});

test("dropping the epoch guard lets a late response repopulate an invalidated page", async (t) => {
  const ref = { kind: "document", storeId: "node-store:a", documentId: "doc-1" };
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 5000);
  t.after(() => { clearTimeout(deadline); controller.abort(); });
  const context = { principal: { accountId: "acc-1", principalId: "p-1", teamIds: [] }, providerOrigin: "https://library.example.test", signal: controller.signal };
  const page = { ...ref, title: "T", createdAtMs: null, updatedAtMs: 7, visibility: "private", canShareToTeam: false };
  async function observe(mod) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const cache = mod.createPageResolveCache({ async fetchPage() { await gate; return { status: "found", page }; } });
    const pending = cache.resolveRefs({ refs: [ref], includeDocuments: true }, context);
    cache.invalidateScope(context);
    release();
    const results = await pending;
    return { cached: cache.peek(ref, context), results };
  }
  const original = await loadLibrary("page-cache.ts");
  const mutant = await loadLibrary("page-cache.ts", {
    file: "page-cache.ts", from: 'if (atEpoch !== epoch) return { status: "failed", ref: result.ref };', to: "",
  });
  const baseline = await observe(original);
  const mutated = await observe(mutant);
  t.diagnostic(`R11 ${JSON.stringify({ scenario: "epoch", baseline, mutant: mutated })}`);
  assert.equal(baseline.cached, null);
  assert.deepEqual(baseline.results, [{ status: "failed", ref }]);
  assert.equal(mutated.cached.status, "found");
  assert.deepEqual(mutated.cached.page, page);
  assert.deepEqual(mutated.cached.ref, ref);
  assert.deepEqual(mutated.results, [{ status: "found", ref, page }]);
});

test("dropping the credential check accepts an unknown library credential", async (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "library-recovery-catalog-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 5000);
  t.after(() => { clearTimeout(deadline); controller.abort(); });
  const signal = controller.signal;
  async function resolveUnknown(mod) {
    const catalog = new mod.LibraryCatalog({ dataRoot: dir, providerOrigin: "https://library.example.test" });
    try {
      return catalog.identity.resolveCredential("not-a-real-credential", signal);
    } finally {
      catalog.close();
    }
  }
  const original = await loadLibrary("catalog.ts");
  const mutant = await loadLibrary("catalog.ts", {
    file: "identity.ts",
    from: 'if (!row) throw new LibraryCatalogError("denied", "Invalid Node Library credential");',
    to: 'if (!row) return { principal: { accountId: "forged", principalId: "forged", teamIds: [] }, providerOrigin: this.origin, signal };',
  });
  await assert.rejects(resolveUnknown(original), /credential/);
  assert.equal((await resolveUnknown(mutant)).principal.accountId, "forged");
});

test("dropping transcript visual sources removes image rows", async (t) => {
  const entries = [{ id: "e", kind: "send-message", timestampMs: 1, message: { type: "text", content: "pic", images: [{ url: "file:///a/shot.png", alt: "Shot" }] } }];
  const original = await loadLibrary("transcript-media.ts");
  const mutant = await loadLibrary("transcript-media.ts", {
    file: "transcript-media.ts",
    from: 'const sourceClass = classifyMediaSource(entry, visual.source, excluded);\n      if (sourceClass === "returned-artifact" || (!includeUserUploads && sourceClass !== "bot")) continue;',
    to: "continue;",
  });
  const baseline = original.extractTranscriptMedia(entries);
  const mutated = mutant.extractTranscriptMedia(entries);
  t.diagnostic(`R11 ${JSON.stringify({ scenario: "visual", baseline, mutant: mutated })}`);
  assert.deepEqual(baseline, [{ kind: "image", id: "e:visual:file:///a/shot.png", timestampMs: 1, source: "file:///a/shot.png", name: "Shot" }]);
  assert.deepEqual(mutated, []);
  assert.deepEqual(original.extractConversationMedia(entries), baseline);
  assert.deepEqual(mutant.extractConversationMedia(entries), []);
});

test("dropping scope cleanup leaves an in-flight asset read running", async () => {
  const args = { locator: { storeId: "store-a", documentId: "doc-a" }, names: ["fig.png"] };
  async function outcome(mod) {
    const controller = new AbortController();
    const context = { principal: { accountId: "account-a", principalId: "owner-a", teamIds: [] }, providerOrigin: "https://library.example", signal: controller.signal };
    let release;
    const entered = new Promise((resolve) => { release = resolve; });
    const service = mod.createDocumentAssetService({
      authorizeAssets() { release(); return new Promise(() => {}); },
    });
    let timer;
    try {
      const pending = service.getDocumentAssets(args, context);
      await entered;
      service.clearScope(context);
      return await Promise.race([
        pending.then(() => "resolved", (error) => error?.name ?? "error"),
        new Promise((resolve) => { timer = setTimeout(() => resolve("hung"), 40); }),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
      service.dispose();
    }
  }
  const original = await loadLibrary("document-assets.ts");
  const mutant = await loadLibrary("document-assets.ts", {
    file: "document-assets.ts",
    from: `for (const [controller, scope] of active) {
        if (scope === prefix) controller.abort(new DOMException("Document asset scope cleared", "AbortError"));
      }`,
    to: "",
  });
  assert.equal(await outcome(original), "AbortError");
  assert.equal(await outcome(mutant), "hung");
});
