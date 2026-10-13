// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js — case"docx" → 字节上限读取 →
// mammoth convertToHtml({arrayBuffer}) → 白名单消毒 → 渲染。2026-10-11 勘误：打包基线
// 本来就带这条上游链（官方 0.18.0 运行时副本 .cache/runtime/Grok Bot.app 同样含
// case"docx" 与 mammoth 调用），早前「0.18 has no docx viewer; new capability」的断言
// 是错的。本文件是 recovered frontend 的源码级镜像，供文档/测试/行为对齐使用，
// 不是要经 renderer 补丁上船的新能力。
//
// React shell only. The mammoth + sanitize pipeline and the upstream anchors it
// is transcribed from live in ./docx-convert.ts.

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import type { AttachmentBytesResult } from "../../../contracts/desktop-bridge";
import { convertDocxToHtml } from "./docx-convert";

export const DOCX_BYTE_CAP = 8 * 1024 * 1024;

export type DocxBytesResolver = (source: string, maxBytes: number) => Promise<AttachmentBytesResult | null>;

export interface DocxAttachmentViewerProps {
  source: string;
  name: string;
  isOpen: boolean;
  onClose: () => void;
  readBytes: DocxBytesResolver;
  onDownload: () => Promise<boolean>;
  restoreFocus?: () => void;
}

type DocxState =
  | { status: "loading" }
  | { status: "ready"; html: string; messages: readonly string[] }
  | { status: "too-large" }
  | { status: "error"; message: string };

function OpenDocxAttachmentViewer({ source, name, onClose, readBytes, onDownload, restoreFocus }: Omit<DocxAttachmentViewerProps, "isOpen">) {
  const [state, setState] = useState<DocxState>({ status: "loading" });
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef(restoreFocus);
  onCloseRef.current = onClose;
  restoreFocusRef.current = restoreFocus;

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void readBytes(source, DOCX_BYTE_CAP)
      .then(async (result) => {
        if (!active) return;
        if (result == null) return setState({ status: "error", message: "File unavailable" });
        if (result.kind === "too-large") return setState({ status: "too-large" });
        const converted = await convertDocxToHtml(result.bytes);
        if (active) setState({ status: "ready", html: converted.html, messages: converted.messages });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => { active = false; };
  }, [source, readBytes]);

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
  const body = (() => {
    switch (state.status) {
      case "loading":
        return <div aria-live="polite" className="sand-file-viewer__body" role="status">Loading document…</div>;
      case "too-large":
        return (
          <div className="sand-file-viewer__body" role="alert">
            <strong>Document too large to preview</strong>
            <span>This document is over {Math.round(DOCX_BYTE_CAP / 1024 / 1024)} MB. Download it to open in another app.</span>
            <button onClick={() => { void onDownload(); }} type="button">Download</button>
          </div>
        );
      case "error":
        return <div className="sand-file-viewer__body" role="alert"><strong>Couldn&apos;t read this document</strong><span>{state.message}</span><button onClick={() => { void onDownload(); }} type="button">Download</button></div>;
      default:
        return (
          <>
            {/* mammoth already escaped the text and sanitizeDocumentHtml reduced
                the result to the upstream tag/attribute table, so this is the
                first innerHTML in the viewer and the only place it is allowed. */}
            <div className="sand-file-viewer__body sand-docx-viewer__body" dangerouslySetInnerHTML={{ __html: state.html }} />
            {state.messages.length > 0 ? (
              <p className="sand-file-viewer__body sand-docx-viewer__notes">
                {state.messages.length} formatting {state.messages.length === 1 ? "hint" : "hints"} from Word were not applied.
              </p>
            ) : null}
          </>
        );
    }
  })();

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
          </div>
          <div className="sand-file-viewer__actions">
            <button aria-label="Download file" onClick={() => { void onDownload(); }} type="button">⇩</button>
            <button aria-label="Close preview" onClick={onClose} type="button">×</button>
          </div>
        </header>
        {body}
      </section>
    </div>,
    document.body
  );
}

export function DocxAttachmentViewer(props: DocxAttachmentViewerProps) {
  if (!props.isOpen || typeof document === "undefined") return null;
  return <OpenDocxAttachmentViewer {...props} />;
}