import { fetch } from "undici";
import { DOCUMENT_ASSET_LIMITS, type DocumentAsset } from "../../../shared/library-contracts.js";
import { sniffAvatarMimeType } from "../../agents/agent-avatar.js";
import type { ReadyAsset } from "./asset-cache.js";

/** A provider opens local files only after authorization and passes a cancellable stream. */
export type AssetReadOptions = { readonly signal: AbortSignal; readonly ifNoneMatch?: string };
export type AssetResponse = {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: {
    cancel(): Promise<void>;
    getReader(): {
      read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
      cancel(): Promise<void>;
      releaseLock(): void;
    };
  } | null;
};
export type AuthorizedAssetSource =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "read"; readonly read: (options: AssetReadOptions) => Promise<AssetResponse> };

async function openAsset(source: AuthorizedAssetSource, options: AssetReadOptions): Promise<AssetResponse> {
  switch (source.kind) {
    case "url":
      return fetch(source.url, {
        signal: options.signal,
        headers: options.ifNoneMatch === undefined ? {} : { "If-None-Match": options.ifNoneMatch },
        redirect: "error",
      });
    case "read": return source.read(options);
    default: { const unreachable: never = source; return unreachable; }
  }
}

async function readBounded(response: AssetResponse, signal: AbortSignal): Promise<
  { readonly bytes: Uint8Array } | { readonly overBy: number }
> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > DOCUMENT_ASSET_LIMITS.bytes) {
    await response.body?.cancel();
    return { overBy: declared };
  }
  if (response.body === null) return { bytes: new Uint8Array() };
  const reader = response.body.getReader();
  let cancellation: Promise<void> | undefined;
  const cancel = () => { cancellation ??= reader.cancel(); return cancellation; };
  // Observe cancellation rejection immediately; the finally block still awaits it.
  const onAbort = () => { void cancel().catch(() => undefined); };
  signal.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (value === undefined) throw new TypeError("Asset stream returned no bytes");
      size += value.byteLength;
      if (size > DOCUMENT_ASSET_LIMITS.bytes) {
        await cancel();
        return { overBy: size };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes };
  } finally {
    signal.removeEventListener("abort", onAbort);
    try { await cancellation; } finally { reader.releaseLock(); }
  }
}

function normalizeEtag(value: string | null): string | null {
  const tag = value?.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  return tag ? tag : null;
}

/** Caller supplies the deadline covering headers AND the complete bounded body read. */
export async function readDocumentAsset(
  input: { readonly name: string; readonly source: AuthorizedAssetSource; readonly cached: ReadyAsset | undefined },
  signal: AbortSignal,
): Promise<DocumentAsset> {
  const { name, source, cached } = input;
  const response = await openAsset(source, {
    signal, ...(cached?.etag == null ? {} : { ifNoneMatch: `"${cached.etag}"` }),
  });
  if (signal.aborted) { await response.body?.cancel(); signal.throwIfAborted(); }
  if (response.status === 304 || response.status < 200 || response.status >= 300) {
    await response.body?.cancel();
    if (response.status === 304 && cached !== undefined) return cached;
    return response.status === 404 ? { name, status: "missing" } : { name, status: "failed", reason: `HTTP ${response.status}` };
  }
  const result = await readBounded(response, signal);
  signal.throwIfAborted();
  if ("overBy" in result) return { name, status: "too_large", sizeBytes: result.overBy };
  const contentType = sniffAvatarMimeType(result.bytes);
  switch (contentType) {
    case "image/png": case "image/jpeg": case "image/webp": case "image/gif":
      return { name, status: "ready", bytes: result.bytes, contentType, etag: normalizeEtag(response.headers.get("etag")) };
    default: return { name, status: "not_image" };
  }
}
