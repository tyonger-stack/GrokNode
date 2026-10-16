import { z } from "zod";
import { decodeCanvasContent, parseCanvasFrameUrl, SAND_CANVAS_SCHEME, type CanvasDecodedContent, type CanvasFrameRequest, type CanvasTheme } from "../host/extensions/library/canvas-protocol.js";
import type { CanvasPayload } from "../shared/library-contracts.js";
import { decodeLibraryJson } from "../shared/library/json-bytes.js";
import { renderLibraryCanvasFrameHtml } from "../shared/library/canvas-frame.js";
import type { ProductionDisposable, ProductionServiceContext } from "./main-production-services.js";

// Original 0.68.1 main-app HJt/AHe/X3 and main-core sandSemanticValues.
const colors = {
  light: { background: "#fcfcfc", foreground: "#141414", primary: "#1084fe", status: "#14141499", scrollbar: "#1414144d" },
  dark: { background: "#070707", foreground: "#fcfcfc", primary: "#1084fe", status: "#fcfcfc99", scrollbar: "#fcfcfc4d" },
} as const;
export const LIBRARY_CANVAS_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; script-src 'unsafe-inline' blob:; sandbox allow-scripts; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
  "permissions-policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), clipboard-read=(), clipboard-write=()",
  "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "cache-control": "no-store",
} as const;

function canvasFrameCss(theme: CanvasTheme): string {
  const c = colors[theme];
  return `
*{margin:0;padding:0;box-sizing:border-box;scrollbar-width:thin;scrollbar-color:${c.scrollbar} transparent}
html{height:100%;padding-top:var(--cursor-canvas-top-inset,0px);scroll-padding-top:var(--cursor-canvas-top-inset,0px)}
html,body{width:100%;min-height:100%;background:${c.background}}
body{padding:24px var(--cursor-canvas-gutter,32px);color:${c.foreground};font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:13px;line-height:18px;overflow-x:hidden}
#root{position:relative;width:100%;max-width:calc(var(--cursor-canvas-content-column,100vw) - 2*var(--cursor-canvas-gutter,32px));margin-inline:auto;min-height:calc(100vh - 48px - var(--cursor-canvas-top-inset,0px) - var(--cursor-canvas-bottom-inset,0px));overflow-x:auto;--cursor-canvas-viewport-height:calc(100vh - 48px - var(--cursor-canvas-top-inset,0px) - var(--cursor-canvas-bottom-inset,0px))}
#root>:only-child:is([style^="height:100%;"],[style^="height: 100%;"],[style*=";height:100%;"],[style*="; height: 100%;"]){min-height:var(--cursor-canvas-viewport-height)!important}
body::after{content:"";display:block;height:var(--cursor-canvas-bottom-inset,0px)}
::-webkit-scrollbar{width:8px;height:8px;background:transparent}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-thumb{background:${c.scrollbar};border-radius:4px}::-webkit-scrollbar-thumb:hover{background:${c.foreground}}
#status{display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 48px - var(--cursor-canvas-top-inset,0px) - var(--cursor-canvas-bottom-inset,0px));color:${c.status};font:13px system-ui}
@media(max-width:479.98px){body{padding:16px var(--cursor-canvas-gutter,16px)}#root{min-height:calc(100vh - 32px);--cursor-canvas-viewport-height:calc(100vh - 32px);max-width:calc(var(--cursor-canvas-content-column,100vw) - 2*var(--cursor-canvas-gutter,16px))}#status{min-height:calc(100vh - 32px)}}
:root{--cursor-canvas-focus-ring-width:1px;--cursor-canvas-focus-ring-offset:2px;--cursor-canvas-focus-ring-radius:4px}*:focus,*:focus-visible{outline:none}*:focus-visible{outline:var(--cursor-canvas-focus-ring-width) solid var(--cursor-canvas-focus-ring-color,currentColor);outline-offset:var(--cursor-canvas-focus-ring-offset)}:where(a[href],[role="link"]):focus-visible{border-radius:var(--cursor-canvas-focus-ring-radius)}
`;
}

export function renderLibraryCanvasFrame(content: CanvasDecodedContent, theme: CanvasTheme): string {
  return renderLibraryCanvasFrameHtml(content, theme, "Canvas");
}

