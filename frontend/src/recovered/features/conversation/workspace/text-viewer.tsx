// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js — w1t 分派 case "markdown"/"text"。
// 2026-10-11 勘误：打包基线本就有上游文本/markdown 查看器（该分派在官方 0.18.0 运行时
// 副本中同样存在）；早前「new capability, not present in Grok Bot 0.18.0」的断言是错的。
// 本文件仍是该契约在 recovered frontend 的本地重实现：this reconstruction has no
// server-backed document service, so text is read through the same attachment-bytes
// bridge as PDF.
//
// Upstream counterpart, read out of the installed official 0.68.1 app:
//   app.asar → dist/renderer/assets/chunk-text-viewer-C4bq1ueT.js
//   sha256 d567c7aa2a277988…  (exported Ee/ce/he/Ot/ke/jt/Ue/Je)
//
// Two shapes upstream uses that this file does NOT copy, recorded so the
// divergence is a decision rather than an omission:
//
//  1. Upstream's component takes already-resolved content — its props read
//     `text`, `bytes`, `name`, `isOpen`, `downloadName`, `onClose`, and it calls
//     no bridge method of its own. Reading happens in the caller. This file
//     instead takes a `readBytes` resolver and loads inside, which is what the
//     PDF viewer next door already does here. Adopting upstream's shape would
//     mean threading the load up through TranscriptAttachmentGallery.
//
//  2. Upstream's markdown container is
//     cx("sand-file-markdown-page",
//        "sand-9f619 sand-c5f494 sand-vc5jky sand-11t971q sand-13zrc24
//          sand-161sli9 sand-1mfogq2 sand-sfy40s sand-1hx0egp")
//     Cross-checked against 0.18's index-lCyB53CO.css: `sand-file-markdown-page`
//     has 0 rules and 3 of those 9 stylix classes are missing too. Porting the
//     survivors would assemble a combination that exists in neither version, so
//     this keeps its own container and leaves the gap recorded instead.
//
// Sand style tokens reused: sand-file-viewer__panel/__header/__toolbar/__actions/__body

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { AttachmentBytesResult } from "../../../contracts/desktop-bridge";

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

/** Minimal inline markdown: `code`, **bold**, *italic*. Never injects raw HTML. */
function renderInline(source: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) nodes.push(source.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`")) nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    cursor = match.index + token.length;
  }
  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

function MarkdownBody({ text }: { text: string }) {
  const blocks = useMemo(() => text.split(/\n{2,}/), [text]);
  return (
    <div className="sand-file-viewer__body sand-text-viewer__body">
      {blocks.map((block, index) => {
        const trimmed = block.trim();
        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
        if (heading) {
          const Tag = ("h" + Math.min(heading[1].length + 1, 6)) as "h2" | "h3" | "h4" | "h5" | "h6";
          return <Tag key={index}>{renderInline(heading[2])}</Tag>;
        }
        const lines = trimmed.split("\n");
        if (lines.length > 0 && lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
          return (
            <ul key={index}>
              {lines.map((line, i) => <li key={i}>{renderInline(line.replace(/^\s*[-*+]\s+/, ""))}</li>)}
            </ul>
          );
        }
        if (lines.length > 0 && lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
          return (
            <ol key={index}>
              {lines.map((line, i) => <li key={i}>{renderInline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>)}
            </ol>
          );
        }
        return <p key={index}>{renderInline(block)}</p>;
      })}
    </div>
  );
}

function PlainBody({ text }: { text: string }) {
  return <pre className="sand-file-viewer__body sand-text-viewer__body sand-text-viewer__body--plain"><code>{text}</code></pre>;
}

function OpenTextAttachmentViewer({ source, name, onClose, readBytes, onDownload, restoreFocus, mode = "text" }: Omit<TextAttachmentViewerProps, "isOpen">) {
  const state = useTextBytes(source, readBytes);
  const [wrap, setWrap] = useState(true);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef(restoreFocus);
  onCloseRef.current = onClose;
  restoreFocusRef.current = restoreFocus;

  useEffect(() => {
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
    if (element) element.style.whiteSpace = wrap ? "pre-wrap" : "pre";
  }, [wrap]);

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
        return mode === "markdown" ? <MarkdownBody text={state.text} /> : <PlainBody text={state.text} />;
    }
  })();

  const charCount = state.status === "ready" ? state.text.length : 0;

  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="sand-file-viewer"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="dialog"
    >
      <section className="sand-file-viewer__panel">
        <header className="sand-file-viewer__header">
          <div>
            <h2 id={titleId}>{name}</h2>
            {charCount > 0 ? (
              <span>
                {charCount.toLocaleString()} characters
                {state.status === "ready" && state.truncated ? " (truncated)" : ""}
              </span>
            ) : null}
          </div>
          <div className="sand-file-viewer__toolbar">
            <button aria-label="Toggle line wrap" onClick={() => setWrap((value) => !value)} type="button">↵</button>
          </div>
          <div className="sand-file-viewer__actions">
            <button aria-label="Download file" onClick={() => { void onDownload(); }} type="button">⇩</button>
            <button aria-label="Close preview" onClick={onClose} type="button">×</button>
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
