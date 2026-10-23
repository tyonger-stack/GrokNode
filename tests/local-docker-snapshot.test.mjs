import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const HELPER = "public.ecr.aws/k0i0n2g5/cursorenvironments/universal@sha256:deadbeef";
const CONTAINER = "grok-bot-local-vm";
const REPO = "grok-bot-local-vm-snapshot";
const WORKSPACE_VOLUME = "grok-bot-local-vm-workspace";
const DATA_VOLUME = "grok-bot-local-vm-data";
const STAGING_WORKSPACE = `${WORKSPACE_VOLUME}-restore`;
const STAGING_DATA = `${DATA_VOLUME}-restore`;
const manifestOf = (id = "s00000000abc", createdAt = 1) => ({ schemaVersion: 1, id, createdAt, imageTag: `${REPO}:${id}`, volumes: { workspace: "workspace.tgz", data: "data.tgz" } });

/** Recording Docker fake; fail(predicate) marks matching calls (matched against joined argv) as failed. */
function scriptedDocker(fail = () => false) {
  const calls = [];
  const run = (args) => {
    calls.push([...args]);
    return Promise.resolve(fail(args) ? { ok: false, code: 1, output: `failed: ${args.join(" ")}` } : { ok: true, code: 0, output: "" });
  };
  return { calls, run };
}
const joinAll = (calls) => calls.map((call) => call.join(" "));

async function storeWith(runner, directory) {
  return snapshot.createLocalDockerSnapshotStore({ runDocker: runner, container: CONTAINER, workspaceVolume: WORKSPACE_VOLUME, dataVolume: DATA_VOLUME, helperImage: HELPER, root: directory, now: () => 1234 });
}

test("manifest parsing enforces provenance and rejects malformed snapshots", () => {
  const manifest = manifestOf();
  assert.equal(snapshot.parseSnapshotManifest(manifest) != null, true);
  assert.equal(snapshot.parseSnapshotManifest(manifest, REPO) != null, true);
  assert.equal(snapshot.parseSnapshotManifest({ ...manifest, schemaVersion: 2 }), null);
  assert.equal(snapshot.parseSnapshotManifest({ ...manifest, id: "../escape" }, REPO), null);
  assert.equal(snapshot.parseSnapshotManifest({ ...manifest, volumes: { workspace: "../../etc.tgz", data: "data.tgz" } }, REPO), null);
  // A tampered imageTag from any other repo must not validate against this store's lineage.
  assert.equal(snapshot.parseSnapshotManifest({ ...manifest, imageTag: "evil.example/backdoor:latest" }, REPO), null);
  assert.equal(snapshot.parseSnapshotManifest(manifestOf("s1111111111"), "other-container-snapshot"), null);
});

test("prune keeps the newest snapshots only", () => {
  const manifests = [1, 5, 3, 9, 7].map((createdAt) => ({ ...manifestOf(`s${createdAt}`), createdAt }));
  assert.deepEqual(snapshot.selectSnapshotsToPrune(manifests, 3), ["s3", "s1"]);
  assert.deepEqual(snapshot.selectSnapshotsToPrune(manifests.slice(0, 2), 3), []);
});

