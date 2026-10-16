import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DocxAttachmentViewer, type DocxAttachmentViewerProps } from "../conversation/workspace/docx-viewer";
import { FILE_VIEWER_CLASSES, PdfAttachmentViewer, type PdfAttachmentViewerProps } from "../conversation/workspace/pdf-viewer";
import { SpreadsheetViewer, type SpreadsheetViewerProps } from "../conversation/workspace/spreadsheet-viewer";
import type { MediaResolver } from "../conversation/workspace/media-viewer";
import { TextAttachmentViewer, useTextBytes, type TextAttachmentViewerProps } from "../conversation/workspace/text-viewer";
import { SandIconButton } from "../../ui/sand-kit-primitives";
import "./file-stage.css";

/**
 * Task 10: port of the original fullscreen file dispatch (F Pl/zn).
 * Image/video route to the visual branch, every other kind to its
 * matching viewer; closed stays unmounted, failures keep a retryable
 * state, and the original file always stays downloadable. HTML render
 * uses a sandboxed frame (Node has no sand-html-preview protocol);
 * JSON falls back to source text when unparseable.
 */
export type LibraryFileKind =
  | "image" | "video" | "audio" | "pdf" | "markdown" | "text"
  | "html" | "json" | "table" | "docx" | "unknown";
export interface LibraryFileViewerProps {
  readonly kind: LibraryFileKind;
  readonly source: string;
  readonly name: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly readTextBytes: TextAttachmentViewerProps["readBytes"];
  readonly readPdfBytes: PdfAttachmentViewerProps["readBytes"];
  readonly readDocxBytes: DocxAttachmentViewerProps["readBytes"];
  readonly readTableBytes: SpreadsheetViewerProps["readAttachmentBytes"];
  readonly onDownload: () => Promise<boolean>;
  readonly resolveMedia?: MediaResolver;
}
export function classifyLibraryFileKind(name: string): LibraryFileKind {
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".webm", ".ogv", ".m4v"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".ogg", ".oga", ".m4a", ".flac", ".opus", ".weba"].includes(ext)) return "audio";
  if (ext === ".pdf") return "pdf";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if ([".txt", ".log"].includes(ext)) return "text";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".json") return "json";
  if ([".csv", ".tsv", ".xls", ".xlsx", ".numbers"].includes(ext)) return "table";
  if (ext === ".docx") return "docx";
  return "unknown";
}
function FileDialog({ name, onClose, onDownload, children }: {
  readonly name: string; readonly onClose: () => void;
  readonly onDownload: () => Promise<boolean>; readonly children: React.ReactNode;
}) {
  const titleId = useId();
  return <div aria-labelledby={titleId} aria-modal="true" className={FILE_VIEWER_CLASSES.root} role="dialog">
    <section className={FILE_VIEWER_CLASSES.panel}>
      <header className={FILE_VIEWER_CLASSES.header}>
        <div className={FILE_VIEWER_CLASSES.title}><h2 id={titleId}>{name}</h2></div>
        <div className={FILE_VIEWER_CLASSES.actions}>
          <SandIconButton aria-label="下载" icon="desktop-download" onClick={() => { void onDownload(); }} shape="square" size="sm" variant="ghost" />
          <SandIconButton aria-label="关闭" icon="close" onClick={onClose} shape="square" size="sm" variant="ghost" />
        </div>
      </header>
      <div className={FILE_VIEWER_CLASSES.body}>{children}</div>
    </section>
  </div>;
}
function MediaBranch({ kind, source, name, resolveMedia }: { kind: "image" | "video" | "audio"; source: string; name: string; resolveMedia?: MediaResolver }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [playbackSource, setPlaybackSource] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setFailed(false);
    setLoaded(false);
    setPlaybackSource(null);
    if (kind !== "audio" || resolveMedia == null) return;
    void resolveMedia(source).then((media) => {
      if (!active) return;
      if (media?.kind === "audio") setPlaybackSource(media.src);
      else setFailed(true);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [kind, source, resolveMedia]);
  if (failed) return <p role="alert">Couldn&apos;t load this {kind}. Download it to open in another app.</p>;
  return <>
    {!loaded ? <p role="status">Loading {kind}\u2026</p> : null}
    {kind === "image" ? <img alt={name} src={source} style={loaded ? undefined : { display: "none" }}
      onError={() => setFailed(true)} onLoad={() => setLoaded(true)} />
      : kind === "video" ? <video aria-label={name} controls preload="metadata" src={source} style={loaded ? undefined : { display: "none" }}
        onError={() => setFailed(true)} onLoadedData={() => setLoaded(true)} />
        : (resolveMedia == null || playbackSource != null) ? <audio aria-label={name} controls preload="metadata" src={playbackSource ?? source} onError={() => setFailed(true)} onLoadedData={() => setLoaded(true)} /> : null}
  </>;
}
function HtmlBranch({ source, readBytes }: { source: string; readBytes: TextAttachmentViewerProps["readBytes"] }) {
  const [rendered, setRendered] = useState(true);
  const { state, retry } = useRetryableTextBytes(source, readBytes);
  if (state.status === "loading") return <p role="status">Loading page\u2026</p>;
  if (state.status === "error") return <div role="alert">Couldn&apos;t read this page.{retry}</div>;
  if (state.status === "too-large") return <p>Page too large to preview. Download it to open in another app.</p>;
  return <>
    <div role="tablist" aria-label="Page view">
      <button aria-selected={rendered} onClick={() => setRendered(true)} role="tab" type="button">Rendered</button>
      <button aria-selected={!rendered} onClick={() => setRendered(false)} role="tab" type="button">Source</button>
    </div>
    {state.truncated ? <p>Preview truncated. Download the file for the full page.</p> : null}
    {rendered ? <iframe referrerPolicy="no-referrer" sandbox="allow-scripts" srcDoc={state.text} title="Rendered page" /> : <pre>{state.text}</pre>}
  </>;
}
function useRetryableTextBytes(source: string, readBytes: TextAttachmentViewerProps["readBytes"]) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const reader = useMemo(() => {
    let active = true;
    return { activate: () => { active = true; }, dispose: () => { active = false; }, read: async (path: string, cap: number) => {
      setFailed(false);
      try { return await readBytes(path, cap); }
      catch (error) { if (active) setFailed(true); throw error; }
    } };
  }, [source, readBytes, attempt]);
  useEffect(() => { reader.activate(); return () => reader.dispose(); }, [reader]);
  const state = useTextBytes(source, reader.read);
  return { state, retry: failed ? <button aria-label="Retry" onClick={() => setAttempt((value) => value + 1)} type="button">Retry</button> : null };
}
function JsonNode({ value, depth }: { value: unknown; depth: number }) {
  if (value === null) return <span>null</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>[]</span>;
    if (depth <= 0) return <span>[{value.length} items]</span>;
    const shown = value.slice(0, 100);
    return <ul>{shown.map((item, index) => <li key={index}><JsonNode value={item} depth={depth - 1} /></li>)}
      {value.length > shown.length ? <li>\u2026 {value.length - shown.length} more items</li> : null}</ul>;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span>{}</span>;
    if (depth <= 0) return <span>{entries.length} fields</span>;
    return <ul>{entries.slice(0, 100).map(([key, item]) => <li key={key}><strong>{key}</strong>: <JsonNode value={item} depth={depth - 1} /></li>)}
      {entries.length > 100 ? <li>\u2026 more fields</li> : null}</ul>;
  }
  return <span>{String(value)}</span>;
}
function JsonBranch({ source, readBytes }: { source: string; readBytes: TextAttachmentViewerProps["readBytes"] }) {
  const { state, retry } = useRetryableTextBytes(source, readBytes);
  if (state.status === "loading") return <p role="status">Loading data\u2026</p>;
  if (state.status === "error") return <div role="alert">Couldn&apos;t read this file.{retry}</div>;
  if (state.status === "too-large") return <p>File too large to preview. Download it to open in another app.</p>;
  let parsed: unknown = null;
  let valid = true;
  try {
    parsed = JSON.parse(state.text);
  } catch {
    valid = false;
  }
  if (!valid) return <pre>{state.text}</pre>;
  return <JsonNode value={parsed} depth={6} />;
}
export function LibraryFileViewer(props: LibraryFileViewerProps) {
  const { kind, source, name, isOpen, onClose, onDownload } = props;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);
  if (!isOpen || typeof document === "undefined") return null;
  if (kind === "pdf") {
    return <PdfAttachmentViewer source={source} name={name} isOpen onClose={onClose} readBytes={props.readPdfBytes} onDownload={onDownload} />;
  }
  if (kind === "markdown" || kind === "text") {
    return <TextAttachmentViewer source={source} name={name} isOpen onClose={onClose} readBytes={props.readTextBytes} onDownload={onDownload} mode={kind} />;
  }
  if (kind === "table") {
    return <SpreadsheetViewer source={source} name={name} isOpen onClose={onClose} onDownload={onDownload} readAttachmentBytes={props.readTableBytes} />;
  }
  if (kind === "docx") {
    return <DocxAttachmentViewer source={source} name={name} isOpen onClose={onClose} readBytes={props.readDocxBytes} onDownload={onDownload} />;
  }
  return <FileDialog name={name} onClose={onClose} onDownload={onDownload}>
    {kind === "html" ? <HtmlBranch key={source} source={source} readBytes={props.readTextBytes} />
      : kind === "json" ? <JsonBranch key={source} source={source} readBytes={props.readTextBytes} />
        : kind === "unknown" ? <p>Preview isn&apos;t available for this file. Download it to open in another app.</p>
          : <MediaBranch key={source} kind={kind} source={source} name={name} resolveMedia={props.resolveMedia} />}
  </FileDialog>;
}
