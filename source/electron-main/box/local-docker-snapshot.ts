import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Snapshot-based Reset for the local Docker VM (Grok Node).
 *
 * The hosted product's "Reset Bot's Computer" rebuilds the cloud computer
 * from the last saved snapshot. The local connector's previous forceRecreate
 * was factory-only: `docker rm --force` + recreate from the pinned digest,
 * which keeps the named volumes but silently discards every in-container
 * change (installed packages, browser state outside the data volume, dot
 * files). This module gives the local VM the same semantics: `docker commit`
 * captures the container layer (labels survive the commit, so ownership and
 * host-sha checks still hold), the two named volumes are archived with a
 * helper container from the already-present pinned image, and Reset restores
 * both instead of rebuilding from stock.
 *
 * Docker access is injected so this module stays free of connector imports
 * (the connector imports this file) and the pure parts stay unit-testable.
 */

export interface DockerRunOutcome { readonly ok: boolean; readonly code: number | null; readonly output: string }
export type DockerRunner = (args: readonly string[]) => Promise<DockerRunOutcome>;

export interface SnapshotManifest {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly createdAt: number;
  readonly imageTag: string;
  /** Box schema the snapshot was taken under (LOCAL_DOCKER_SCHEMA_VERSION at save time): a restore across layouts would recreate the recorded dead-mount incident, so mismatched snapshots are refused. */
  readonly boxSchemaVersion: string;
  /** Archive sizes in bytes at save time (diagnostics; prune re-stats the files). */
  readonly archiveBytes?: { readonly workspace: number; readonly data: number };
}

export const SNAPSHOT_SCHEMA_VERSION = 2;
export const SNAPSHOT_KEEP_COUNT = 3;
/** Byte budget for the sum of ALL retained snapshot archives; prune drops oldest-first beyond it, always keeping the newest one. */
export const SNAPSHOT_MAX_TOTAL_BYTES = 16 * 1024 * 1024 * 1024;
/** A save needs at least this much free space on the snapshots root (or 1.5× the previous snapshot's size, whichever is larger). */
export const SNAPSHOT_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;
export const SNAPSHOT_MANIFEST_FILENAME = "manifest.json";
export const SNAPSHOT_LATEST_FILENAME = "latest.json";
const SNAPSHOT_ID_PATTERN = /^s[0-9a-z]{8,32}$/;
const SNAPSHOT_SCHEMA_PATTERN = /^[\w.-]{1,32}$/;
const SNAPSHOT_VOLUME_FILES: { readonly volume: "workspace" | "data"; readonly file: string }[] = [
  { volume: "workspace", file: "workspace.tgz" },
  { volume: "data", file: "data.tgz" },
];

export function snapshotImageRepo(container: string): string { return `${container}-snapshot`; }
export function newSnapshotId(now: () => number = Date.now): string { return `s${now().toString(36)}${randomBytes(3).toString("hex")}`; }

export function parseSnapshotManifest(raw: unknown, expectedImageRepo?: string): SnapshotManifest | null {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return null;
  if (typeof record.id !== "string" || !SNAPSHOT_ID_PATTERN.test(record.id)) return null;
  if (typeof record.createdAt !== "number" || !Number.isSafeInteger(record.createdAt) || record.createdAt <= 0) return null;
  if (typeof record.imageTag !== "string" || record.imageTag.length === 0) return null;
  // Provenance: with an expected repo, the tag must be exactly `<repo>:<id>`
  // for THIS container's snapshot store, so a tampered manifest cannot steer
  // Reset at an arbitrary image.
  if (expectedImageRepo != null && record.imageTag !== `${expectedImageRepo}:${record.id}`) return null;
  if (typeof record.boxSchemaVersion !== "string" || !SNAPSHOT_SCHEMA_PATTERN.test(record.boxSchemaVersion)) return null;
  const archiveBytes = record.archiveBytes;
  if (archiveBytes !== undefined) {
    if (typeof archiveBytes !== "object" || archiveBytes == null || Array.isArray(archiveBytes)) return null;
    const sizes = archiveBytes as Record<string, unknown>;
    if (typeof sizes.workspace !== "number" || typeof sizes.data !== "number" || !Number.isSafeInteger(sizes.workspace) || !Number.isSafeInteger(sizes.data) || sizes.workspace < 0 || sizes.data < 0) return null;
  }
  return { schemaVersion: SNAPSHOT_SCHEMA_VERSION, id: record.id, createdAt: record.createdAt, imageTag: record.imageTag, boxSchemaVersion: record.boxSchemaVersion, ...(archiveBytes === undefined ? {} : { archiveBytes: archiveBytes as { workspace: number; data: number } }) };
}

