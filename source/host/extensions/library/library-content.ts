import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { closeSync, constants, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import type { LibraryExecutionContext } from "../../../shared/library-contracts.js";
import { documentAssetNameSchema } from "../../../shared/library/schemas.js";
import { LibraryContractError } from "../../../shared/library/errors.js";
import { sniffAvatarMimeType } from "../../agents/agent-avatar.js";
import { ensureSecureDirectoryChain, assertNoSymlinkInPath } from "../../../packages/agent-store-sync/paths.js";
import type { CatalogObject } from "./catalog/objects.js";
import type { NativeContentStore } from "./native-producer.js";
import { deriveDocumentTitle } from "./documents-service.js";

/**
 * Task 13a: guarded content writes behind the native producer (Node design).
 * Document source plus named assets and canvas payload manifests land
 * under library/ with private modes and atomic renames; every file the
 * catalog points at is hash-pinned before the commit. Asset bytes keep
 * the original 5 MiB bound and four image smells; canvas payloads keep
 * the original 5 MiB gzip/dataJson bounds.
 */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ASSETS = 20;
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function atomicWrite(root: string, relativePath: string, bytes: Uint8Array): void {
  if (relativePath.startsWith(sep) || relativePath.includes("\0") || relativePath.split(sep).includes("..")) {
    throw new LibraryContractError("invalid-argument", "Invalid content location");
  }
  const file = resolve(root, relativePath);
  if (!file.startsWith(root + sep)) throw new LibraryContractError("invalid-argument", "Invalid content location");
  const directory = dirname(file);
  ensureSecureDirectoryChain(directory);
  assertNoSymlinkInPath(file);
  const temporary = `${file}.tmp-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    let offset = 0;
    while (offset < bytes.byteLength) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch { void 0; }
  }
}
function checkAsset(name: string, bytes: Uint8Array): string {
  if (!documentAssetNameSchema.safeParse(name).success) {
    throw new LibraryContractError("invalid-argument", `Invalid asset name: ${name}`);
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new LibraryContractError("invalid-argument", `Asset exceeds the 5 MiB bound: ${name}`);
  }
  const sniffed = sniffAvatarMimeType(bytes);
  if (sniffed === null || !IMAGE_TYPES.has(sniffed)) {
    throw new LibraryContractError("invalid-argument", `Asset is not a supported image: ${name}`);
  }
  return sniffed;
}
export interface LibraryContentPorts {
  readonly dataRoot: string;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
}
export function createLibraryContentStore(ports: LibraryContentPorts): NativeContentStore {
  const root = resolve(ports.dataRoot);
  const now = ports.now ?? Date.now;
  const uuid = ports.randomUUID ?? randomUUID;
  return {
    async writeDocumentContent(execution, input) {
      execution.signal.throwIfAborted();
      if (input.assets.length > MAX_ASSETS) {
        throw new LibraryContractError("invalid-argument", "A document carries at most 20 assets");
      }
      const seen = new Set<string>();
      for (const asset of input.assets) {
        if (seen.has(asset.name)) throw new LibraryContractError("invalid-argument", `Duplicate asset name: ${asset.name}`);
        seen.add(asset.name);
        checkAsset(asset.name, asset.bytes);
      }
      const objectId = uuid();
      const atMs = now();
      const sourceBytes = Buffer.from(input.source, "utf8");
      const base = `library/documents/${objectId}`;
      atomicWrite(root, `${base}/source.md`, sourceBytes);
      for (const asset of input.assets) atomicWrite(root, `${base}/assets/${asset.name}`, asset.bytes);
      const title = deriveDocumentTitle(input.source) ?? objectId;
      const object: CatalogObject = {
        storeId: execution.storeId, kind: "document", objectId, title,
        createdAtMs: atMs, updatedAtMs: atMs, visibility: "private",
        contentPath: `${base}/source.md`, contentHash: sha256(sourceBytes), revision: 1,
      };
      return { object, title };
    },
    async writeCanvasPayload(execution, input) {
      execution.signal.throwIfAborted();
      if (input.renderBundleGzip.byteLength > MAX_BYTES || input.dataJson.byteLength > MAX_BYTES) {
        throw new LibraryContractError("invalid-argument", "Canvas payload exceeds the 5 MiB bound");
      }
      if (input.title.trim().length === 0) throw new LibraryContractError("invalid-argument", "Canvas publication requires a title");
      const objectId = uuid();
      const atMs = now();
      const manifest = Buffer.from(JSON.stringify({
        version: 1,
        renderBundleGzip: Buffer.from(input.renderBundleGzip).toString("base64"),
        dataJson: Buffer.from(input.dataJson).toString("base64"),
      }), "utf8");
      const contentPath = `library/canvases/${objectId}.json`;
      atomicWrite(root, contentPath, manifest);
      const object: CatalogObject = {
        storeId: execution.storeId, kind: "canvas", objectId, title: input.title,
        createdAtMs: atMs, updatedAtMs: atMs, visibility: "private",
        contentPath, contentHash: sha256(manifest), revision: 1,
      };
      return { object };
    },
  };
}
