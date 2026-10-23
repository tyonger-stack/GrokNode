import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const cacheDir = path.join(root, "node_modules", ".cache");
await mkdir(cacheDir, { recursive: true });

const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };

const snapshotOut = path.join(cacheDir, "local-docker-snapshot.cjs");
await build({ entryPoints: [path.join(root, "source/electron-main/box/local-docker-snapshot.ts")], bundle: true, platform: "node", format: "cjs", outfile: snapshotOut, logLevel: "error" });
const snapshot = createRequire(import.meta.url)(snapshotOut);

const fakeDocker = (log) => (args) => { log.push(args); return Promise.resolve({ ok: true, code: 0, output: "" }); };
const HELPER = "public.ecr.aws/k0i0n2g5/cursorenvironments/universal@sha256:deadbeef";

test("manifest parsing rejects malformed snapshots", () => {
  const manifest = { schemaVersion: 1, id: "s00000000abc", createdAt: 1, imageTag: "grok-bot-local-vm-snapshot:s00000000abc", volumes: { workspace: "workspace.tgz", data: "data.tgz" } };
  assert.equal(snapshot.parseSnapshotManifest(manifest) != null, true);
  assert.equal(snapshot.parseSnapshotManifest({ ...manifest, schemaVersion: 2 }), null);
  assert.equal(snapshot.parseSnapshotManifest({ ...manifest, id: "../escape" }), null);
  assert.equal(snapshot.parseSnapshotManifest({ ...manifest, volumes: { workspace: "../../etc.tgz", data: "data.tgz" } }), null);
  assert.equal(snapshot.parseSnapshotManifest({ ...manifest, createdAt: -1 }), null);
  assert.equal(snapshot.parseSnapshotManifest("junk"), null);
});

test("prune keeps the newest snapshots only", () => {
  const manifests = [1, 5, 3, 9, 7].map((createdAt) => ({ schemaVersion: 1, id: `s${createdAt}`, createdAt, imageTag: `r:s${createdAt}`, volumes: { workspace: "workspace.tgz", data: "data.tgz" } }));
  // newest-first keeps 9, 7, 5; the rest are prunable, newest-first among the pruned.
  assert.deepEqual(snapshot.selectSnapshotsToPrune(manifests, 3), ["s3", "s1"]);
  assert.deepEqual(snapshot.selectSnapshotsToPrune(manifests.slice(0, 2), 3), []);
});

test("volume archive and restore argv are pinned", () => {
  assert.deepEqual(snapshot.buildVolumeArchiveArgs({ helperImage: HELPER, volume: "vm-workspace", destinationFile: "workspace.tgz" }), [
    "run", "--rm", "--platform", "linux/amd64", "--network", "none",
    "--mount", "type=volume,src=vm-workspace,dst=/src,readonly",
    "--mount", "type=bind,src=__SNAPSHOT_DIR__,dst=/dst",
    "--entrypoint", "tar", HELPER, "czf", "/dst/workspace.tgz", "-C", "/src", ".",
  ]);
  const restore = snapshot.buildVolumeRestoreArgs({ helperImage: HELPER, volume: "vm-data", sourceFile: "data.tgz" });
  assert.equal(restore.at(-3), HELPER);
  assert.match(restore.at(-1), /find \/dst -mindepth 1 -delete/);
  assert.match(restore.at(-1), /tar xzf \/src\/data\.tgz -C \/dst/);
  assert.ok(restore.includes("--network"));
  assert.ok(restore.some((argument) => argument.endsWith(",readonly")), "snapshot bind must be readonly");
});

