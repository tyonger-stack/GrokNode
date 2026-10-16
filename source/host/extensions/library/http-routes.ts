/**
 * R5: pure HTTPS route parsing for the Node Library receiver (Node design).
 *
 * Only the placement routines below exist: session exchange plus
 * `/documents/<store>/<id>` (`/raw`, `/assets/<name>`) and
 * `/canvas/<store>/<id>` (`/payload`). No filters, no account creation,
 * no owner switching. Every content route requires a session cookie that
 * maps to a service-issued Node credential; copied URLs never carry a
 * bearer. Malformed or foreign paths parse to null so the server answers
 * 404 without touching the catalog.
 */
import {
  canvasIdSchema,
  documentAssetNameSchema,
  documentIdSchema,
  libraryStoreIdSchema,
} from "../../../shared/library/schemas.js";
import { z } from "zod";

/** `__Host-` prefix binds the cookie to a Secure origin, Path=/, no Domain. */
export const LIBRARY_SESSION_COOKIE = "__Host-library_session";
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type LibraryHttpRoute =
  | { readonly kind: "session" }
  | { readonly kind: "document"; readonly storeId: string; readonly documentId: string; readonly variant: "page" | "raw" }
  | { readonly kind: "document-asset"; readonly storeId: string; readonly documentId: string; readonly name: string }
  | { readonly kind: "canvas"; readonly storeId: string; readonly canvasId: string; readonly variant: "page" | "payload"; readonly theme: "light" | "dark" };

export function libraryHttpRouteMethod(route: LibraryHttpRoute): readonly string[] {
  switch (route.kind) {
    case "session": return ["POST", "DELETE"];
    case "document":
    case "document-asset":
    case "canvas": return ["GET"];
  }
}

export function parseSessionCookie(header: string | null): string | null {
  if (header === null || header.length === 0) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== LIBRARY_SESSION_COOKIE) continue;
    const token = part.slice(separator + 1).trim();
    return SESSION_TOKEN.test(token) ? token : null;
  }
  return null;
}

export function buildSetSessionCookie(token: string, maxAgeSeconds: number): string {
  return `${LIBRARY_SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${LIBRARY_SESSION_COOKIE}=deleted; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function decodeSegment(raw: string | undefined, schema: z.ZodType<string>): string | null {
  if (raw === undefined || raw.length === 0) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
  // Reject non-canonical encodings (%2F tricks) before schema validation.
  if (encodeURIComponent(decoded) !== raw) return null;
  return schema.safeParse(decoded).success ? decoded : null;
}

/**
 * Parses an origin-form request target. Returns null for anything that is
 * not one of the placement routines (malformed, traversal, foreign
 * routes, unexpected queries). Callers answer 404 without catalog access.
 */
export function parseLibraryHttpRoute(method: string, target: string): LibraryHttpRoute | null {
  void method;
  if (!target.startsWith("/") || target.includes("\\") || target.includes("\0")) return null;
  const queryIndex = target.indexOf("?");
  const rawPath = queryIndex === -1 ? target : target.slice(0, queryIndex);
  const rawQuery = queryIndex === -1 ? "" : target.slice(queryIndex + 1);
  if (rawPath.includes("#")) return null;
  // Reject dot segments before any normalization can hide a traversal.
  const segments = rawPath.split("/");
  if (segments.includes("..") || segments.includes(".")) return null;
  if (segments.length === 2 && segments[1] === "session") {
    return rawQuery === "" ? { kind: "session" } : null;
  }
  if (segments.length >= 4 && segments[1] === "documents") {
    const storeId = decodeSegment(segments[2], libraryStoreIdSchema);
    const documentId = decodeSegment(segments[3], documentIdSchema);
    if (storeId === null || documentId === null) return null;
    if (segments.length === 4) {
      return rawQuery === "" ? { kind: "document", storeId, documentId, variant: "page" } : null;
    }
    if (segments.length === 5 && segments[4] === "raw") {
      return rawQuery === "" ? { kind: "document", storeId, documentId, variant: "raw" } : null;
    }
    if (segments.length === 6 && segments[4] === "assets") {
      const name = decodeSegment(segments[5], documentAssetNameSchema);
      return name !== null && rawQuery === "" ? { kind: "document-asset", storeId, documentId, name } : null;
    }
    return null;
  }
  if (segments.length >= 4 && segments[1] === "canvas") {
    const storeId = decodeSegment(segments[2], libraryStoreIdSchema);
    const canvasId = decodeSegment(segments[3], canvasIdSchema);
    if (storeId === null || canvasId === null) return null;
    if (segments.length === 4) {
      if (rawQuery === "") return { kind: "canvas", storeId, canvasId, variant: "page", theme: "light" };
      if (rawQuery === "theme=light") return { kind: "canvas", storeId, canvasId, variant: "page", theme: "light" };
      if (rawQuery === "theme=dark") return { kind: "canvas", storeId, canvasId, variant: "page", theme: "dark" };
      return null;
    }
    if (segments.length === 5 && segments[4] === "payload") {
      return rawQuery === "" ? { kind: "canvas", storeId, canvasId, variant: "payload", theme: "light" } : null;
    }
    return null;
  }
  return null;
}
