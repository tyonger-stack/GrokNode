import type { CanvasLocator, CanvasPayload, LibraryShare, LibraryWriteVisibility } from "../../../shared/library-contracts.js";
import { canvasIdSchema, canvasLocatorSchema, libraryStoreIdSchema } from "../../../shared/library/schemas.js";
import { LibraryContractError } from "../../../shared/library/errors.js";

export const SAND_CANVAS_SCHEME = "sand-canvas";
export const CANVAS_FRAME_HOST = "frame";
const CANVAS_FRAME_REVISION = /^[\w.:-]{1,128}$/u;

export type CanvasTheme = "light" | "dark";
export type CanvasFrameRequest = {
  readonly locator: CanvasLocator;
  readonly theme: CanvasTheme;
  readonly groupChatId?: string;
  readonly revision?: string;
};
export type CanvasDecodedContent = {
  readonly bundleJsonText: string;
  readonly dataJsonText: string;
};
export type CanvasContentDecode =
  | { readonly status: 200; readonly content: CanvasDecodedContent }
  | { readonly status: 422 };
export type CanvasBundleDecode =
  | { readonly isDecoded: true; readonly bundleJsonText: string }
  | { readonly isDecoded: false; readonly errorClass: string };

export const CANVAS_PAYLOAD_LIMITS = {
  compressedBundleBytes: 5_000_000,
  decompressedBundleBytes: 20_000_000,
} as const;

class CanvasDecompressedTooLargeError extends Error {
  constructor() {
    super("Canvas bundle decompressed beyond the original limit");
    this.name = "CanvasDecompressedTooLargeError";
  }
}

function revisionSuffix(revision: string | null): string {
  return revision !== null && CANVAS_FRAME_REVISION.test(revision) ? `&rev=${revision}` : "";
}

export function buildCanvasFrameUrl(
  locator: CanvasLocator,
  theme: CanvasTheme,
  groupChatId?: string,
  revision?: string,
): string {
  const parsed = canvasLocatorSchema.parse(locator);
  if (theme !== "light" && theme !== "dark") {
    throw new LibraryContractError("invalid-argument", "Canvas frame theme must be light or dark.");
  }
  const revisionText = revisionSuffix(revision ?? null);
  switch (parsed.kind) {
    case "active-user-store":
      return `${SAND_CANVAS_SCHEME}://${CANVAS_FRAME_HOST}/user/${parsed.canvasId}?theme=${theme}${revisionText}`;
    case "store": {
      const room = groupChatId === undefined ? "" : `&room=${encodeURIComponent(canvasIdSchema.parse(groupChatId))}`;
      return `${SAND_CANVAS_SCHEME}://${CANVAS_FRAME_HOST}/store/${encodeURIComponent(parsed.storeId)}/${parsed.canvasId}?theme=${theme}${room}${revisionText}`;
    }
  }
}

export function parseCanvasFrameUrl(value: string): CanvasFrameRequest | null {
  let url: URL;
  try { url = new URL(value); }
  catch { return null; }
  if (url.protocol !== `${SAND_CANVAS_SCHEME}:` || url.hostname !== CANVAS_FRAME_HOST || url.port !== "" ||
      url.username !== "" || url.password !== "" || url.hash !== "") return null;
  const theme = url.searchParams.get("theme");
  if (theme !== "light" && theme !== "dark") return null;
  const rawRoom = url.searchParams.get("room");
  const room = rawRoom === null ? null : canvasIdSchema.safeParse(rawRoom);
  if (room !== null && !room.success) return null;
  const revision = url.searchParams.get("rev");
  if (revision !== null && !CANVAS_FRAME_REVISION.test(revision)) return null;
  const canonical = `?theme=${theme}${room === null ? "" : `&room=${room.data}`}${revisionSuffix(revision)}`;
  if (url.search !== canonical) return null;
  const segments = url.pathname.split("/");
  const canvas = canvasIdSchema.safeParse(segments.at(-1) ?? "");
  if (!canvas.success) return null;
  if (segments.length === 3 && segments[0] === "" && segments[1] === "user") {
    return room !== null ? null : {
      locator: { kind: "active-user-store", canvasId: canvas.data },
      theme,
      ...(revision === null ? {} : { revision }),
    };
  }
  if (segments.length === 4 && segments[0] === "" && segments[1] === "store") {
    let rawStore: string;
    try { rawStore = decodeURIComponent(segments[2] ?? ""); }
    catch (error) { if (error instanceof URIError) return null; throw error; }
    if (segments[2] !== encodeURIComponent(rawStore)) return null;
    const store = libraryStoreIdSchema.safeParse(rawStore);
    if (!store.success) return null;
    return {
      locator: { kind: "store", storeId: store.data, canvasId: canvas.data },
      theme,
      ...(room === null ? {} : { groupChatId: room.data }),
      ...(revision === null ? {} : { revision }),
    };
  }
  return null;
}

