import { DOCUMENT_ASSET_LIMITS, type DocumentAsset } from "../../../shared/library-contracts.js";

export type ReadyAsset = Extract<DocumentAsset, { status: "ready" }>;

/** Owns its bytes; callers cannot mutate an entry through a returned DTO. */
export class DocumentAssetCache {
  private readonly entries = new Map<string, ReadyAsset>();
  private sizeBytes = 0;

  get(key: string): ReadyAsset | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { ...entry, bytes: entry.bytes.slice() };
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry !== undefined) this.sizeBytes -= entry.bytes.byteLength;
    this.entries.delete(key);
  }

  set(key: string, entry: ReadyAsset): void {
    this.delete(key);
    if (entry.etag === null || entry.bytes.byteLength > DOCUMENT_ASSET_LIMITS.cacheBytes) return;
    this.entries.set(key, { ...entry, bytes: entry.bytes.slice() });
    this.sizeBytes += entry.bytes.byteLength;
    for (const oldest of this.entries.keys()) {
      if (this.sizeBytes <= DOCUMENT_ASSET_LIMITS.cacheBytes) break;
      this.delete(oldest);
    }
  }

  clear(prefix: string): void {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.delete(key);
  }
}
