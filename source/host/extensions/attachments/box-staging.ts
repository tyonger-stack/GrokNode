import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import type { Context } from "../../../packages/context/core.js";
import { videoMimeFromPath } from "../../../shared/media/image-mime.js";
import { isPathWithin } from "../../../shared/node/paths.js";
import { findSystemErrno } from "../../../shared/system-errno.js";
import { ASSETS_DIRNAME, ATTACHMENTS_DIRNAME } from "../../attachment-paths.js";
import type { TransferBox } from "../../box/box-transfer.js";
import { getSandRootDir, reanchorSandPath, SAND_BOX_DATA_ROOT, SAND_BOX_MODEL_VISIBLE_DATA_ROOT } from "../../host-paths.js";
import { isSafeFolderId } from "../../storage/folder-id.js";

export const SAND_BOX_STAGE_MAX_BYTES = 50 * 1024 * 1024;
export const SAND_BOX_UPLOADS_DIR = "/workspace/uploads";
export type AttachmentStageFailure = "path_rejected" | "video" | "not_file" | "too_large" | "missing_file" | "file_unreadable" | "read_failed" | "box_unavailable" | "upload_failed";
export type AttachmentStageResult =
  | { readonly path: string; readonly kind: "staged"; readonly boxPath: string }
  | { readonly path: string; readonly kind: "skipped" | "failed"; readonly reason: AttachmentStageFailure; readonly retryable: boolean };
export interface BoxStagingDependencies<C extends Context = Context> {
  readonly ctx: C;
  readonly box: TransferBox & { runState(ctx: C, agentId: string): Promise<string> };
  readonly resolveOwnerDir: (path: string) => string | null;
  readonly upload: (ctx: C, box: BoxStagingDependencies<C>["box"], agentId: string, files: readonly { boxPath: string; data: Uint8Array }[]) => Promise<void>;
  /** Internal bookkeeping only: callers must not forward raw paths to telemetry. */
  readonly onResult?: (result: AttachmentStageResult) => void;
}

/** Preserve the caller's map keys, but use the current host root for filesystem IO. */
export function attachmentStagingPath(path: string): string {
  const root = getSandRootDir();
  for (const alias of [SAND_BOX_MODEL_VISIBLE_DATA_ROOT, SAND_BOX_DATA_ROOT]) {
    if (isPathWithin(alias, path, { isInclusive: true })) return join(root, relative(alias, path));
  }
  return isAbsolute(path) ? resolve(reanchorSandPath(path)) : path;
}

class StagingSkip extends Error {
  constructor(readonly reason: AttachmentStageFailure) { super(reason); }
}

async function resolveStagingFile(deps: Pick<BoxStagingDependencies, "resolveOwnerDir">, agentId: string, path: string): Promise<{ source: string; real: string }> {
  if (!isSafeFolderId(agentId) || agentId.trim() !== agentId || !isAbsolute(path)) throw new StagingSkip("path_rejected");
  const root = resolve(getSandRootDir()), realRoot = await realpath(root);
  let source = attachmentStagingPath(path);
  // Accept aliases of the data root, preserving the lexical agent and bucket.
  if (!isPathWithin(root, source)) {
    const boundary = source.indexOf(`${sep}agents${sep}${agentId}${sep}`);
    const aliasRoot = boundary < 0 ? null : source.slice(0, boundary) || sep;
    if (aliasRoot === null || await realpath(aliasRoot) !== realRoot) throw new StagingSkip("path_rejected");
    source = join(root, relative(aliasRoot, source));
  }
  const owner = join(root, "agents", agentId);
  const declaredOwner = deps.resolveOwnerDir(source);
  if (declaredOwner === null || resolve(declaredOwner) !== owner || !isPathWithin(owner, source)) throw new StagingSkip("path_rejected");
  const bucket = relative(owner, source).split(sep)[0];
  if (bucket !== ATTACHMENTS_DIRNAME && bucket !== ASSETS_DIRNAME) throw new StagingSkip("path_rejected");
  const real = await realpath(source);
  // Resolve the root, not the bucket: resolving a symlinked bucket/agent would
  // otherwise turn a cross-agent or host-secret escape into an allowed root.
  if (!isPathWithin(join(realRoot, "agents", agentId, bucket), real)) throw new StagingSkip("path_rejected");
  if (videoMimeFromPath(real) !== undefined) throw new StagingSkip("video");
  return { source, real };
}