/**
 * Budget-aware prune selection: keep the newest snapshots, newest-first, while
 * (a) at most `keepCount` are kept and (b) their total size stays within
 * `budgetBytes`. Overshoot drops oldest-first. The newest snapshot is always
 * kept — a broken old archive never deletes the only Reset baseline.
 */
export function selectSnapshotsToPruneByBudget(entries: readonly { manifest: SnapshotManifest; bytes: number }[], keepCount: number = SNAPSHOT_KEEP_COUNT, budgetBytes: number = SNAPSHOT_MAX_TOTAL_BYTES): string[] {
  const sorted = [...entries].sort((a, b) => b.manifest.createdAt - a.manifest.createdAt);
  const prune: string[] = [];
  let total = 0;
  for (let index = 0; index < sorted.length; index++) {
    const entry = sorted[index]!;
    const withinCount = index < keepCount;
    const withinBudget = total + entry.bytes <= budgetBytes;
    if (index === 0 || (withinCount && withinBudget)) { total += entry.bytes; continue; }
    prune.push(entry.manifest.id);
  }
  return prune;
}

/** Pure arg builders (unit-tested): archive a named volume into the bind-mounted snapshot directory. */
export function buildVolumeArchiveArgs(args: { readonly helperImage: string; readonly volume: string; readonly destinationFile: string }): string[] {
  return [
    "run", "--rm", "--platform", "linux/amd64", "--network", "none",
    "--mount", `type=volume,src=${args.volume},dst=/src,readonly`,
    "--mount", "type=bind,src=__SNAPSHOT_DIR__,dst=/dst",
    "--entrypoint", "tar", args.helperImage, "czf", `/dst/${args.destinationFile}`, "-C", "/src", ".",
  ];
}

/** Pure arg builder (unit-tested): preflight an archive by listing it without extracting (`tar -tzf … > /dev/null`). */
export function buildArchivePreflightArgs(args: { readonly helperImage: string; readonly sourceFile: string }): string[] {
  return [
    "run", "--rm", "--platform", "linux/amd64", "--network", "none",
    "--mount", "type=bind,src=__SNAPSHOT_DIR__,dst=/src,readonly",
    "--entrypoint", "sh", args.helperImage, "-c",
    `tar -tzf /src/${args.sourceFile} > /dev/null`,
  ];
}

/** Pure arg builder (unit-tested): extract an archive into an EMPTY staging volume (no destructive step). */
export function buildTempVolumeExtractArgs(args: { readonly helperImage: string; readonly stagingVolume: string; readonly sourceFile: string }): string[] {
  return [
    "run", "--rm", "--platform", "linux/amd64", "--network", "none",
    "--mount", `type=volume,src=${args.stagingVolume},dst=/dst`,
    "--mount", "type=bind,src=__SNAPSHOT_DIR__,dst=/src,readonly",
    "--entrypoint", "tar", args.helperImage, "xzf", `/src/${args.sourceFile}`, "-C", "/dst",
  ];
}

/**
 * Pure arg builder (unit-tested): swap a verified staging volume into the
 * production volume. Runs only AFTER the staged extraction of BOTH volumes
 * succeeded, so the find-delete window is covered by an already-materialized
 * source; cp -a then copies the staged tree over.
 */
