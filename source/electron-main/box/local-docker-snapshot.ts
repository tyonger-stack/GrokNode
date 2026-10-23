import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: number;
  readonly imageTag: string;
  readonly volumes: { readonly workspace: string; readonly data: string };
}

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SNAPSHOT_KEEP_COUNT = 3;
export const SNAPSHOT_MANIFEST_FILENAME = "manifest.json";
export const SNAPSHOT_LATEST_FILENAME = "latest.json";
const SNAPSHOT_ID_PATTERN = /^s[0-9a-z]{8,32}$/;
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
  const volumes = record.volumes;
  if (typeof volumes !== "object" || volumes == null || Array.isArray(volumes)) return null;
  const volumeRecord = volumes as Record<string, unknown>;
  if (typeof volumeRecord.workspace !== "string" || typeof volumeRecord.data !== "string") return null;
  if ([volumeRecord.workspace, volumeRecord.data].some((name) => !/^[\w.-]+\.tgz$/.test(name))) return null;
  return { schemaVersion: SNAPSHOT_SCHEMA_VERSION, id: record.id, createdAt: record.createdAt, imageTag: record.imageTag, volumes: { workspace: volumeRecord.workspace, data: volumeRecord.data } };
}

/** Newest-first prune selection: keep the newest `keep` by createdAt, return the ids safe to delete. */
export function selectSnapshotsToPrune(manifests: readonly SnapshotManifest[], keep: number = SNAPSHOT_KEEP_COUNT): string[] {
  const sorted = [...manifests].sort((a, b) => b.createdAt - a.createdAt);
  return sorted.slice(Math.max(0, keep)).map((manifest) => manifest.id);
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
  return {
    root: deps.root,
    async save() {
      const id = newSnapshotId(deps.now);
      const directory = join(deps.root, id);
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
        const manifest: SnapshotManifest = { schemaVersion: SNAPSHOT_SCHEMA_VERSION, id, createdAt: (deps.now ?? Date.now)(), imageTag: `${repo}:${id}`, volumes: { workspace: "workspace.tgz", data: "data.tgz" } };
        await writeAtomicJson(manifestPath(id), manifest);
        await writeAtomicJson(join(deps.root, SNAPSHOT_LATEST_FILENAME), { schemaVersion: SNAPSHOT_SCHEMA_VERSION, id });
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        await deps.runDocker(["rmi", "--force", `${repo}:${id}`]).catch(() => undefined);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      deps.log?.(`local-docker-snapshot: saved ${id}`);
      await this.prune();
      return { ok: true, id };
    },
    async latest() {
      try {
        const pointer = JSON.parse(await readFile(join(deps.root, SNAPSHOT_LATEST_FILENAME), "utf8")) as Record<string, unknown>;
        return typeof pointer.id === "string" ? await readManifest(pointer.id) : null;
      } catch { return null; }
    },
    /**
     * Three-phase restore, so a failure before the swap phase leaves
     * production untouched (tests/local-docker-snapshot.test.mjs):
     * 1. preflight — snapshot image present locally, both archives listable
     *    (`tar -tzf`); a corrupt archive or missing image fails HERE, not
     *    after the container is gone (the old wipe-then-unpack sequence could
     *    destroy a volume and deadlock the retry on the same broken archive).
     * 2. stage — extract both archives into EMPTY staging volumes; failures
     *    touch nothing production.
     * 3. swap — remove the container, then copy each staged volume over the
     *    production volume. Only this phase is destructive; its sources are
     *    fully materialized and the same byte count just wrote successfully,
     *    so the residual risk window is the final copy alone. On swap failure
     *    the snapshot archives are intact and a retry is safe.
     * Staging volumes are cleaned up on every exit path.
     */
    async restoreVolumes(manifest) {
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
    },
    async prune() {
      let entries: readonly string[];
      try { entries = await readdir(deps.root); } catch { return; }
      const manifests: SnapshotManifest[] = [];
      for (const entry of entries) {
        const manifest = await readManifest(entry);
        if (manifest != null) manifests.push(manifest);
      }
      for (const id of selectSnapshotsToPrune(manifests)) {
        await rm(join(deps.root, id), { recursive: true, force: true });
        await deps.runDocker(["rmi", "--force", `${repo}:${id}`]).catch(() => undefined);
        deps.log?.(`local-docker-snapshot: pruned ${id}`);
      }
    },
  };
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
