import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Socket } from "node:net";
import { Buffer } from "node:buffer";
import type { LibraryHostService } from "./extension.js";
import { buildLibraryLink, normalizeLibraryOrigin } from "../../../shared/library/links.js";
import { LibraryContractError } from "../../../shared/library/errors.js";
import { decodeCanvasContent, type CanvasDecodedContent } from "./canvas-protocol.js";
import { deriveDocumentTitle, DocumentNotFoundError } from "./documents-service.js";
import { LibraryCatalogError } from "./migrations.js";
import {
  buildSetSessionCookie,
  clearSessionCookie,
  libraryHttpRouteMethod,
  parseLibraryHttpRoute,
  parseSessionCookie,
  type LibraryHttpRoute,
} from "./http-routes.js";
import { LibraryHttpSessions } from "./http-session.js";
import { renderDocumentPageHtml } from "./http-markdown.js";
import { extractDocumentAssetNames } from "../../../shared/library/document-assets.js";
import { renderLibraryHttpCanvasFrame, type LibraryHttpCanvasTheme } from "./http-canvas-frame.js";

export const LIBRARY_HTTPS_LOOPBACK_HOSTS = ["127.0.0.1", "::1", "localhost"] as const;
export const LIBRARY_HTTPS_UNREACHABLE_ORIGIN = "https://groknode.local";

const SESSION_BODY_LIMIT = 4096;
const SESSION_MAX_AGE_SECONDS = 12 * 3600;
const REQUEST_TIMEOUT_MS = 30000;

const DOCUMENT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
class LibraryHttpDeniedError extends Error {
  override readonly name = "LibraryHttpDeniedError";
  constructor() {
    super("Invalid Node Library credential");
  }
}
const CANVAS_CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; sandbox allow-scripts; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export type LibraryHttpTls = { readonly key: string | Buffer; readonly cert: string | Buffer };

export interface StartLibraryHttpServerOptions {
  readonly service: LibraryHostService;
  readonly providerOrigin: string;
  readonly host: string;
  readonly port: number;
  readonly tls: LibraryHttpTls;
  readonly canvasFrameRenderer?: (
    content: CanvasDecodedContent,
    theme: LibraryHttpCanvasTheme,
    title: string,
  ) => string;
  readonly sessionTtlMs?: number;
}

export interface LibraryHttpHandle {
  readonly origin: string;
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

export interface LibraryHttpEnvConfig {
  readonly providerOrigin: string;
  readonly host: string;
  readonly port: number;
  readonly tls: LibraryHttpTls;
}

function failClosed(message: string): never {
  throw new Error(`Library HTTPS receiver disabled: ${message}`);
}

export function resolveLibraryHttpConfigFromEnv(serviceOrigin?: string): LibraryHttpEnvConfig | null {
  const originRaw = process.env.SAND_LIBRARY_ORIGIN ?? "";
  const host = process.env.SAND_LIBRARY_LISTEN_HOST ?? "127.0.0.1";
  const keyFile = process.env.SAND_LIBRARY_TLS_KEY_FILE ?? "";
  const certFile = process.env.SAND_LIBRARY_TLS_CERT_FILE ?? "";
  if (originRaw === "" && keyFile === "" && certFile === "") return null;
  if (originRaw === "") failClosed("SAND_LIBRARY_ORIGIN is required for TLS.");
  if (keyFile === "" || certFile === "") failClosed("SAND_LIBRARY_TLS_KEY_FILE and SAND_LIBRARY_TLS_CERT_FILE are both required.");
  const providerOrigin = normalizeLibraryOrigin(originRaw);
  if (serviceOrigin !== undefined && providerOrigin !== normalizeLibraryOrigin(serviceOrigin)) {
    failClosed(`SAND_LIBRARY_ORIGIN ${providerOrigin} does not match the service origin.`);
  }
  const url = new URL(providerOrigin);
  if (url.hostname.startsWith("[")) {
    failClosed(`IPv6 origin ${providerOrigin} is owned by R10; this receiver serves IPv4 loopback only.`);
  }
  const loopback = (LIBRARY_HTTPS_LOOPBACK_HOSTS as readonly string[]).includes(host);
  const originLoopback = (LIBRARY_HTTPS_LOOPBACK_HOSTS as readonly string[]).includes(url.hostname);
  const internalContainerBind =
    process.env.SAND_LIBRARY_INTERNAL_CONTAINER === "1" && host === "0.0.0.0" && originLoopback;
  if (!loopback && process.env.SAND_LIBRARY_PUBLIC_OK !== "1" && !internalContainerBind) {
    failClosed(`Non-loopback listen host ${host} requires SAND_LIBRARY_PUBLIC_OK=1; without it the receiver stays loopback-only.`);
  }
  if (host.trim() === "") failClosed("SAND_LIBRARY_LISTEN_HOST is empty.");
  const port = url.port === "" ? 443 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) failClosed(`Origin ${providerOrigin} carries no usable port.`);
  let key: string;
  let cert: string;
  try {
    key = readFileSync(keyFile, "utf8");
    cert = readFileSync(certFile, "utf8");
  } catch {
    failClosed("TLS key or cert file is unreadable.");
  }
  if (key.trim() === "" || cert.trim() === "") failClosed("TLS key or cert file is empty.");
  return { providerOrigin, host, port, tls: { key, cert } };
}