async function gunzipBounded(input: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([new Uint8Array(input)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) throw new TypeError("Canvas bundle stream returned no bytes");
    size += value.byteLength;
    if (size > CANVAS_PAYLOAD_LIMITS.decompressedBundleBytes) {
      await reader.cancel();
      throw new CanvasDecompressedTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function classifyDecodeError(error: unknown): string {
  if (error instanceof CanvasDecompressedTooLargeError) return "decompressed-too-large";
  if (!(error instanceof Error)) return typeof error;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? `${error.name} (${code})` : error.name;
}

function isBundleV1(value: unknown): value is { version: number; runtimeEsm: string; userModule: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && typeof record.runtimeEsm === "string" && typeof record.userModule === "string";
}

function isBundleV1Text(text: string): boolean {
  if (!text.trimStart().startsWith("{")) return false;
  try { return isBundleV1(JSON.parse(text)); }
  catch { return false; }
}

export async function decodeCanvasRenderBundle(renderBundleGzip: Uint8Array): Promise<CanvasBundleDecode> {
  if (renderBundleGzip.byteLength === 0) return { isDecoded: false, errorClass: "empty" };
  if (renderBundleGzip.byteLength > CANVAS_PAYLOAD_LIMITS.compressedBundleBytes) {
    return { isDecoded: false, errorClass: "compressed-too-large" };
  }
  let bundleJsonText: string;
  try {
    bundleJsonText = new TextDecoder("utf-8", { fatal: true }).decode(await gunzipBounded(renderBundleGzip));
  } catch (error) {
    return { isDecoded: false, errorClass: classifyDecodeError(error) };
  }
  return isBundleV1Text(bundleJsonText)
    ? { isDecoded: true, bundleJsonText }
    : { isDecoded: false, errorClass: "invalid-bundle" };
}

export async function decodeCanvasContent(payload: CanvasPayload): Promise<CanvasContentDecode> {
  const bundle = await decodeCanvasRenderBundle(payload.renderBundleGzip);
  if (!bundle.isDecoded) return { status: 422 };
  try {
    const dataJsonText = payload.dataJson.byteLength === 0
      ? "{}"
      : new TextDecoder("utf-8", { fatal: true }).decode(payload.dataJson);
    return { status: 200, content: { bundleJsonText: bundle.bundleJsonText, dataJsonText } };
  } catch {
    return { status: 422 };
  }
}

function parseVisibility(value: unknown): LibraryWriteVisibility | null {
  switch (value) {
    case "CANVAS_VISIBILITY_PRIVATE": return "private";
    case "CANVAS_VISIBILITY_TEAM_VIEW": return "team-view";
    default: return null;
  }
}

export function parseCanvasShareJson(value: unknown): LibraryShare | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const visibility = parseVisibility(record.visibility);
  return visibility === null || typeof record.canShareToTeam !== "boolean"
    ? null
    : { visibility, canShareToTeam: record.canShareToTeam };
}

export function parseCanvasVisibilityEcho(value: unknown): LibraryWriteVisibility | null {
  return parseVisibility(value);
}
