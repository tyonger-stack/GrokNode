import { useEffect, useState, type ReactNode } from "react";
import type { LibraryExternalDoc, LibraryPage } from "../../../../../source/shared/library-contracts";
import type { TranscriptMediaRow } from "../../../../../source/host/extensions/library/transcript-media";
import { formatWhen } from "../../../extensions/library-core";
import { getFilePreviewKind } from "../../../../../source/shared/media/file-preview-kind";
import { attachmentExtension } from "../../../../../source/shared/media/attachment-open-policy";
import { SandIcon, type SandIconName } from "../../ui/sand-kit-primitives";
import type { LibraryPageProvider } from "./canvas-provider";
import { LibraryPageMenu } from "./page-menu";
import type { LibraryLinkActions } from "./page-share";

const EDIT_AGE_GAP_MS = 60_000;

export function pageShowsEditAge(page: Pick<LibraryPage, "createdAtMs" | "updatedAtMs">): boolean {
  return page.createdAtMs != null && page.updatedAtMs != null && page.updatedAtMs - page.createdAtMs > EDIT_AGE_GAP_MS;
}

function joinMeta(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part != null && part !== "").join(" · ");
}

function visibilityLabel(visibility: LibraryPage["visibility"]): string | null {
  if (visibility === "private") return "私密";
  if (visibility === "team") return "团队";
  if (visibility === "public") return "公开";
  return null;
}

function pageMeta(page: LibraryPage, nowMs: number): string {
  const kind = page.kind === "canvas" ? "画布" : "文档";
  const age = formatWhen(page.updatedAtMs, nowMs);
  const shown = age === "" ? null : pageShowsEditAge(page) ? `编辑于 ${age}` : age;
  return joinMeta([kind, visibilityLabel(page.visibility), shown]);
}

const GENERIC_MEDIA_NAME = /^[0-9a-f]{32,}(?:\.[a-z0-9]+)?$/i;

function mediaTitle(row: TranscriptMediaRow): string {
  if ("url" in row) {
    try { return new URL(row.url).hostname; } catch { return row.url; }
  }
  const name = row.name.trim();
  if (name !== "" && !GENERIC_MEDIA_NAME.test(name)) return name;
  if (row.kind === "image") return "图片";
  if (row.kind === "video") return "视频";
  return "文件";
}

function externalTitle(doc: LibraryExternalDoc): string {
  if (doc.title != null && doc.title.trim() !== "") return doc.title;
  try { return new URL(doc.url).hostname; } catch { return doc.url; }
}

// Official 0.68.1: eG → ehe/WP and up → sk; details in library-style/source-map.json.
function fileGlyph(name: string): SandIconName {
  let path = name;
  if (URL.canParse(name)) {
    path = new URL(name).pathname;
    try { path = decodeURIComponent(path); } catch (error) { if (!(error instanceof URIError)) throw error; }
  }
  const extension = attachmentExtension(path);
  const kind = getFilePreviewKind(path);
  if (kind === "text" && extension != null && ["jsonc", "json5", "ndjson"].includes(extension)) return "json";
  if (kind === "unknown" && extension != null && ["zip", "tar", "gz", "tgz", "bz2", "tbz2", "xz", "txz", "zst", "7z", "rar"].includes(extension)) return "folder";
  const glyphs = {
    image: "image", video: "video-camera", audio: "music", pdf: "file-pdf", table: "table",
    json: "json", markdown: "markdown", docx: "file-text", text: "file-text", unknown: "file",
  } as const;
  return glyphs[kind];
}

type ResolveThumb = (source: string) => Promise<{ readonly kind: "image" | "video"; readonly url: string }>;

