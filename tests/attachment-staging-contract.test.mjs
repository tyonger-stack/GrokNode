import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
await import("node:fs/promises").then((fs) => fs.mkdir(path.join(root, "node_modules", ".cache"), { recursive: true }));
const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };
const cacheDir = path.join(root, "node_modules", ".cache");

const attachOut = path.join(cacheDir, "attachment-staging-contract.cjs");
await build({ entryPoints: [path.join(root, "source/electron-main/attachments/attachments.ts")], bundle: true, platform: "node", format: "cjs", outfile: attachOut, logLevel: "error", plugins: [jsToTs] });
const attachApi = createRequire(import.meta.url)(attachOut);

const preloadOut = path.join(cacheDir, "attachment-staging-preload.cjs");
await build({ entryPoints: [path.join(root, "source/electron-preload/preload.ts")], bundle: true, platform: "node", format: "cjs", outfile: preloadOut, logLevel: "error", plugins: [jsToTs] });
const preloadApi = createRequire(import.meta.url)(preloadOut);

test("host stageBytes stores Uint8Array and tolerates ArrayBuffer", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "attach-staging-"));
  try {
    const failures = [];
    const port = attachApi.createAttachmentEdgePort({
      getStagingDir: () => dir,
      byteLimitForName: () => 25 * 1024 * 1024,
      isWithinStagingDir: (p) => p.startsWith(dir),
      onEdgeFailure: (info) => failures.push(info),
      now: () => 7,
      randomUUID: () => "fixed-id",
    });
    const bytes = new Uint8Array([104, 105]);
    const stored = await port.stageBytes("a.md", bytes);
    assert.equal(stored.ok, true);
    assert.equal(await readFile(stored.path, "utf8"), "hi");
    const fromBuffer = await port.stageBytes("b.md", bytes.buffer.slice(0));
    assert.equal(fromBuffer.ok, true);
    const crossRealmBytes = runInNewContext("new Uint8Array([104, 105])");
    assert.equal(crossRealmBytes instanceof Uint8Array, false);
    const crossRealm = await port.stageBytes("cross-realm.md", crossRealmBytes);
    assert.equal(crossRealm.ok, true);
    assert.equal(await readFile(crossRealm.path, "utf8"), "hi");
    assert.deepEqual(await port.stageBytes("c.md", [104, 105]), { ok: false, reason: "failed" });
    assert.deepEqual(await port.stageBytes("empty.md", new Uint8Array(0)), { ok: false, reason: "empty" });
    assert.deepEqual(failures, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("stageBytes generates an id when no UUID dependency is supplied", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "attach-uuid-"));
  try {
    const port = attachApi.createAttachmentEdgePort({
      getStagingDir: () => dir,
      byteLimitForName: () => 25 * 1024 * 1024,
      onEdgeFailure: () => {},
    });
    const staged = await port.stageBytes("a.md", new Uint8Array([104, 105]));
    assert.equal(staged.ok, true);
    assert.equal(await readFile(staged.path, "utf8"), "hi");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("preload bridge accepts the upstream object call shape", async () => {
  const calls = [];
  const mainEdge = new Proxy({ subscribe: () => () => {} }, { get: (t, method) => t[method] ?? (async (...args) => { calls.push({ method, args }); return { ok: true }; }) });
  const desktop = preloadApi.createDesktopPreloadBridge({
    ipc: { invoke: async () => ({}), on: () => {}, off: () => {} },
    webFrame: {},
    mainEdge,
    env: {},
    devRestartEnabled: false,
    initialState: {},
  });
  const bytes = new Uint8Array([1, 2, 3]);
  await desktop.stageAttachmentBytes({ filename: "a.md", bytes });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [{ filename: "a.md", bytes }]);
  await desktop.stageAttachmentBytes("b.md", bytes);
  assert.deepEqual(calls[1].args, [{ filename: "b.md", bytes }]);
  await desktop.commitStagedAttachments({ paths: ["p"], filenames: ["a.md"] });
  assert.deepEqual(calls[2].args, [{ paths: ["p"], filenames: ["a.md"] }]);
  await desktop.discardStagedAttachment({ path: "p" });
  assert.deepEqual(calls[3].args, [{ path: "p" }]);
});

test("upstream object call shape stages end to end", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "attach-e2e-"));
  try {
    const port = attachApi.createAttachmentEdgePort({
      getStagingDir: () => dir,
      byteLimitForName: () => 25 * 1024 * 1024,
      isWithinStagingDir: (p) => p.startsWith(dir),
      onEdgeFailure: () => {},
      now: () => 7,
      randomUUID: () => "fixed-id",
    });
    let payload;
    const mainEdge = new Proxy({ subscribe: () => () => {} }, { get: (t, method) => t[method] ?? (async (...args) => { payload = args[0]; return port.stageBytes(payload.filename, payload.bytes); }) });
    const desktop = preloadApi.createDesktopPreloadBridge({
      ipc: { invoke: async () => ({}), on: () => {}, off: () => {} },
      webFrame: {},
      mainEdge,
      env: {},
      devRestartEnabled: false,
      initialState: {},
    });
    const staged = await desktop.stageAttachmentBytes({ filename: "dr-eggbot-bot-profile.md", bytes: new Uint8Array([104, 105]) });
    assert.equal(staged.ok, true);
    assert.equal(await readFile(staged.path, "utf8"), "hi");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
