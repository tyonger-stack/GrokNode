/**
 * Local stand-in for the official client's `roster-avatars` photo cache.
 *
 * Official Grok Bot keys that cache off the cloud `avatarUrl`
 * (`sha256(avatarUrl + "#" + avatarVersion).slice(0, 32)`, see 0.62.0
 * `dist/electron-main/main-core.cjs` `sX`) and serves it over a token-authenticated
 * `sand-avatar://` endpoint, with the files living in
 * `<userData>/roster-avatars/<32 hex>` — no extension, PNG payload.
 *
 * This build is local-only: a chosen picture never has an `avatarUrl`, it is written by
 * the host straight into the box's `agents/<id>/avatar.png`. So the key is derived from the
 * image content instead. The directory shape is what we can honour locally — same folder
 * name, same 32-hex-extensionless key, same PNG bytes — but the key is NOT the same value
 * official would compute, because there is no URL to hash. That divergence is deliberate,
 * not an oversight.
 *
 * Why this lives in the coordinator: the host process runs inside the local Docker box
 * (`/home/box/sand-host`), and `/home/box/sand-data` is a docker named volume, so a host
 * write can never reach a macOS path. The coordinator is a Node utility process on the
 * desktop and already receives every `setAgentAvatarBytes` before it is forwarded to the
 * gateway, which makes it the one place on this side of the wire that can write
 * `<dataDir>/roster-avatars/`.
 */
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Directory name inside the desktop data root; matches the official client's folder. */
export const ROSTER_AVATAR_DIRNAME = "roster-avatars";

/** Official keys are `sha256(...).slice(0, 32)` — 32 lowercase hex characters, no extension. */
export const ROSTER_AVATAR_KEY_LENGTH = 32;

const ROSTER_AVATAR_KEY_PATTERN = /^[0-9a-f]{32}$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/i;

export interface RosterAvatarCopy {
  readonly key: string;
  readonly filePath: string;
  /** True when the identical bytes were already stored under this key. */
  readonly alreadyStored: boolean;
}

export function rosterAvatarStoreDir(dataDir: string): string {
  return join(dataDir, ROSTER_AVATAR_DIRNAME);
}

/** Content-addressed key: the first 32 hex characters of the image's sha256. */
export function rosterAvatarKey(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, ROSTER_AVATAR_KEY_LENGTH);
}

export function isRosterAvatarKey(value: string): boolean {
  return ROSTER_AVATAR_KEY_PATTERN.test(value);
}

/** Everything in the official store is a PNG; refuse to mirror anything else. */
export function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length > PNG_MAGIC.length && PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

export function decodeImageDataUrl(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;
  const match = DATA_URL_PATTERN.exec(value.trim());
  if (match == null) return null;
  return decodeBase64Image(match[1] ?? "");
}

export function decodeBase64Image(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;
  const compact = value.trim();
  if (compact.length === 0) return null;
  const bytes = Buffer.from(compact, "base64");
  return bytes.length === 0 ? null : bytes;
}

/**
 * Store one copy under its content key. Re-storing the same image is a no-op, so the
 * directory never accumulates duplicates when several agents share a picture.
 */
export async function writeRosterAvatarCopy(args: { readonly dataDir: string; readonly bytes: Uint8Array }): Promise<RosterAvatarCopy | null> {
  if (!isPngBytes(args.bytes)) return null;
  const key = rosterAvatarKey(args.bytes);
  const dir = rosterAvatarStoreDir(args.dataDir);
  const filePath = join(dir, key);
  const existing = await statIfPresent(filePath);
  if (existing?.isFile() === true && existing.size === args.bytes.length) return { key, filePath, alreadyStored: true };
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, args.bytes);
  return { key, filePath, alreadyStored: false };
}

async function statIfPresent(path: string) {
  try { return await stat(path); } catch { return null; }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export interface RosterAvatarStoreOptions {
  /** Desktop data root — `~/.groknode` in the packaged Grok Node build. */
  readonly dataDir: string;
  /** Raw gateway dispatch, used only for the backfill sweep. Never routes through the renderer port. */
  readonly dispatch?: (method: string, args: unknown) => Promise<unknown>;
  readonly log?: (message: string) => void;
}

export interface RosterAvatarStore {
  /**
   * Mirror the bytes carried by a `setAgentAvatarBytes` coordinator call. A null
   * `pngBase64` clears the avatar, so there is nothing to store.
   */
  readonly mirrorSetAvatarArgs: (args: unknown) => Promise<RosterAvatarCopy | null>;
  /**
   * One-shot sweep that mirrors every avatar the box already holds, so a local build that
   * adopts an existing roster ends up with a populated store instead of an empty folder.
   * Runs at most once per coordinator lifetime and only re-runs after a failure.
   */
  readonly syncExistingAvatars: () => Promise<{ readonly scanned: number; readonly mirrored: number } | null>;
}

export function createRosterAvatarStore(options: RosterAvatarStoreOptions): RosterAvatarStore {
  const log = options.log ?? ((message: string) => { process.stderr.write(`node-agent-coordinator: roster-avatar-store ${message}\n`); });
  let backfillSettled = false;

  const store = async (bytes: Uint8Array): Promise<RosterAvatarCopy | null> => {
    try { return await writeRosterAvatarCopy({ dataDir: options.dataDir, bytes }); }
    catch (error) { log(`mirror skipped: ${String(error)}`); return null; }
  };

  const mirrorSetAvatarArgs = async (args: unknown): Promise<RosterAvatarCopy | null> => {
    const record = asRecord(args);
    if (record == null || typeof record.id !== "string") return null;
    const bytes = decodeBase64Image(record.pngBase64);
    if (bytes == null) return null;
    const copy = await store(bytes);
    if (copy != null) log(`mirrored avatar for agent ${record.id} as ${copy.key}${copy.alreadyStored ? " (already stored)" : ""}`);
    return copy;
  };

  const syncExistingAvatars = async (): Promise<{ readonly scanned: number; readonly mirrored: number } | null> => {
    if (backfillSettled || options.dispatch == null) return null;
    try {
      const rows = await options.dispatch("listAgents", {});
      const agents = Array.isArray(rows) ? rows : [];
      let mirrored = 0;
      for (const row of agents) {
        const agent = asRecord(row);
        if (agent == null || typeof agent.id !== "string" || agent.avatarVersion == null) continue;
        const avatar = asRecord(await options.dispatch("getAgentAvatar", { id: agent.id }));
        const bytes = decodeImageDataUrl(avatar?.dataUrl);
        if (bytes == null) continue;
        if (await store(bytes) != null) mirrored += 1;
      }
      backfillSettled = true;
      log(`backfilled ${mirrored} of ${agents.length} agents`);
      return { scanned: agents.length, mirrored };
    } catch (error) {
      log(`backfill skipped: ${String(error)}`);
      return null;
    }
  };

  return { mirrorSetAvatarArgs, syncExistingAvatars };
}