function LibraryThumbnail({ source, kind, resolveThumb }: {
  readonly source: string;
  readonly kind: "image" | "video";
  readonly resolveThumb: ResolveThumb;
}): ReactNode {
  const [thumb, setThumb] = useState<{ readonly kind: "image" | "video"; readonly url: string } | null>(null);
  useEffect(() => {
    let live = true;
    setThumb(null);
    void resolveThumb(source).then((next) => { if (live) setThumb(next); }, () => { if (live) setThumb(null); });
    return () => { live = false; };
  }, [source, resolveThumb]);
  const video = kind === "video" || thumb?.kind === "video";
  return <span aria-hidden="true" className="sand-library-thumb-slot">
    {thumb == null ? null : video
      ? <video className="sand-library-thumb" muted playsInline preload="metadata" src={thumb.url} onError={() => setThumb(null)} />
      : <img alt="" className="sand-library-thumb" decoding="async" draggable={false} loading="lazy" src={thumb.url} onError={() => setThumb(null)} />}
    {video ? <span className="sand-library-play-badge">
      <svg height="12" width="12" viewBox="14.5 0 300 300" xmlns="http://www.w3.org/2000/svg">
        <path d="M52 49Q52 37 59 29Q66 21 76.5 18.5Q87 16 97 22L273 124Q283 129 286.5 139.5Q290 150 286.5 160.5Q283 171 273 176L97 278Q87 284 76.5 281.5Q66 279 59 271Q52 263 52 251Z" strokeLinejoin="round" strokeWidth="25" />
      </svg>
    </span> : null}
  </span>;
}

export function LibraryMediaRow(props: {
  readonly row: TranscriptMediaRow;
  readonly nowMs: number;
  readonly resolveThumb: ResolveThumb;
  readonly onOpen: () => void;
}): ReactNode {
  const title = mediaTitle(props.row);
  const age = formatWhen(props.row.timestampMs, props.nowMs);
  return (
    <button className="sand-library-row" data-library-media={props.row.kind} onClick={props.onOpen} title={title} type="button">
      <span className="sand-library-lead">
        {props.row.kind === "image" || props.row.kind === "video"
          ? <LibraryThumbnail key={`${props.row.kind}:${props.row.source}`} source={props.row.source} kind={props.row.kind} resolveThumb={props.resolveThumb} />
          : <SandIcon name={props.row.kind === "link" ? "globe" : fileGlyph(props.row.name)} size="lg" />}
      </span>
      <span className="sand-library-copy"><span className="sand-library-title-line">
        <span className="sand-library-title"><bdi>{title}</bdi></span>
        {age === "" ? null : <span className="sand-library-age"><bdi>{age}</bdi></span>}
      </span></span>
    </button>
  );
}

export function LibraryPageRow(props: {
  readonly page: LibraryPage;
  readonly nowMs: number;
  readonly origin: string | null;
  readonly provider: LibraryPageProvider;
  readonly links: LibraryLinkActions;
  readonly onOpen: () => void;
  readonly onVisibilityChange: (visibility: LibraryPage["visibility"]) => void;
}): ReactNode {
  return (
    <div className="sand-library-row-item" data-library-page={props.page.kind}>
      <button className="sand-library-row" onClick={props.onOpen} title={props.page.title} type="button">
        <span className="sand-library-lead" data-library-page-glyph={props.page.kind === "canvas" ? "browser" : "file-text"}>
          <SandIcon name={props.page.kind === "canvas" ? "browser" : "file-text"} size="lg" />
        </span>
        <span className="sand-library-copy">
          <span className="sand-library-title"><bdi>{props.page.title}</bdi></span>
          <span className="sand-library-meta">{pageMeta(props.page, props.nowMs)}</span>
        </span>
      </button>
      {props.origin == null ? null : <span className="sand-library-actions"><LibraryPageMenu
        links={props.links} onOpen={props.onOpen} onVisibilityChange={props.onVisibilityChange}
        page={props.page} provider={props.provider} providerOrigin={props.origin} /></span>}
    </div>
  );
}

export function LibraryExternalRow(props: {
  readonly doc: LibraryExternalDoc;
  readonly nowMs: number;
  readonly onOpen: () => void;
}): ReactNode {
  const age = formatWhen(props.doc.lastTouchedAtMs, props.nowMs);
  const shown = age === "" ? null : props.doc.lastAction === "edited" ? `编辑于 ${age}` : age;
  return (
    <button className="sand-library-row" data-library-external={props.doc.provider} onClick={props.onOpen} title={externalTitle(props.doc)} type="button">
      <span className="sand-library-lead" data-library-doc-glyph="file-text"><SandIcon name="file-text" size="lg" /></span>
      <span className="sand-library-copy">
        <span className="sand-library-title"><bdi>{externalTitle(props.doc)}</bdi></span>
        <span className="sand-library-meta">{joinMeta([shown])}</span>
      </span>
    </button>
  );
}