export async function stageAttachmentsIntoBox<C extends Context>(deps: BoxStagingDependencies<C>, agentId: string, hostPaths: readonly string[]): Promise<Map<string, string>> {
  const staged = new Map<string, string>();
  const report = (result: AttachmentStageResult) => { try { deps.onResult?.(result); } catch { /* Diagnostics must not interrupt transfers. */ } };
  let running: boolean | undefined;
  for (const hostPath of new Set(hostPaths)) {
    if (deps.ctx.canceled) break;
    let phase: "read" | "upload" = "read";
    try {
      if (videoMimeFromPath(hostPath) !== undefined) throw new StagingSkip("video");
      const { source, real } = await resolveStagingFile(deps, agentId, hostPath);
      deps.ctx.signal.throwIfAborted();
      const info = await stat(real);
      if (!info.isFile()) throw new StagingSkip("not_file");
      if (info.size > SAND_BOX_STAGE_MAX_BYTES) throw new StagingSkip("too_large");
      if (running === undefined) {
        try { running = await deps.box.runState(deps.ctx, agentId) === "running"; } catch { running = false; }
      }
      deps.ctx.signal.throwIfAborted();
      if (!running) {
        report({ path: hostPath, kind: "failed", reason: "box_unavailable", retryable: true });
        continue;
      }
      const handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
      let data: Buffer;
      try {
        const opened = await handle.stat();
        if (!opened.isFile()) throw new StagingSkip("not_file");
        if (opened.size > SAND_BOX_STAGE_MAX_BYTES) throw new StagingSkip("too_large");
        // The box probe may have yielded while a directory was replaced. Check
        // the opened inode against a freshly validated same-bucket path before
        // reading bytes; O_NOFOLLOW alone only protects the final component.
        const verified = await resolveStagingFile(deps, agentId, hostPath);
        const verifiedInfo = await stat(verified.real);
        if (verified.real !== real || verifiedInfo.dev !== opened.dev || verifiedInfo.ino !== opened.ino) throw new StagingSkip("path_rejected");
        data = await handle.readFile({ signal: deps.ctx.signal });
        if (data.byteLength > SAND_BOX_STAGE_MAX_BYTES) throw new StagingSkip("too_large");
      } finally { await handle.close(); }
      deps.ctx.signal.throwIfAborted();
      const boxPath = posix.join(SAND_BOX_UPLOADS_DIR, basename(source));
      phase = "upload";
      // One file at a time preserves partial success and bounds resident bytes.
      await deps.upload(deps.ctx, deps.box, agentId, [{ boxPath, data }]);
      deps.ctx.signal.throwIfAborted();
      staged.set(hostPath, boxPath);
      report({ path: hostPath, kind: "staged", boxPath });
    } catch (error) {
      if (deps.ctx.canceled) break;
      const errno = findSystemErrno(error);
      const reason = error instanceof StagingSkip ? error.reason
        : phase === "upload" ? "upload_failed"
        : errno === "ENOENT" ? "missing_file"
        : errno === "EACCES" || errno === "EPERM" ? "file_unreadable"
        : errno === "ELOOP" ? "path_rejected" : "read_failed";
      const retryable = reason === "read_failed" || reason === "upload_failed";
      report({ path: hostPath, kind: retryable ? "failed" : "skipped", reason, retryable });
    }
  }
  return staged;
}