test("volume archive, preflight, extract and swap argv are pinned", () => {
  assert.deepEqual(snapshot.buildVolumeArchiveArgs({ helperImage: HELPER, volume: WORKSPACE_VOLUME, destinationFile: "workspace.tgz" }), [
    "run", "--rm", "--platform", "linux/amd64", "--network", "none",
    "--mount", `type=volume,src=${WORKSPACE_VOLUME},dst=/src,readonly`,
    "--mount", "type=bind,src=__SNAPSHOT_DIR__,dst=/dst",
    "--entrypoint", "tar", HELPER, "czf", "/dst/workspace.tgz", "-C", "/src", ".",
  ]);
  const preflight = snapshot.buildArchivePreflightArgs({ helperImage: HELPER, sourceFile: "workspace.tgz" });
  assert.match(preflight.at(-1), /tar -tzf \/src\/workspace\.tgz > \/dev\/null/);
  assert.ok(preflight.some((argument) => argument.endsWith(",readonly")), "preflight bind must be readonly");
  const extract = snapshot.buildTempVolumeExtractArgs({ helperImage: HELPER, stagingVolume: STAGING_WORKSPACE, sourceFile: "workspace.tgz" });
  assert.equal(extract.at(-5), HELPER);
  assert.ok(extract.includes(`type=volume,src=${STAGING_WORKSPACE},dst=/dst`), "extract writes the staging volume only");
  assert.ok(!joinAll([extract]).includes(WORKSPACE_VOLUME), "extract must not touch the production volume");
  const swap = snapshot.buildVolumeSwapArgs({ helperImage: HELPER, stagingVolume: STAGING_WORKSPACE, targetVolume: WORKSPACE_VOLUME });
  assert.match(swap.at(-1), /find \/dst -mindepth 1 -delete/);
  assert.match(swap.at(-1), /cp -a \/src\/\. \/dst\//);
  assert.ok(swap.some((argument) => argument === `type=volume,src=${STAGING_WORKSPACE},dst=/src,readonly`), "swap reads staging readonly");
  assert.ok(swap.some((argument) => argument === `type=volume,src=${WORKSPACE_VOLUME},dst=/dst`), "swap writes the production volume");
});

test("store save writes commit, archives, manifest and latest pointer", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "snapstore-"));
  const fake = scriptedDocker();
  const store = await storeWith(fake.run, directory);
  const outcome = await store.save();
  assert.equal(outcome.ok, true);
  assert.match(fake.calls[0].join(" "), new RegExp(`^commit ${CONTAINER} ${REPO}:s`));
  assert.equal(fake.calls.filter((call) => call[0] === "run").length, 2);
  const id = outcome.id;
  assert.equal(existsSync(path.join(directory, id, "manifest.json")), true);
  const pointer = JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8"));
  assert.equal(pointer.id, id);
  const latest = await store.latest();
  assert.equal(latest.id, id);
  await rm(directory, { recursive: true, force: true });
});

test("restoreVolumes succeeds with preflight → stage → swap order and cleans staging", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "snapstore-"));
  await writeFile(path.join(directory, "workspace.tgz"), "x");
  const fake = scriptedDocker();
  const store = await storeWith(fake.run, directory);
  const restored = await store.restoreVolumes(manifestOf());
  assert.equal(restored.ok, true);
  const flat = joinAll(fake.calls);
  const imageInspect = flat.indexOf(`image inspect ${REPO}:s00000000abc`);
  const preflightRuns = fake.calls.filter((call) => call.at(-1)?.includes("tar -tzf")).length;
  const stagingCreate = flat.indexOf(`volume create ${STAGING_WORKSPACE}`);
  const extractRuns = fake.calls.filter((call) => call.includes("xzf")).length;
  const removeContainer = flat.indexOf(`rm --force ${CONTAINER}`);
  const swapRuns = fake.calls.filter((call) => call.at(-1)?.includes("cp -a /src/. /dst/")).length;
  const stagingCleanup = flat.indexOf(`volume rm --force ${STAGING_WORKSPACE} ${STAGING_DATA}`);
  assert.ok(imageInspect >= 0, "image existence checked");
  assert.equal(preflightRuns, 2, "both archives preflighted");
  assert.ok(stagingCreate > imageInspect, "staging created after preflight");
  assert.equal(extractRuns, 2, "both archives staged");
  assert.ok(removeContainer > fake.calls.findIndex((call) => call.includes("xzf") && call.join(" ").includes(`src=${STAGING_DATA},dst=/dst`)), "container removed only after both extracts");
  assert.equal(swapRuns, 2, "both volumes swapped");
  const lastSwap = flat.findLastIndex((line) => line.includes("cp -a /src/. /dst/"));
  assert.ok(removeContainer < lastSwap, "container removal precedes the swaps");
  assert.ok(stagingCleanup >= 0, "staging cleaned");
  assert.ok(flat.lastIndexOf(`volume rm --force ${STAGING_WORKSPACE} ${STAGING_DATA}`) > flat.lastIndexOf("cp -a /src/. /dst/"), "final cleanup after swap");
  await rm(directory, { recursive: true, force: true });
});