function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    ...(extra ?? {}),
  };
}

function send(res: ServerResponse, status: number, headers: Record<string, string>, body?: string | Uint8Array): void {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown, extra?: Record<string, string>): void {
  send(res, status, baseHeaders({ "content-type": "application/json; charset=utf-8", ...(extra ?? {}) }), JSON.stringify(value));
}

function contractStatus(error: unknown): number {
  if (error instanceof DocumentNotFoundError) return 404;
  if (error instanceof LibraryContractError) {
    switch (error.code) {
      case "not-found":
      case "store-unavailable":
        return 404;
      case "read-only":
        return 403;
      case "invalid-argument":
        return 400;
      case "identity-mismatch":
      case "visibility-echo":
      case "rejected":
        return 500;
    }
  }
  return 500;
}

function readBody(request: IncomingMessage, limit: number, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      request.destroy();
      reject(error);
    };
    const onAbort = (): void => fail(new Error("Request aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) fail(new Error("Request body too large"));
      else chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(Buffer.concat(chunks));
    });
    request.on("error", fail);
  });
}

export async function startLibraryHttpServer(options: StartLibraryHttpServerOptions): Promise<LibraryHttpHandle> {
  const providerOrigin = normalizeLibraryOrigin(options.providerOrigin);
  if (providerOrigin !== options.service.getLibraryOrigin()) {
    throw new Error(`Library HTTPS origin ${providerOrigin} does not match the service origin.`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Library HTTPS requires an explicit port; got ${options.port}.`);
  }
  if (options.host.trim() === "") throw new Error("Library HTTPS requires an explicit listen host.");
  const originUrl = new URL(providerOrigin);
  const originPort = originUrl.port === "" ? 443 : Number(originUrl.port);
  if (originPort !== options.port) {
    throw new Error(`Library HTTPS port ${options.port} does not match the provider origin ${providerOrigin}.`);
  }
  if (options.tls.key.length === 0 || options.tls.cert.length === 0) {
    throw new Error("Library HTTPS requires a key and a cert.");
  }
  const sessions = new LibraryHttpSessions(Date.now, options.sessionTtlMs ?? SESSION_MAX_AGE_SECONDS * 1000);
  const renderFrame =
    options.canvasFrameRenderer ??
    ((content: CanvasDecodedContent, theme: LibraryHttpCanvasTheme, title: string) =>
      renderLibraryHttpCanvasFrame(content, theme, title));
  const originHostHeader = new URL(providerOrigin).host;
  const service = options.service;

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const target = request.url ?? "";
    if ((request.headers.host ?? "") !== originHostHeader) {
      send(response, 400, baseHeaders({ "content-type": "text/plain; charset=utf-8" }), "Bad request");
      return;
    }
    const route = parseLibraryHttpRoute(request.method ?? "", target);
    if (route === null) {
      send(response, 404, baseHeaders({ "content-type": "text/plain; charset=utf-8" }), "Not found");
      return;
    }
    if (!libraryHttpRouteMethod(route).includes(request.method ?? "")) {
      send(
        response,
        405,
        baseHeaders({ "content-type": "text/plain; charset=utf-8", allow: libraryHttpRouteMethod(route).join(", ") }),
        "Method not allowed",
      );
      return;
    }
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const disconnected = new AbortController();
    const onResponseClose = (): void => {
      if (!response.writableEnded) disconnected.abort();
    };
    const onRequestAborted = (): void => disconnected.abort();
    response.on("close", onResponseClose);
    request.on("aborted", onRequestAborted);
    const signal = AbortSignal.any([timeout, disconnected.signal]);
    try {
      if (route.kind === "session") {
        await handleSession(request, response, route, signal);
        return;
      }
      await handleContent(response, request, route, signal);
    } catch {
      if (!response.headersSent) {
        send(response, 500, baseHeaders({ "content-type": "text/plain; charset=utf-8" }), "Internal error");
      }
    } finally {
      response.off("close", onResponseClose);
      request.off("aborted", onRequestAborted);
    }
  };

  const resolveCredential = (credential: string, signal: AbortSignal): void => {
    try {
      service.catalog.identity.resolveCredential(credential, signal);
    } catch (error) {
      if (error instanceof LibraryCatalogError && error.code === "denied") throw new LibraryHttpDeniedError();
      throw error;
    }
  };

  const sessionCredential = (request: IncomingMessage, signal: AbortSignal): string | null => {
    const token = parseSessionCookie(request.headers.cookie ?? null);
    if (token === null) return null;
    const credential = sessions.credentialFor(token);
    if (credential === null) return null;
    try {
      resolveCredential(credential, signal);
    } catch {
      return null;
    }
    return credential;
  };

  const handleSession = async (
    request: IncomingMessage,
    response: ServerResponse,
    _route: LibraryHttpRoute,
    signal: AbortSignal,
  ): Promise<void> => {
    if (request.method === "DELETE") {
      const token = parseSessionCookie(request.headers.cookie ?? null);
      if (token !== null) sessions.destroy(token);
      sendJson(response, 200, { ok: true }, { "set-cookie": clearSessionCookie() });
      return;
    }
    let body: Buffer;
    try {
      body = await readBody(request, SESSION_BODY_LIMIT, signal);
    } catch {
      send(response, 413, baseHeaders({ "content-type": "text/plain; charset=utf-8" }), "Body too large");
      return;
    }
    let credential: string | null = null;
    try {
      const parsed: unknown = JSON.parse(body.toString("utf8"));
      if (typeof parsed === "object" && parsed !== null && "credential" in parsed) {
        const value: unknown = (parsed as Record<string, unknown>).credential;
        credential = typeof value === "string" && value.length > 0 && value.length <= SESSION_BODY_LIMIT ? value : null;
      }
    } catch {
      credential = null;
    }
    if (credential === null) {
      sendJson(response, 400, { error: "invalid-credential" });
      return;
    }
    try {
      resolveCredential(credential, signal);
    } catch (error) {
      if (error instanceof LibraryHttpDeniedError) sendJson(response, 401, { error: "authentication-required" });
      else throw error;
      return;
    }
    const token = sessions.create(credential);
    sendJson(response, 200, { ok: true }, { "set-cookie": buildSetSessionCookie(token, SESSION_MAX_AGE_SECONDS) });
  };

  const handleContent = async (
    response: ServerResponse,
    request: IncomingMessage,
    route: LibraryHttpRoute,
    signal: AbortSignal,
  ): Promise<void> => {
    const credential = sessionCredential(request, signal);
    if (credential === null) {
      sendJson(response, 401, { error: "authentication-required" });
      return;
    }
    switch (route.kind) {
      case "session":
        send(response, 500, baseHeaders({ "content-type": "text/plain; charset=utf-8" }), "Internal error");
        return;
      case "document":
        await handleDocument(response, request, route, credential, signal);
        return;
      case "document-asset":
        await handleAsset(response, request, route, credential, signal);
        return;
      case "canvas":
        await handleCanvas(response, request, route, credential, signal);
        return;
    }
  };

  const handleDocument = async (
    response: ServerResponse,
    request: IncomingMessage,
    route: Extract<LibraryHttpRoute, { kind: "document" }>,
    credential: string,
    signal: AbortSignal,
  ): Promise<void> => {
    let read;
    try {
      read = await service.getDocument({ locator: { storeId: route.storeId, documentId: route.documentId }, credential }, signal);
    } catch (error) {
      sendContractError(response, error);
      return;
    }
    if (route.variant === "raw") {
      const hash = createHash("sha256").update(read.source, "utf8").digest("hex");
      const etag = `"${hash}"`;
      if (request.headers["if-none-match"] === etag) {
        send(response, 304, baseHeaders({ etag }));
        return;
      }
      send(response, 200, baseHeaders({ "content-type": "text/markdown; charset=utf-8", etag }), read.source);
      return;
    }
    const title = deriveDocumentTitle(read.source) ?? route.documentId;
    const canonical = buildLibraryLink(
      { providerOrigin, ref: { kind: "document", storeId: route.storeId, documentId: route.documentId } },
      { nodeOrigin: providerOrigin },
    );
    const html = renderDocumentPageHtml({
      title,
      source: read.source,
      assetNames: extractDocumentAssetNames(read.source),
      canonicalHref: canonical,
      rawHref: `${canonical}/raw`,
      visibility: read.share === null ? "unknown" : read.share.visibility,
    });
    send(response, 200, baseHeaders({ "content-type": "text/html; charset=utf-8", "content-security-policy": DOCUMENT_CSP }), html);
  };

  const handleAsset = async (
    response: ServerResponse,
    request: IncomingMessage,
    route: Extract<LibraryHttpRoute, { kind: "document-asset" }>,
    credential: string,
    signal: AbortSignal,
  ): Promise<void> => {
    let assets;
    try {
      assets = await service.getDocumentAssets(
        { locator: { storeId: route.storeId, documentId: route.documentId }, names: [route.name], credential },
        signal,
      );
    } catch (error) {
      sendContractError(response, error);
      return;
    }
    const asset = assets.assets[0];
    if (asset === undefined) {
      send(response, 404, baseHeaders({ "content-type": "text/plain; charset=utf-8" }), "Not found");
      return;
    }
    switch (asset.status) {
      case "ready": {
        const etag = asset.etag ?? `"${createHash("sha256").update(asset.bytes).digest("hex")}"`;
        if (request.headers["if-none-match"] === etag) {
          send(response, 304, baseHeaders({ etag }));
          return;
        }
        send(response, 200, baseHeaders({ "content-type": asset.contentType, etag }), asset.bytes);
        return;
      }
      case "missing":
        send(response, 404, baseHeaders({ "content-type": "text/plain; charset=utf-8" }), "Not found");
        return;
      case "not_image":
        sendJson(response, 415, { error: "asset-not-image" });
        return;
      case "too_large":
        sendJson(response, 413, { error: "asset-too-large" });
        return;
      case "failed":
        sendJson(response, 500, { error: "asset-unavailable" });
        return;
    }
  };

  const handleCanvas = async (
    response: ServerResponse,
    _request: IncomingMessage,
    route: Extract<LibraryHttpRoute, { kind: "canvas" }>,
    credential: string,
    signal: AbortSignal,
  ): Promise<void> => {
    const locator = { kind: "store" as const, storeId: route.storeId, canvasId: route.canvasId };
    let context;
    try {
      context = service.catalog.identity.resolveCredential(credential, signal);
    } catch {
      sendJson(response, 401, { error: "authentication-required" });
      return;
    }
    let object;
    try {
      object = service.catalog.readObject(context, { storeId: route.storeId, kind: "canvas" as const, objectId: route.canvasId });
    } catch (error) {
      sendContractError(response, error);
      return;
    }
    if (object === null) {
      send(response, 404, baseHeaders({ "content-type": "text/plain; charset=utf-8" }), "Not found");
      return;
    }
    let canShareToTeam = false;
    try {
      canShareToTeam = service.catalog.canShareToTeam(context, route.storeId);
    } catch {
      canShareToTeam = false;
    }
    const share = { visibility: object.visibility, canShareToTeam };
    let payload;
    try {
      payload = await service.getCanvasPayload({ locator, credential }, signal);
    } catch (error) {
      sendContractError(response, error);
      return;
    }
    const decoded = await decodeCanvasContent(payload);
    if (decoded.status !== 200) {
      if (route.variant === "payload") sendJson(response, 422, { error: "canvas-unavailable" });
      else send(response, 422, baseHeaders({ "content-type": "text/plain; charset=utf-8" }), "Canvas unavailable");
      return;
    }
    if (route.variant === "payload") {
      sendJson(response, 200, {
        storeId: route.storeId,
        canvasId: route.canvasId,
        share,
        dataJsonText: decoded.content.dataJsonText,
        bundleJsonText: decoded.content.bundleJsonText,
      });
      return;
    }
    const theme: LibraryHttpCanvasTheme = route.theme;
    const html = renderFrame(decoded.content, theme, route.canvasId);
    send(response, 200, baseHeaders({ "content-type": "text/html; charset=utf-8", "content-security-policy": CANVAS_CSP }), html);
  };

  const sendContractError = (response: ServerResponse, error: unknown): void => {
    const status = contractStatus(error);
    if (status === 500) {
      send(response, 500, baseHeaders({ "content-type": "text/plain; charset=utf-8" }), "Internal error");
      return;
    }
    if (status === 400 || status === 404) {
      const text = status === 400 ? "Bad request" : "Not found";
      send(response, status, baseHeaders({ "content-type": "text/plain; charset=utf-8" }), text);
      return;
    }
    sendJson(response, status, { error: status === 403 ? "forbidden" : "unavailable" });
  };

  const server: Server = createServer({ key: options.tls.key, cert: options.tls.cert }, (request, response) => {
    void handle(request, response);
  });
  const sockets = new Set<Socket>();
  server.on("secureConnection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(options.port, options.host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  return {
    origin: providerOrigin,
    host: options.host,
    port: options.port,
    close: async () => {
      sessions.clear();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}
