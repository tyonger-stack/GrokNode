import { useMemo } from "react";
import { LibraryHost, type LibraryHostDesktop, type LibraryTranscript } from "../recovered/features/library/library-host";

/**
 * Production mount adapter. The overview chunk renders `RLibraryHost`
 * with its own React (`S`) and jsx runtime (`p`). This module does not
 * create a root and does not watch the document.
 */
// Qe is the existing coordinator context hook in the checksum-pinned overview chunk.
declare function Qe(): { readonly transcript: LibraryTranscript };
type Desktop = {
  theme?: LibraryHostDesktop["theme"];
  library?: Record<string, (args: unknown) => Promise<unknown>>;
  experiments?: { checkGate?: (name: string) => Promise<boolean> };
  resolveAttachmentMedia?: (source: string) => Promise<Awaited<ReturnType<LibraryHostDesktop["resolveAttachmentMedia"]>> | { kind: "image"; src: string; width?: number | null; height?: number | null }>;
  readAttachmentBytes?: (path: string, maxBytes: number) => Promise<{ kind: "bytes"; bytes: Uint8Array } | { kind: "too-large"; size: number } | null>;
  downloadAttachment?: (path: string, suggestedName?: string) => Promise<boolean>;
  openExternal?: (url: string) => Promise<void>;
  getLinkMetadata?: (url: string) => Promise<{ title?: string } | null>;
};

function desktopOf(): Desktop {
  return (window as unknown as { desktop?: Desktop }).desktop ?? {};
}

export function libraryDesktopFromWindow(): LibraryHostDesktop {
  const desktop = desktopOf();
  const library = desktop.library ?? {};
  const call = (method: string) => async (args: unknown) => {
    const fn = library[method];
    if (typeof fn !== "function") throw new Error(`Library bridge method is unavailable: ${method}`);
    return fn(args);
  };
  return {
    theme: desktop.theme,
    getLibraryTranscript: (args) => call("getLibraryTranscript")(args) as Promise<{ entries: [] }>,
    resolveLibraryPages: (args) => call("resolveLibraryPages")(args) as Promise<[]>,
    listLibraryDocs: (args) => call("listLibraryDocs")(args) as Promise<{ docs: [] }>,
    checkGate: async (name) => (await desktop.experiments?.checkGate?.(name).catch(() => false)) === true,
    getLibraryOrigin: () => call("getLibraryOrigin")({}) as Promise<string>,
    resolveAttachmentMedia: async (source) => {
      const media = await desktop.resolveAttachmentMedia?.(source);
      if (media?.kind === "image" && "src" in media) return { kind: "image", dataUrl: media.src, width: media.width ?? null, height: media.height ?? null };
      return media ?? null;
    },
    readAttachmentBytes: (path, maxBytes) => desktop.readAttachmentBytes?.(path, maxBytes) ?? Promise.resolve(null),
    downloadAttachment: (path, suggestedName) => desktop.downloadAttachment?.(path, suggestedName) ?? Promise.resolve(false),
    openExternal: (url) => desktop.openExternal?.(url) ?? Promise.resolve(),
    getLinkMetadata: (url) => desktop.getLinkMetadata?.(url) ?? Promise.resolve(null),
    getDocument: (args) => call("getDocument")(args) as never,
    getDocumentEditRight: (args) => call("getDocumentEditRight")(args) as never,
    saveDocument: (args) => call("saveDocument")(args) as never,
    getDocumentAssets: (args) => call("getDocumentAssets")(args) as never,
    setDocumentVisibility: (args) => call("setDocumentVisibility")(args) as never,
    getCanvasShare: (args) => call("getCanvasShare")(args) as never,
    setCanvasVisibility: (args) => call("setCanvasVisibility")(args) as never,
  };
}

export function RLibraryHost(props: { agentId: string }) {
  const { transcript } = Qe();
  const desktop = useMemo(() => ({ ...libraryDesktopFromWindow(), transcript }), [transcript]);
  return <LibraryHost key={props.agentId} agentId={props.agentId} desktop={desktop} />;
}
