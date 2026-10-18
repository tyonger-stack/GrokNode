// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js — w1t 分派 case "markdown"/"text"。
// Markdown body is a direct port of upstream `Iwn`/`Bwn` (see file-markdown.tsx)
// plus 0.71.2 FileMarkdown link accent (`sand-10kc733`). Shell chrome stays the
// upstream `see`/`lkn` sand-file-viewer (title + download + close).

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AttachmentBytesResult } from "../../../contracts/desktop-bridge";
import { FILE_VIEWER_CLASSES } from "./pdf-viewer";
import { FileMarkdown, FILE_MARKDOWN_LINK_ACCENT_CSS } from "./file-markdown";
import { SandIconButton } from "../../../ui/sand-kit-primitives";

export const TEXT_PREVIEW_BYTE_CAP = 4 * 1024 * 1024;
const TRUNCATE_AT_BYTES = 1_000_000;

// Matches the gallery resolver signature: (path, maxBytes) => bytes | null
export type TextBytesResolver = (source: string, maxBytes: number) => Promise<AttachmentBytesResult | null>;

export interface TextAttachmentViewerProps {
  source: string;
  name: string;
  isOpen: boolean;
  onClose: () => void;
  readBytes: TextBytesResolver;
  onDownload: () => Promise<boolean>;
  restoreFocus?: () => void;
  /** "markdown" renders inline emphasis/code; "text" stays monospaced. */
  mode?: "text" | "markdown";
}

type TextState =
  | { status: "loading" }
  | { status: "ready"; text: string; truncated: boolean }
  | { status: "too-large" }
  | { status: "error"; message: string };

function decodeText(bytes: Uint8Array): string {
  const body = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? bytes.subarray(3)
    : bytes;
  return new TextDecoder("utf-8").decode(body);
}

export function useTextBytes(source: string, readBytes: TextBytesResolver, cap = TEXT_PREVIEW_BYTE_CAP): TextState {
  const [state, setState] = useState<TextState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void readBytes(source, cap)
      .then((result) => {
        if (!active) return;
        if (result == null) return setState({ status: "error", message: "File unavailable" });
        if (result.kind === "too-large") return setState({ status: "too-large" });
        const bytes = result.bytes;
        if (bytes.byteLength > cap) return setState({ status: "too-large" });
        const slice = bytes.byteLength > TRUNCATE_AT_BYTES ? bytes.subarray(0, TRUNCATE_AT_BYTES) : bytes;
        // Trim trailing continuation bytes so we never split a UTF-8 sequence.
        let end = slice.length;
        while (end > 0 && (slice[end - 1] & 0xc0) === 0x80) end -= 1;
        setState({
          status: "ready",
          text: decodeText(slice.subarray(0, end)),
          truncated: bytes.byteLength > slice.length
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => { active = false; };
  }, [source, readBytes, cap]);
  return state;
}

function PlainBody({ text }: { text: string }) {
  return <pre className="sand-file-viewer__body sand-text-viewer__body sand-text-viewer__body--plain"><code>{text}</code></pre>;
}

function ensureFileMarkdownAccentStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("sand-file-markdown-accent")) return;
  const style = document.createElement("style");
  style.id = "sand-file-markdown-accent";
  style.textContent = FILE_MARKDOWN_LINK_ACCENT_CSS;
  document.head.append(style);
}

function OpenTextAttachmentViewer({ source, name, onClose, readBytes, onDownload, restoreFocus, mode = "text" }: Omit<TextAttachmentViewerProps, "isOpen">) {
  const state = useTextBytes(source, readBytes);
  const [wrap, setWrap] = useState(true);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef(restoreFocus);
  onCloseRef.current = onClose;
  restoreFocusRef.current = restoreFocus;

  useEffect(() => {
    ensureFileMarkdownAccentStyle();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.();
    };
  }, []);

  const titleId = useId();
  const attachWrapRef = useCallback((element: HTMLDivElement | null) => {
    if (element && mode !== "markdown") element.style.whiteSpace = wrap ? "pre-wrap" : "pre";
  }, [wrap, mode]);

  const body = (() => {
    switch (state.status) {
      case "loading":
        return <div aria-live="polite" className="sand-file-viewer__body" role="status">Loading…</div>;
      case "too-large":
        return (
          <div className="sand-file-viewer__body" role="alert">
            <strong>File too large to preview</strong>
            <span>This file is over {Math.round(TEXT_PREVIEW_BYTE_CAP / 1024 / 1024)} MB. Download it to open in another app.</span>
            <button onClick={() => { void onDownload(); }} type="button">Download</button>
          </div>
        );
      case "error":
        return <div className="sand-file-viewer__body" role="alert"><strong>Couldn&apos;t read this file</strong><span>{state.message}</span></div>;
      default:
        return mode === "markdown" ? <FileMarkdown text={state.text} /> : <PlainBody text={state.text} />;
    }
  })();

  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className={FILE_VIEWER_CLASSES.root}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="dialog"
    >
      <section className={FILE_VIEWER_CLASSES.panel}>
        <header className={FILE_VIEWER_CLASSES.header}>
          <div className={FILE_VIEWER_CLASSES.title}>
            <h2 id={titleId}>{name}</h2>
          </div>
          {mode === "markdown" ? null : (
            <div className={FILE_VIEWER_CLASSES.toolbar}>
              <button aria-label="Toggle line wrap" onClick={() => setWrap((value) => !value)} title="Toggle line wrap" type="button">↵</button>
            </div>
          )}
          <div className={FILE_VIEWER_CLASSES.actions}>
            <SandIconButton aria-label="下载" icon="desktop-download" onClick={() => { void onDownload(); }} shape="square" size="sm" variant="ghost" />
            <SandIconButton aria-label="关闭" icon="close" onClick={onClose} shape="square" size="sm" variant="ghost" />
          </div>
        </header>
        <div ref={attachWrapRef} style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {body}
        </div>
      </section>
    </div>,
    document.body
  );
}

export function TextAttachmentViewer(props: TextAttachmentViewerProps) {
  if (!props.isOpen || typeof document === "undefined") return null;
  return <OpenTextAttachmentViewer {...props} />;
}