export function buildVolumeSwapArgs(args: { readonly helperImage: string; readonly stagingVolume: string; readonly targetVolume: string }): string[] {
  return [
    "run", "--rm", "--platform", "linux/amd64", "--network", "none",
    "--mount", `type=volume,src=${args.stagingVolume},dst=/src,readonly`,
    "--mount", `type=volume,src=${args.targetVolume},dst=/dst`,
    "--entrypoint", "sh", args.helperImage, "-c",
    "find /dst -mindepth 1 -delete 2>/dev/null; cp -a /src/. /dst/",
  ];
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export interface LocalDockerSnapshotStore {
  readonly root: string;
  save(): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string }>;
  latest(): Promise<SnapshotManifest | null>;
  /** Restore both volumes from the snapshot: preflight + stage into temp volumes + swap; nothing production-side is touched until the swap phase. Container recreation (from the snapshot image) stays with the connector. */
  restoreVolumes(manifest: SnapshotManifest): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
  prune(): Promise<void>;
}

export function createLocalDockerSnapshotStore(deps: {
  readonly runDocker: DockerRunner;
  readonly container: string;
  readonly workspaceVolume: string;
  readonly dataVolume: string;
  readonly helperImage: string;
  readonly root: string;
  /** Box schema this build expects (LOCAL_DOCKER_SCHEMA_VERSION); stamped into new manifests and used by the connector to refuse cross-layout restores. */
  readonly boxSchemaVersion: string;
  /** Space preflight probe; injectable for tests. Defaults to node:fs/promises statfs. */
  readonly statfs?: (path: string) => Promise<{ bavail: bigint; bsize: bigint }>;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}): LocalDockerSnapshotStore {
  const repo = snapshotImageRepo(deps.container);
  const volumeName = { workspace: deps.workspaceVolume, data: deps.dataVolume };
  const stagingName = { workspace: `${deps.workspaceVolume}-restore`, data: `${deps.dataVolume}-restore` };
  const manifestPath = (id: string): string => join(deps.root, id, SNAPSHOT_MANIFEST_FILENAME);
  const readManifest = async (id: string): Promise<SnapshotManifest | null> => {
    if (!SNAPSHOT_ID_PATTERN.test(id)) return null;
    try { return parseSnapshotManifest(JSON.parse(await readFile(manifestPath(id), "utf8")), repo); } catch { return null; }
  };
  const archiveBytes = async (id: string): Promise<number> => {
    let total = 0;
    for (const { file } of SNAPSHOT_VOLUME_FILES) {
      try { total += (await stat(join(deps.root, id, file))).size; } catch { /* missing archive counts as zero; prune may then drop it */ }
    }
    return total;
  };
  // Saves and restores serialize through one chain: a scheduled save mid-restore
  // would otherwise tar half-restored volumes and publish them as the latest
  // baseline (review life-4).
  let opChain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = opChain.then(operation, operation);
    opChain = next.then(() => undefined, () => undefined);
    return next;
  };
  const previousSnapshotBytes = async (): Promise<number> => {
    try {
      const pointer = JSON.parse(await readFile(join(deps.root, SNAPSHOT_LATEST_FILENAME), "utf8")) as Record<string, unknown>;
      if (typeof pointer.id !== "string") return 0;
      const manifest = await readManifest(pointer.id);
      return manifest == null ? 0 : await archiveBytes(manifest.id);
    } catch { return 0; }
  };
  const saveInner = async (): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string }> => {
    // Space preflight BEFORE anything touches the box: need the larger of the
    // floor and 1.5× the previous snapshot's size free on the snapshots root.
    const probe = deps.statfs ?? statfs;
    try {
      const freeBytes = Number((await probe(deps.root)).bavail) * Number((await probe(deps.root)).bsize);
      const requiredBytes = Math.max(SNAPSHOT_MIN_FREE_BYTES, Math.round((await previousSnapshotBytes()) * 1.5));
      if (freeBytes < requiredBytes) return { ok: false, error: `insufficient space on ${deps.root}: ${freeBytes} bytes free, snapshot needs ~${requiredBytes}` };
    } catch (error) {
      deps.log?.(`local-docker-snapshot: space preflight unavailable, proceeding: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Quiesce: pause the container so the committed layer and both volume
    // tars capture ONE instant instead of three torn ones (review life-3).
    // A container that is not running is already quiescent; any other pause
    // failure aborts the save.
    const paused = await deps.runDocker(["pause", deps.container]);
    const wasPaused = paused.ok;
    if (!wasPaused && !/is not running|is already paused/i.test(paused.output)) return { ok: false, error: `could not quiesce ${deps.container} for snapshot: ${paused.output}` };
    try {
      const id = newSnapshotId(deps.now);
      const directory = join(deps.root, id);
      let archivedBytes = { workspace: 0, data: 0 };
      const committed = await deps.runDocker(["commit", deps.container, `${repo}:${id}`]);
      if (!committed.ok) return { ok: false, error: `docker commit failed: ${committed.output}` };
      try {
        await mkdir(directory, { recursive: true });
        for (const { volume, file } of SNAPSHOT_VOLUME_FILES) {
          const args = buildVolumeArchiveArgs({ helperImage: deps.helperImage, volume: volumeName[volume], destinationFile: file })
            .map((argument) => argument.replaceAll("__SNAPSHOT_DIR__", directory));
          const archived = await deps.runDocker(args);
          if (!archived.ok) throw new Error(`volume ${volume} archive failed: ${archived.output}`);
        }
        archivedBytes = { workspace: (await stat(join(directory, "workspace.tgz"))).size, data: (await stat(join(directory, "data.tgz"))).size };
        const manifest: SnapshotManifest = { schemaVersion: SNAPSHOT_SCHEMA_VERSION, id, createdAt: (deps.now ?? Date.now)(), imageTag: `${repo}:${id}`, boxSchemaVersion: deps.boxSchemaVersion, archiveBytes: archivedBytes };
        await writeAtomicJson(manifestPath(id), manifest);
        await writeAtomicJson(join(deps.root, SNAPSHOT_LATEST_FILENAME), { schemaVersion: SNAPSHOT_SCHEMA_VERSION, id });
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        await deps.runDocker(["rmi", "--force", `${repo}:${id}`]).catch(() => undefined);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      deps.log?.(`local-docker-snapshot: saved ${id} (${archivedBytes.workspace + archivedBytes.data} bytes archived)`);
      await pruneInner();
      return { ok: true, id };
    } finally {
      if (wasPaused) {
        const unpaused = await deps.runDocker(["unpause", deps.container]);
        if (!unpaused.ok) deps.log?.(`local-docker-snapshot: WARNING unpause failed for ${deps.container}: ${unpaused.output}`);
      }
    }
  };
  const pruneInner = async (): Promise<void> => {
    let entries: readonly string[];
    try { entries = await readdir(deps.root); } catch { return; }
    const sized: { manifest: SnapshotManifest; bytes: number }[] = [];
    for (const entry of entries) {
      const manifest = await readManifest(entry);
      if (manifest != null) sized.push({ manifest, bytes: await archiveBytes(manifest.id) });
    }
    for (const id of selectSnapshotsToPruneByBudget(sized)) {
      await rm(join(deps.root, id), { recursive: true, force: true });
      await deps.runDocker(["rmi", "--force", `${repo}:${id}`]).catch(() => undefined);
      deps.log?.(`local-docker-snapshot: pruned ${id}`);
    }
  };
  const store: LocalDockerSnapshotStore = {
    root: deps.root,
    save: () => serialize(saveInner),
    async latest() {
      try {
        const pointer = JSON.parse(await readFile(join(deps.root, SNAPSHOT_LATEST_FILENAME), "utf8")) as Record<string, unknown>;
        return typeof pointer.id === "string" ? await readManifest(pointer.id) : null;
      } catch { return null; }
    },
    restoreVolumes: (manifest) => serialize(() => restoreInner(manifest)),
    prune: () => serialize(pruneInner),
  };
  async function restoreInner(manifest: SnapshotManifest): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
      const snapshotDirectory = join(deps.root, manifest.id);
      const stagedArgs = (args: readonly string[]): readonly string[] => args.map((argument) => argument.replaceAll("__SNAPSHOT_DIR__", snapshotDirectory));
      const cleanupStaging = async (): Promise<void> => { await deps.runDocker(["volume", "rm", "--force", stagingName.workspace, stagingName.data]); };
      if (manifest.imageTag !== `${repo}:${manifest.id}`) return { ok: false, error: `snapshot ${manifest.id} was not produced by this container's snapshot store (${manifest.imageTag})` };
      // Phase 1: preflight.
      const image = await deps.runDocker(["image", "inspect", manifest.imageTag]);
      if (!image.ok) return { ok: false, error: `preflight: snapshot image ${manifest.imageTag} is missing locally: ${image.output}` };
      for (const { volume, file } of SNAPSHOT_VOLUME_FILES) {
        const verify = await deps.runDocker(stagedArgs(buildArchivePreflightArgs({ helperImage: deps.helperImage, sourceFile: file })));
        if (!verify.ok) return { ok: false, error: `preflight: archive for volume ${volume} is unreadable: ${verify.output}` };
      }
      // Phase 2: stage into empty volumes.
      await cleanupStaging();
      try {
        for (const { volume, file } of SNAPSHOT_VOLUME_FILES) {
          const stagingVolume = stagingName[volume];
          const created = await deps.runDocker(["volume", "create", stagingVolume]);
          if (!created.ok) throw new Error(`stage: could not create staging volume for ${volume}: ${created.output}`);
          const extract = await deps.runDocker(buildTempVolumeExtractArgs({ helperImage: deps.helperImage, stagingVolume, sourceFile: file })
            .map((argument) => argument.replaceAll("__SNAPSHOT_DIR__", snapshotDirectory)));
          if (!extract.ok) throw new Error(`stage: archive for volume ${volume} failed to extract: ${extract.output}`);
        }
      } catch (error) {
        await cleanupStaging();
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      // Phase 3: swap. First destructive step is the container removal.
      const removed = await deps.runDocker(["rm", "--force", deps.container]);
      if (!removed.ok && !/no such container/i.test(removed.output)) {
        await cleanupStaging();
        return { ok: false, error: `swap: could not remove ${deps.container}: ${removed.output}` };
      }
      for (const { volume } of SNAPSHOT_VOLUME_FILES) {
        const swapped = await deps.runDocker(buildVolumeSwapArgs({ helperImage: deps.helperImage, stagingVolume: stagingName[volume], targetVolume: volumeName[volume] }));
        if (!swapped.ok) {
          await cleanupStaging();
          return { ok: false, error: `swap: volume ${volume} copy failed after staging (snapshot archives are intact; retry is safe): ${swapped.output}` };
        }
      }
      await cleanupStaging();
      deps.log?.(`local-docker-snapshot: volumes restored from ${manifest.id}`);
      return { ok: true };
  }
  return store;
}

/** Periodic best-effort snapshot, mirroring the hosted product's server-side "last saved snapshot". */
export function startLocalDockerSnapshotScheduler(deps: {
  readonly store: LocalDockerSnapshotStore;
  readonly shouldSnapshot: () => Promise<boolean>;
  readonly intervalMs?: number;
  readonly initialDelayMs?: number;
  readonly log?: (message: string) => void;
}): { dispose(): void } {
  const interval = deps.intervalMs ?? 24 * 60 * 60_000;
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, tickRunning = false;
  const tick = async (): Promise<void> => {
    if (disposed || tickRunning) return;
    tickRunning = true;
    try {
      if (await deps.shouldSnapshot()) {
        const outcome = await deps.store.save();
        if (!outcome.ok) deps.log?.(`local-docker-snapshot: scheduled save failed: ${outcome.error}`);
      }
    } catch (error) { deps.log?.(`local-docker-snapshot: scheduled save failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { tickRunning = false; }
  };
  timer = setTimeout(() => { void tick(); timer = setInterval(() => void tick(), interval); timer.unref?.(); }, deps.initialDelayMs ?? 2 * 60_000);
  timer.unref?.();
  return { dispose() { disposed = true; if (timer != null) { clearTimeout(timer); clearInterval(timer); } } };
}