export function renderLibraryCanvasUnavailable(theme: CanvasTheme): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Canvas unavailable</title><style>${canvasFrameCss(theme)}</style></head><body><div id="root"><div id="status">Canvas unavailable</div></div></body></html>`;
}

export type LibraryCanvasReader = (request: CanvasFrameRequest, signal: AbortSignal) => Promise<CanvasPayload>;
const payloadSchema = z.object({ renderBundleGzip: z.instanceof(Uint8Array), dataJson: z.instanceof(Uint8Array) });

export function createLibraryCanvasBridge(legs: Readonly<Record<string, ((args?: unknown) => Promise<unknown>) | undefined>>): LibraryCanvasReader {
  return async (request, signal) => {
    signal.throwIfAborted();
    const credential = await legs.libraryMainCredential?.();
    if (typeof credential !== "string" || credential.length === 0 || legs.getCanvasPayload === undefined) throw new Error("Library canvas bridge unavailable.");
    const payload = await legs.getCanvasPayload({ locator: request.locator, ...(request.groupChatId === undefined ? {} : { groupChatId: request.groupChatId }), credential });
    signal.throwIfAborted();
    if (await legs.libraryMainCredential?.() !== credential) throw new Error("Library canvas account changed.");
    return payloadSchema.parse(decodeLibraryJson(payload));
  };
}

export function createLibraryCanvasHandler(read: LibraryCanvasReader): (request: Request) => Promise<Response> {
  return async request => {
    const parsed = parseCanvasFrameUrl(request.url);
    if (parsed === null || request.method !== "GET") return new Response(null, { status: 400 });
    if (request.signal.aborted) return new Response(null, { status: 499 });
    let canceled: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        canceled = () => reject(new DOMException("Canvas request canceled", "AbortError"));
        request.signal.addEventListener("abort", canceled, { once: true });
      });
      const payload = await Promise.race([read(parsed, request.signal), aborted]);
      const decoded = await decodeCanvasContent(payload);
      if (request.signal.aborted) return new Response(null, { status: 499 });
      if (decoded.status !== 200) return new Response(renderLibraryCanvasUnavailable(parsed.theme), { status: decoded.status, headers: LIBRARY_CANVAS_HEADERS });
      return new Response(renderLibraryCanvasFrame(decoded.content, parsed.theme), { status: 200, headers: LIBRARY_CANVAS_HEADERS });
    } catch (error) {
      // Protocol boundary: fail closed without exposing backend or identity details.
      const canceledBeforeRead = request.signal.aborted || (error instanceof Error && error.name === "AbortError");
      if (canceledBeforeRead) return new Response(null, { status: 499 });
      return new Response(renderLibraryCanvasUnavailable(parsed.theme), { status: 404, headers: LIBRARY_CANVAS_HEADERS });
    } finally {
      if (canceled !== undefined) request.signal.removeEventListener("abort", canceled);
    }
  };
}

export function registerLibraryCanvasScheme(protocol: { registerSchemesAsPrivileged(schemes: { scheme: string; privileges: { standard: boolean; secure: boolean; supportFetchAPI: boolean; corsEnabled: boolean } }[]): void }): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SAND_CANVAS_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
}
export function registerLibraryCanvasProtocol(protocol: { handle(scheme: string, handler: (request: Request) => Promise<Response>): void; unhandle(scheme: string): void }, read: LibraryCanvasReader): { dispose(): void } {
  const lifetime = new AbortController();
  const handler = createLibraryCanvasHandler((request, signal) => read(request, AbortSignal.any([signal, lifetime.signal])));
  protocol.handle(SAND_CANVAS_SCHEME, handler);
  return { dispose() { lifetime.abort(); protocol.unhandle(SAND_CANVAS_SCHEME); } };
}


export interface LibraryCanvasProtocolProviderPorts {
  readonly protocol: {
    registerSchemesAsPrivileged(schemes: unknown[]): void;
    handle(scheme: string, handler: (request: Request) => Promise<Response>): void;
    unhandle(scheme: string): void;
  };
}

export interface LibraryCanvasProtocolBinding {
  registerScheme(): void;
  register(context: ProductionServiceContext): ProductionDisposable;
}

export function createProductionLibraryCanvasBinding(ports: LibraryCanvasProtocolProviderPorts): LibraryCanvasProtocolBinding {
  if (typeof ports?.protocol?.registerSchemesAsPrivileged !== "function") {
    throw new Error("Electron production library canvas binding requires electron.protocol.registerSchemesAsPrivileged().");
  }
  if (typeof ports?.protocol?.handle !== "function") {
    throw new Error("Electron production library canvas binding requires electron.protocol.handle().");
  }
  if (typeof ports?.protocol?.unhandle !== "function") {
    throw new Error("Electron production library canvas binding requires electron.protocol.unhandle().");
  }
  let schemeRegistered = false;
  let protocolRegistered = false;
  return {
    registerScheme(): void {
      if (schemeRegistered) {
        throw new Error("Electron production library canvas scheme is already registered.");
      }
      registerLibraryCanvasScheme(ports.protocol);
      schemeRegistered = true;
    },
    register(context: ProductionServiceContext): ProductionDisposable {
      if (protocolRegistered) {
        throw new Error("Electron production library canvas protocol is already registered.");
      }
      const registration = registerLibraryCanvasProtocol(ports.protocol, createLibraryCanvasBridge(context.coordinatorLegs.legs));
      protocolRegistered = true;
      return registration;
    },
  };
}

/** Manifest-call export. Electron remains a real bare runtime dependency. */
export function createElectronProductionLibraryCanvasBinding(): LibraryCanvasProtocolBinding {
  const electron = require("electron") as {
    readonly protocol: LibraryCanvasProtocolProviderPorts["protocol"];
  };
  return createProductionLibraryCanvasBinding({ protocol: electron.protocol });
}
