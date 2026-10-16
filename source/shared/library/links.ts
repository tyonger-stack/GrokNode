import type { CanvasLocator, LibraryIdentity, LibraryPageRef } from "../library-contracts.js";
import { LibraryContractError } from "./errors.js";
import { canvasIdSchema, documentIdSchema, libraryPageRefSchema, libraryStoreIdSchema, originalStoreIdSchema } from "./schemas.js";

export type LibraryLinkConfig = { readonly nodeOrigin: string };
export type LibraryMessage = { readonly type: "text"; readonly content: string } | { readonly type: "attachment"; readonly url: string };
const originalOrigins = new Set(["https://cursor.com", "https://www.cursor.com"]);
const userCanvasPrefix = "/cursor/stores/user/canvases/";

export function normalizeLibraryOrigin(value: string): string {
  const url = URL.parse(value);
  if (url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "" || /[\s\\]/u.test(value)) {
    throw new LibraryContractError("invalid-argument", "Library provider must be an HTTPS origin.");
  }
  return url.origin;
}
function nodeOrigin(config: LibraryLinkConfig): string {
  const origin = normalizeLibraryOrigin(config.nodeOrigin);
  if (originalOrigins.has(origin)) throw new LibraryContractError("invalid-argument", "Original provider cannot be configured as a Node provider.");
  return origin;
}
function unreachable(value: never): never {
  throw new LibraryContractError("invalid-argument", `Unknown Library variant: ${String(value)}`);
}
export function libraryIdentityKey(identity: LibraryIdentity): string {
  const ref = libraryPageRefSchema.parse(identity.ref);
  const origin = normalizeLibraryOrigin(identity.providerOrigin);
  switch (ref.kind) {
    case "document": return JSON.stringify([origin, ref.kind, ref.storeId, ref.documentId]);
    case "canvas": return JSON.stringify([origin, ref.kind, ref.storeId, ref.canvasId]);
    case "active-user-store-canvas": return JSON.stringify([origin, ref.kind, ref.canvasId]);
    default: return unreachable(ref);
  }
}
export function canvasLocatorToRef(locator: CanvasLocator): LibraryPageRef {
  switch (locator.kind) {
    case "store": return { kind: "canvas", storeId: locator.storeId, canvasId: locator.canvasId };
    case "active-user-store": return { kind: "active-user-store-canvas", canvasId: locator.canvasId };
    default: return unreachable(locator);
  }
}
export function parseLibraryLink(value: string, config: LibraryLinkConfig): LibraryIdentity | null {
  const origin = nodeOrigin(config);
  const input = value.trim();
  if (input.startsWith(userCanvasPrefix)) {
    const parts = input.slice(userCanvasPrefix.length).split("/");
    const id = canvasIdSchema.safeParse(parts[0]);
    return parts.length === 2 && parts[1] === "source.canvas.tsx" && id.success
      ? { providerOrigin: "https://cursor.com", ref: { kind: "active-user-store-canvas", canvasId: id.data } } : null;
  }
  if (/[\s\\\u0000-\u001f\u007f]/u.test(input)) return null;
  const url = URL.parse(input);
  if (url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "" || (url.origin !== origin && !originalOrigins.has(url.origin))) return null;
  // Reject dot-segment normalization before URL can turn a different route into a valid identity.
  const rawPath = input.replace(/^https:\/\/[^/]+/i, "").split(/[?#]/, 1)[0];
  if (rawPath !== url.pathname) return null;
  const parts = url.pathname.split("/");
  if (parts.length !== 4 || parts[0] !== "" || parts[2] === undefined || parts[3] === undefined) return null;
  let store: string;
  try { store = decodeURIComponent(parts[2]); }
  catch (error) { if (error instanceof URIError) return null; throw error; }
  const storeSchema = originalOrigins.has(url.origin) ? originalStoreIdSchema : libraryStoreIdSchema;
  if (!storeSchema.safeParse(store).success) return null;
  switch (parts[1]) {
    case "documents": {
      const id = documentIdSchema.safeParse(parts[3]);
      if (!id.success || (url.origin === origin && (url.search !== "" || url.hash !== ""))) return null;
      return { providerOrigin: url.origin, ref: { kind: "document", storeId: store, documentId: id.data } };
    }
    case "canvas": {
      const id = canvasIdSchema.safeParse(parts[3]);
      if (!id.success || url.search !== "" || url.hash !== "") return null;
      return { providerOrigin: url.origin, ref: { kind: "canvas", storeId: store, canvasId: id.data } };
    }
    default: return null;
  }
}
export function buildLibraryLink(identity: LibraryIdentity, config: LibraryLinkConfig): string {
  const origin = normalizeLibraryOrigin(identity.providerOrigin);
  const configured = nodeOrigin(config);
  if (origin !== configured && !originalOrigins.has(origin)) throw new LibraryContractError("identity-mismatch", "Unknown Library provider origin.");
  const ref = libraryPageRefSchema.parse(identity.ref);
  if (ref.kind !== "active-user-store-canvas" && originalOrigins.has(origin)) originalStoreIdSchema.parse(ref.storeId);
  switch (ref.kind) {
    case "document": return `${origin}/documents/${encodeURIComponent(ref.storeId)}/${ref.documentId}`;
    case "canvas": return `${origin}/canvas/${encodeURIComponent(ref.storeId)}/${ref.canvasId}`;
    case "active-user-store-canvas":
      if (origin !== "https://cursor.com") throw new LibraryContractError("store-unavailable", "Resolve the active store before building an HTTPS link.");
      return `${userCanvasPrefix}${ref.canvasId}/source.canvas.tsx`;
    default: return unreachable(ref);
  }
}
export function extractLibraryRefs(message: LibraryMessage, config: LibraryLinkConfig): readonly LibraryIdentity[] {
  let links: readonly string[];
  switch (message.type) {
    case "attachment": links = [message.url]; break;
    case "text":
      links = [...message.content.matchAll(/\[[^\]\n]*\]\(([^()\s]+)\)|https:\/\/[^\s<>()[\]]+|\/cursor\/stores\/user\/canvases\/[^\s<>()[\]]+/gi)]
        .map(match => match[1] ?? match[0].replace(/[.,;!]+$/, ""));
      break;
    default: return unreachable(message);
  }
  const result = new Map<string, LibraryIdentity>();
  for (const link of links) {
    const identity = parseLibraryLink(link, config);
    if (identity !== null) result.set(libraryIdentityKey(identity), identity);
  }
  return [...result.values()];
}