test("store save writes commit, archives, manifest and latest pointer", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "snapstore-"));
  const calls = [];
  const store = snapshot.createLocalDockerSnapshotStore({ runDocker: fakeDocker(calls), container: "grok-bot-local-vm", workspaceVolume: "vm-workspace", dataVolume: "vm-data", helperImage: HELPER, root: directory, now: () => 1234 });
  const outcome = await store.save();
  assert.equal(outcome.ok, true);
  assert.match(calls[0].join(" "), /^commit grok-bot-local-vm grok-bot-local-vm-snapshot:s/);
  assert.equal(calls.filter((call) => call[0] === "run").length, 2);
  const id = outcome.id;
  assert.equal(existsSync(path.join(directory, id, "manifest.json")), true);
  const pointer = JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8"));
  assert.equal(pointer.id, id);
  const manifest = JSON.parse(await readFile(path.join(directory, id, "manifest.json"), "utf8"));
  assert.equal(manifest.imageTag, `grok-bot-local-vm-snapshot:${id}`);
  assert.equal(manifest.createdAt, 1234);
  const latest = await store.latest();
  assert.equal(latest.id, id);
  await rm(directory, { recursive: true, force: true });
});

test("store restoreVolumes removes the container then restores both volumes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "snapstore-"));
  const calls = [];
  const store = snapshot.createLocalDockerSnapshotStore({ runDocker: fakeDocker(calls), container: "grok-bot-local-vm", workspaceVolume: "vm-workspace", dataVolume: "vm-data", helperImage: HELPER, root: directory, now: () => 1234 });
  const manifest = { schemaVersion: 1, id: "s00000000abc", createdAt: 1, imageTag: "grok-bot-local-vm-snapshot:s00000000abc", volumes: { workspace: "workspace.tgz", data: "data.tgz" } };
  const restored = await store.restoreVolumes(manifest);
  assert.equal(restored.ok, true);
  assert.deepEqual(calls[0], ["rm", "--force", "grok-bot-local-vm"]);
  const runCalls = calls.filter((call) => call[0] === "run");
  assert.equal(runCalls.length, 2);
  const expectedBind = `type=bind,src=${path.join(directory, "s00000000abc")},dst=/src,readonly`;
  assert.ok(runCalls.every((call) => call.includes(expectedBind)), "restore must bind the snapshot directory readonly");
  await rm(directory, { recursive: true, force: true });
});

test("scheduler snapshots only when the predicate admits", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "snapsched-"));
  const calls = [];
  const store = snapshot.createLocalDockerSnapshotStore({ runDocker: fakeDocker(calls), container: "grok-bot-local-vm", workspaceVolume: "vm-workspace", dataVolume: "vm-data", helperImage: HELPER, root: directory, now: () => 1234 });
  let admitted = false;
  const scheduler = snapshot.startLocalDockerSnapshotScheduler({ store, shouldSnapshot: async () => admitted, intervalMs: 5, initialDelayMs: 1 });
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(calls.length, 0);
    admitted = true;
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(calls.some((call) => call[0] === "commit"));
  } finally { scheduler.dispose(); }
  const commitsBefore = calls.filter((call) => call[0] === "commit").length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.filter((call) => call[0] === "commit").length, commitsBefore);
  await rm(directory, { recursive: true, force: true });
});

// Guard (same convention as tests/local-docker-host-identity.test.mjs): the
// snapshot-restore branch in the connector must survive refactors — Reset
// must restore volumes and recreate from the snapshot image, not factory-wipe.
const connectorSource = readFileSync(path.join(root, "source/electron-main/box/local-docker-host-connector.ts"), "utf8");
test("connector keeps the snapshot-aware reset and image acceptance", () => {
  assert.match(connectorSource, /const isSnapshotImage = inspected\.image\.startsWith\(`\$\{snapshotImageRepo\(LOCAL_DOCKER_BOX_CONTAINER\)\}:`\)/);
  assert.match(connectorSource, /snapshotStore\.restoreVolumes\(latest\)/);
  assert.match(connectorSource, /ensureLocalDockerBox\(settings\.settingsPath, latest\.imageTag\)/);
  assert.match(connectorSource, /pre-replace snapshot/);
});
