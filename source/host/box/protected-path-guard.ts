import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createKey } from "../../packages/context/core.js";
import { isPathWithin, realpathNearestExisting } from "../../shared/node/paths.js";
import { ASSETS_DIRNAME, ATTACHMENTS_DIRNAME } from "../attachment-paths.js";
import { SAND_BOX_DATA_ROOT, SAND_BOX_MODEL_VISIBLE_DATA_ROOT } from "../host-paths.js";
import { isSafeFolderId } from "../storage/folder-id.js";

export class SandProtectedPathError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandProtectedPathError";
  }
}

export const agentMediaReadScopeKey = createKey<string | undefined>(Symbol("agentMediaReadScope"), undefined);
export function refusalMessage(path: string): string { return `Path is inside a protected host-only store and was refused: ${path}`; }
const AGENT_MEDIA_BUCKETS = new Set([ATTACHMENTS_DIRNAME, ASSETS_DIRNAME]);

function mediaBucket(root: string, candidate: string, agentId: string | undefined): string | undefined {
  if (!isSafeFolderId(agentId) || !isPathWithin(root, candidate)) return undefined;
  const segments = relative(root, candidate).split(sep);
  const bucket = segments[2];
  return segments.length >= 4 && segments[0] === "agents" && segments[1] === agentId
    && bucket !== undefined && AGENT_MEDIA_BUCKETS.has(bucket) ? bucket : undefined;
}

export function isAgentMediaStorePath(protectedRoots: readonly string[], candidate: string, agentId?: string): boolean {
  return protectedRoots.some(root => mediaBucket(root, resolve(candidate), agentId) !== undefined);
}

export async function assertPathOutsideProtectedRoots(
  protectedRoots: readonly string[], candidatePath: string, baseDir: string, agentId?: string,
): Promise<void> {
  if (protectedRoots.length === 0) return;
  // resolve() collapses parent traversal before the filesystem follows symlinks.
  // Refuse ambiguous paths rather than authorize a different path from Read.
  if (candidatePath.split(/[/\\]/).includes("..")) throw new SandProtectedPathError(refusalMessage(candidatePath));
  const resolved = isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(baseDir, candidatePath);
  const realResolved = await realpathNearestExisting(resolved);
  for (const root of protectedRoots) {
    const normalizedRoot = resolve(root);
    const lexical = normalizedRoot === SAND_BOX_DATA_ROOT && isPathWithin(SAND_BOX_MODEL_VISIBLE_DATA_ROOT, resolved, { isInclusive: true })
      ? join(normalizedRoot, relative(SAND_BOX_MODEL_VISIBLE_DATA_ROOT, resolved)) : resolved;
    const realRoot = await realpathNearestExisting(normalizedRoot);
    const lexicalInside = isPathWithin(normalizedRoot, lexical, { isInclusive: true });
    const realInside = isPathWithin(realRoot, realResolved, { isInclusive: true });
    if (!lexicalInside && !realInside) continue;
    const lexicalBucket = mediaBucket(normalizedRoot, lexical, agentId);
    const realBucket = mediaBucket(realRoot, realResolved, agentId);
    // Aliases of the data root are valid; a media-file symlink must stay in
    // the same agent's same bucket, even when it points outside the store.
    if (realBucket === undefined || (lexicalInside && lexicalBucket !== realBucket)) {
      throw new SandProtectedPathError(refusalMessage(candidatePath));
    }
  }
}