test("preflight failure (unreadable archive) touches nothing production-side", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "snapstore-"));
  const fake = scriptedDocker((args) => args.at(-1)?.includes("tar -tzf") === true && args.join(" ").includes("workspace"));
  const store = await storeWith(fake.run, directory);
  const restored = await store.restoreVolumes(manifestOf());
  assert.equal(restored.ok, false);
  assert.match(restored.error, /preflight: archive for volume workspace/);
  const flat = joinAll(fake.calls);
  assert.ok(!flat.includes(`rm --force ${CONTAINER}`), "container never removed");
  assert.ok(!flat.some((line) => line.includes(`volume create ${STAGING_WORKSPACE}`)), "no staging created");
  assert.ok(!flat.some((line) => line.includes(`src=${WORKSPACE_VOLUME},dst=/dst`)), "production volume never written");
  await rm(directory, { recursive: true, force: true });
});

test("missing snapshot image fails preflight before any destruction", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "snapstore-"));
  const fake = scriptedDocker((args) => args[0] === "image" && args[1] === "inspect");
  const store = await storeWith(fake.run, directory);
  const restored = await store.restoreVolumes(manifestOf());
  assert.equal(restored.ok, false);
  assert.match(restored.error, /preflight: snapshot image .* missing locally/);
  assert.ok(!joinAll(fake.calls).includes(`rm --force ${CONTAINER}`));
  await rm(directory, { recursive: true, force: true });
});

test("staging extract failure leaves container and production volumes untouched, cleans staging", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "snapstore-"));
  // Fail the staging extract for the data volume (tar xzf into staging).
  const fake = scriptedDocker((args) => args[0] === "run" && args.includes("xzf") && args.join(" ").includes(`src=${STAGING_DATA},dst=/dst`));
  const store = await storeWith(fake.run, directory);
  const restored = await store.restoreVolumes(manifestOf());
  assert.equal(restored.ok, false);
  assert.match(restored.error, /stage: archive for volume data failed to extract/);
  const flat = joinAll(fake.calls);
  assert.ok(!flat.includes(`rm --force ${CONTAINER}`), "container still alive");
  assert.ok(!flat.some((line) => line.includes(`src=${WORKSPACE_VOLUME},dst=/dst`) || line.includes(`src=${DATA_VOLUME},dst=/dst`)), "production volumes never written");
  assert.ok(flat.includes(`volume rm --force ${STAGING_WORKSPACE} ${STAGING_DATA}`), "staging cleaned on stage failure");
  await rm(directory, { recursive: true, force: true });
});

test("swap failure reports intact archives and cleans staging", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "snapstore-"));
  const fake = scriptedDocker((args) => args.at(-1)?.includes("cp -a /src/. /dst/") === true && args.join(" ").includes(`src=${DATA_VOLUME},dst=/dst`));
  const store = await storeWith(fake.run, directory);
  const restored = await store.restoreVolumes(manifestOf());
  assert.equal(restored.ok, false);
  assert.match(restored.error, /swap: volume data copy failed/);
  assert.match(restored.error, /archives are intact; retry is safe/);
  assert.ok(joinAll(fake.calls).includes(`rm --force ${CONTAINER}`), "container removal did happen (swap phase)");
  assert.ok(joinAll(fake.calls).includes(`volume rm --force ${STAGING_WORKSPACE} ${STAGING_DATA}`), "staging cleaned on swap failure");
  await rm(directory, { recursive: true, force: true });
});

test("scheduler snapshots only when the predicate admits", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "snapsched-"));
  const fake = scriptedDocker();
  const store = await storeWith(fake.run, directory);
  let admitted = false;
  const scheduler = snapshot.startLocalDockerSnapshotScheduler({ store, shouldSnapshot: async () => admitted, intervalMs: 5, initialDelayMs: 1 });
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(fake.calls.length, 0);
    admitted = true;
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(fake.calls.some((call) => call[0] === "commit"));
  } finally { scheduler.dispose(); }
  const commitsBefore = fake.calls.filter((call) => call[0] === "commit").length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fake.calls.filter((call) => call[0] === "commit").length, commitsBefore);
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
