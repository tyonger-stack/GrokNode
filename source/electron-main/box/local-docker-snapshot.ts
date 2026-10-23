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

export function parseSnapshotManifest(raw: unknown): SnapshotManifest | null {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return null;
  if (typeof record.id !== "string" || !SNAPSHOT_ID_PATTERN.test(record.id)) return null;
  if (typeof record.createdAt !== "number" || !Number.isSafeInteger(record.createdAt) || record.createdAt <= 0) return null;
  if (typeof record.imageTag !== "string" || record.imageTag.length === 0) return null;
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

/** Pure arg builders (unit-tested): wipe a named volume and unpack the archived tarball into it. */
export function buildVolumeRestoreArgs(args: { readonly helperImage: string; readonly volume: string; readonly sourceFile: string }): string[] {
  return [
    "run", "--rm", "--platform", "linux/amd64", "--network", "none",
    "--mount", `type=volume,src=${args.volume},dst=/dst`,
    "--mount", "type=bind,src=__SNAPSHOT_DIR__,dst=/src,readonly",
    "--entrypoint", "sh", args.helperImage, "-c",
    `find /dst -mindepth 1 -delete 2>/dev/null; tar xzf /src/${args.sourceFile} -C /dst`,
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
  /** Remove the container and restore both volumes from the snapshot. Container recreation (from the snapshot image) stays with the connector. */
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
  const manifestPath = (id: string): string => join(deps.root, id, SNAPSHOT_MANIFEST_FILENAME);
  const readManifest = async (id: string): Promise<SnapshotManifest | null> => {
    if (!SNAPSHOT_ID_PATTERN.test(id)) return null;
    try { return parseSnapshotManifest(JSON.parse(await readFile(manifestPath(id), "utf8"))); } catch { return null; }
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
    async restoreVolumes(manifest) {
      const removed = await deps.runDocker(["rm", "--force", deps.container]);
      if (!removed.ok && !/no such container/i.test(removed.output)) return { ok: false, error: `could not remove ${deps.container}: ${removed.output}` };
      for (const { volume, file } of SNAPSHOT_VOLUME_FILES) {
        const args = buildVolumeRestoreArgs({ helperImage: deps.helperImage, volume: volumeName[volume], sourceFile: file })
          .map((argument) => argument.replaceAll("__SNAPSHOT_DIR__", join(deps.root, manifest.id)));
        const restored = await deps.runDocker(args);
        if (!restored.ok) return { ok: false, error: `volume ${volume} restore failed: ${restored.output}` };
      }
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
