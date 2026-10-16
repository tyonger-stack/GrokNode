import type { AttachmentMedia } from "../../contracts/desktop-bridge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DocumentAsset, DocumentLocator, LibraryExternalDoc, LibraryPage, LibraryPageRef,
} from "../../../../../source/shared/library-contracts";
import { decodeLibraryJson } from "../../../../../source/shared/library/json-bytes";
import { normalizeLibraryOrigin, extractLibraryRefs, type LibraryLinkConfig } from "../../../../../source/shared/library/links";
import { extractConversationMedia, type TranscriptMediaEntry, type TranscriptMediaRow } from "../../../../../source/host/extensions/library/transcript-media";
import {
  createHistoryLoader, GROUP_REVEAL, groupLibraryRows, mergeLibrarySources, visibleGroupItems,
  type HistoryState, type LibraryGroup, type LibraryRow,
} from "../../../../../source/host/extensions/library/library-merge";
import { BUCKET_LABELS } from "../../../extensions/library-core";
import { CanvasStage } from "./canvas-stage";
import { DocumentStage } from "./document-stage";
import { OverlayDialog } from "../../ui/overlay-primitives";
import { LibraryFileViewer, classifyLibraryFileKind } from "./file-viewer";
import { MediaViewer, type MediaResolver, type MediaViewerAttachment } from "../conversation/workspace/media-viewer";
import { LibraryExternalRow, LibraryMediaRow, LibraryPageRow } from "./library-row";
import "./library-list.css";
import type { LibraryPageProvider } from "./canvas-provider";
import { copyTextToClipboard, type LibraryLinkActions } from "./page-share";

/**
 * Task 14: the React-owned Library host (Node design).
 * Mounted below the routines section, it reads transcript snapshots
 * through the library bridge, projects media and page refs with the
 * original rules, resolves pages and external docs server-side and
 * merges, groups and reveals rows exactly like the v1/v2 containers.
 * Gates come from the live evaluator; unknown gates fall back to the
 * v1 media list so nothing renders that the account did not enable.
 */
export interface LibraryTranscriptSnapshot {
  readonly entries: readonly TranscriptMediaEntry[];
  readonly loadState: string;
  readonly failure: unknown;
  readonly olderFailure: unknown;
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
}
export interface LibraryTranscript {
  snapshotsFor(agentId: string): { get(): LibraryTranscriptSnapshot; subscribe(listener: () => void): () => void };
  observeEntries(agentId: string, observer: { onBaseline(): void; onRemoved(): void }): () => void;
  load(agentId: string): void;
  loadOlder(agentId: string): Promise<void>;
}
export interface LibraryHostDesktop {
  readonly transcript?: LibraryTranscript;
  readonly theme?: { readonly initial: { readonly resolved: "light" | "dark" }; onChanged(listener: (value: { resolved: "light" | "dark" }) => void): () => void };
  getLibraryTranscript(args: { agentId: string; cursor?: number; limit?: number }): Promise<{ entries: TranscriptMediaEntry[] }>;
  resolveLibraryPages(args: { refs: LibraryPageRef[]; includeDocuments: boolean }): Promise<readonly { status: "found" | "absent" | "failed"; ref: LibraryPageRef; page?: LibraryPage }[]>;
  listLibraryDocs(args: { agentId: string }): Promise<{ docs: LibraryExternalDoc[] }>;
  checkGate(name: string): Promise<boolean>;
  getLibraryOrigin(): Promise<string>;
  resolveAttachmentMedia(source: string): Promise<AttachmentMedia | null>;
  readAttachmentBytes(path: string, maxBytes: number): Promise<{ kind: "bytes"; bytes: Uint8Array } | { kind: "too-large"; size: number } | null>;
  downloadAttachment(path: string, suggestedName?: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  getLinkMetadata(url: string): Promise<{ title?: string } | null>;
  getDocument(args: { locator: DocumentLocator }): Promise<{ source: string; share: { visibility: "private" | "team-view"; canShareToTeam: boolean } | null }>;
  getDocumentEditRight(args: { locator: DocumentLocator }): Promise<{ canEdit: boolean }>;
  saveDocument(args: { locator: DocumentLocator; source: string }): Promise<{ title: string }>;
  getDocumentAssets(args: { locator: DocumentLocator; names: readonly string[] }): Promise<{ assets: readonly { name: string; status: string }[] }>;
  setDocumentVisibility(args: { locator: DocumentLocator; visibility: "private" | "team-view" }): Promise<"private" | "team-view">;
  getCanvasShare(args: { locator: { kind: "store"; storeId: string; canvasId: string } | { kind: "active-user-store"; canvasId: string } }): Promise<{ storeId: string; canvasId: string; share: { visibility: "private" | "team-view"; canShareToTeam: boolean } | null }>;
  setCanvasVisibility(args: { locator: { kind: "store"; storeId: string; canvasId: string } | { kind: "active-user-store"; canvasId: string }; visibility: "private" | "team-view" }): Promise<"private" | "team-view">;
}
export interface LibraryHostProps {
  readonly agentId: string;
  readonly desktop: LibraryHostDesktop;
  readonly now?: () => number;
}
const GATES = ["grok_bot_library_v2", "grok_bot_library_pages", "grok_bot_documents_ui", "grok_bot_library_external_docs"] as const;
function entrySeq(entry: TranscriptMediaEntry): number | null {
  const seq = (entry as { seq?: unknown }).seq;
  return typeof seq === "number" && Number.isSafeInteger(seq) ? seq : null;
}
function pageRefsOf(entries: readonly TranscriptMediaEntry[], config: LibraryLinkConfig): LibraryPageRef[] {
  const nodeOrigin = normalizeLibraryOrigin(config.nodeOrigin);
  const seen = new Set<string>();
  const out: LibraryPageRef[] = [];
  for (const entry of entries) {
    if (entry.kind !== "send-message") continue;
    if ((entry as { streaming?: unknown }).streaming === true) continue;
    const message = entry.message;
    if (message == null || typeof message !== "object") continue;
    const found = message.type === "text" && typeof message.content === "string"
      ? extractLibraryRefs({ type: "text", content: message.content }, config)
      : message.type === "attachment" && typeof message.url === "string"
        ? extractLibraryRefs({ type: "attachment", url: message.url }, config)
        : [];
    for (const identity of found) {
      if (identity.providerOrigin !== nodeOrigin) continue;
      const key = JSON.stringify([identity.providerOrigin, identity.ref]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(identity.ref);
    }
  }
  return out;
}
function mediaUrl(item: TranscriptMediaRow): string | null {
  return "url" in item ? item.url : null;
}
function mediaSource(item: TranscriptMediaRow): { source: string; name: string } | null {
  return "source" in item ? { source: item.source, name: item.name } : null;
}
const TRANSCRIPT_SELECTOR = ".sand-virtual-transcript__inner, .sand-transcript";
const LIBRARY_FILE_SELECTOR = 'button[aria-label^="Open "], [role="button"][aria-label^="Open "]';
function replayNativeViewerChip(row: LibraryRow): boolean {
  if (row.kind !== "media" || row.item === undefined || !("source" in row.item)) return false;
  const item = row.item;
  const root = document.querySelector(TRANSCRIPT_SELECTOR);
  if (root === null) return false;
  const chip = item.kind === "image" || item.kind === "video"
    ? Array.from(root.querySelectorAll('button[aria-label="Media preview"]'))
      .find((candidate) => candidate.querySelector(item.kind === "video" ? "video[src]" : "img[src]")
        ?.getAttribute("src") === item.source)
    : Array.from(root.querySelectorAll(LIBRARY_FILE_SELECTOR))
      .find((candidate) => candidate.getAttribute("aria-label") === `Open ${item.name}`);
  if (!(chip instanceof HTMLElement)) return false;
  chip.click();
  return true;
}
function sourceFileName(source: string, fallback: string): string {
  const base = decodeURIComponentSafe(source.split(/[?#]/, 1)[0] ?? "").split("/").pop() ?? "";
  return base !== "" ? base : fallback;
}
function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
export function LibraryHost(props: LibraryHostProps) {
  const { agentId, desktop } = props;
  const now = props.now ?? Date.now;
  const [gates, setGates] = useState<Record<string, boolean> | null>(null);
  const [entries, setEntries] = useState<TranscriptMediaEntry[] | null>(null);
  const [entriesFailed, setEntriesFailed] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [pages, setPages] = useState<{ pages: LibraryPage[]; failed: boolean } | null>(null);
  const [docs, setDocs] = useState<{ docs: LibraryExternalDoc[]; failed: boolean } | null>(null);
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<HistoryState>("loadable");
  const [opened, setOpened] = useState<LibraryRow | null>(null);
  const [gallery, setGallery] = useState<number | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [sourceRetry, setSourceRetry] = useState(0);
  const runId = useRef(0);
  const loaderRef = useRef<ReturnType<typeof createHistoryLoader> | null>(null);
  const [theme, setTheme] = useState(desktop.theme?.initial.resolved ?? "light");
  const focusReturn = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setTheme(desktop.theme?.initial.resolved ?? "light");
    return desktop.theme?.onChanged((value) => setTheme(value.resolved));
  }, [desktop]);
  useEffect(() => {
    const at = (runId.current += 1);
    loaderRef.current = null;
    setOrigin(null);
    setGates(null);
    setEntries(null);
    setEntriesFailed(false);
    setPages(null);
    setDocs(null);
    setRevealed({});
    setHistory("loadable");
    setCursor(null);
    setOpened(null);
    setGallery(null);
    const handle = desktop.transcript?.snapshotsFor(agentId);
    const install = () => {
      if (runId.current !== at || handle === undefined) return;
      const snapshot = handle.get();
      setEntries([...snapshot.entries]);
      setEntriesFailed(snapshot.loadState === "failed");
      if (loaderRef.current === null) setHistory(snapshot.olderFailure != null ? "failed" : snapshot.isLoadingOlder ? "loading" : snapshot.hasOlder ? "loadable" : "exhausted");
      const seqs = snapshot.entries.map(entrySeq).filter((seq): seq is number => seq !== null);
      setCursor(snapshot.hasOlder ? (seqs.length ? Math.min(...seqs) : 0) : null);
    };
    const invalidate = () => {
      if (runId.current !== at) return;
      runId.current += 1;
      loaderRef.current = null;
      setOpened(null);
      setGallery(null);
      setEntries([]);
      setPages(null);
      setReload((value) => value + 1);
    };
    const stopSnapshot = handle?.subscribe(install);
    const stopEntries = desktop.transcript?.observeEntries(agentId, { onBaseline: invalidate, onRemoved: invalidate });
    if (handle) { install(); desktop.transcript?.load(agentId); }
    void (async () => {
      try {
        const [v2, pagesGate, documentsUi, externalDocs] = await Promise.all(GATES.map((gate) => desktop.checkGate(gate).catch(() => false)));
        const snapshot = handle === undefined ? await desktop.getLibraryTranscript({ agentId, limit: 100 }) : null;
        if (runId.current !== at) return;
        setGates({ grok_bot_library_v2: v2, grok_bot_library_pages: pagesGate, grok_bot_documents_ui: documentsUi, grok_bot_library_external_docs: externalDocs });
        if (snapshot !== null) {
          const rows = (decodeLibraryJson(snapshot.entries) as TranscriptMediaEntry[]).slice().reverse();
          setEntries(rows);
          const seqs = rows.map(entrySeq).filter((seq): seq is number => seq !== null);
          setCursor(seqs.length > 0 ? Math.min(...seqs) : null);
        }
        try {
          const nextOrigin = await desktop.getLibraryOrigin();
          if (runId.current === at) setOrigin(nextOrigin);
        } catch {
          if (runId.current === at) setOrigin(null);
        }
      } catch {
        if (runId.current === at) setEntriesFailed(true);
      }
    })();
    return () => { runId.current += 1; stopSnapshot?.(); stopEntries?.(); };
  }, [agentId, desktop, reload]);
  const media = useMemo(() => (entries === null ? null : extractConversationMedia(entries)), [entries]);
  const refs = useMemo(() => (entries === null || origin === null ? null : pageRefsOf(entries, { nodeOrigin: origin })), [entries, origin]);
  useEffect(() => {
    if (refs === null || gates === null) return;
    const at = runId.current;
    let active = true;
    const wanted = gates.grok_bot_library_v2 || gates.grok_bot_library_pages ? refs : [];
    if (wanted.length === 0) { if (runId.current === at) setPages({ pages: [], failed: false }); return; }
    void desktop.resolveLibraryPages({ refs: wanted, includeDocuments: gates.grok_bot_documents_ui }).then(
      (rows) => {
        if (!active || runId.current !== at) return;
        const found: LibraryPage[] = [];
        let failed = false;
        for (const row of decodeLibraryJson(rows) as { status: string; page?: LibraryPage }[]) {
          if (row.status === "found" && row.page !== undefined) found.push(row.page);
          else if (row.status === "failed") failed = true;
        }
        setPages({ pages: found, failed });
      },
      () => { if (active && runId.current === at) setPages({ pages: [], failed: true }); },
    );
    return () => { active = false; };
  }, [refs, gates, sourceRetry, desktop]);
  useEffect(() => {
    if (gates === null) return;
    const at = runId.current;
    let active = true;
    if (!gates.grok_bot_library_v2 || !gates.grok_bot_library_external_docs) { if (runId.current === at) setDocs({ docs: [], failed: false }); return; }
    void desktop.listLibraryDocs({ agentId }).then(
      (result) => { if (active && runId.current === at) setDocs({ docs: (decodeLibraryJson(result.docs) as LibraryExternalDoc[]).slice(), failed: false }); },
      () => { if (active && runId.current === at) setDocs({ docs: [], failed: true }); },
    );
    return () => { active = false; };
  }, [gates, sourceRetry, desktop, agentId]);
  const rows = useMemo(() => {
    if (media === null || gates === null) return null;
    if (!gates.grok_bot_library_v2) {
      return media.map((item): LibraryRow => ({ kind: "media", key: `media:${item.id}`, timestampMs: item.timestampMs, item }));
    }
    return mergeLibrarySources({ pages: pages?.pages ?? [], docs: docs?.docs ?? [], media });
  }, [media, pages, docs, gates]);
  const groups = useMemo<LibraryGroup[]>(() => (rows === null ? [] : groupLibraryRows(rows, now())), [rows]);
  const galleryVisuals = useMemo<readonly MediaViewerAttachment[]>(() => {
    if (rows === null) return [];
    const visuals: MediaViewerAttachment[] = [];
    for (const row of rows) {
      if (row.kind !== "media" || row.item === undefined) continue;
      if ((row.item.kind === "image" || row.item.kind === "video") && "source" in row.item) {
        visuals.push({ path: row.item.source, name: row.item.name });
      }
    }
    return visuals;
  }, [rows]);
  const cursorRef = useRef<number | null>(null);
  cursorRef.current = cursor;
  const makeLoader = useCallback(() => {
    const at = runId.current;
    return createHistoryLoader(async () => {
      if (runId.current !== at) return false;
      if (desktop.transcript) {
        await desktop.transcript.loadOlder(agentId);
        if (runId.current !== at) return false;
        const snapshot = desktop.transcript.snapshotsFor(agentId).get();
        if (snapshot.olderFailure != null) throw snapshot.olderFailure;
        return snapshot.hasOlder;
      }
      const atCursor = cursorRef.current;
      if (atCursor === null) return false;
      const snapshot = await desktop.getLibraryTranscript({ agentId, cursor: atCursor, limit: 100 });
      if (runId.current !== at) return false;
      const older = (decodeLibraryJson(snapshot.entries) as TranscriptMediaEntry[]).slice().reverse();
      const seqs = older.map(entrySeq).filter((seq): seq is number => seq !== null && seq < atCursor);
      if (older.length === 0 || seqs.length === 0) return false;
      setEntries((current) => current === null ? current : [...older.filter((entry) => !current.some((row) => row.id === entry.id)), ...current]);
      cursorRef.current = Math.min(...seqs);
      setCursor(cursorRef.current);
      return true;
    });
  }, [agentId, desktop]);
  const runHistory = useCallback(async (): Promise<HistoryState> => {
    const at = runId.current;
    const loader = loaderRef.current ?? (loaderRef.current = makeLoader());
    if (loader.state === "loading" || loader.state === "exhausted") return loader.state;
    setHistory("loading");
    const state = await (loader.state === "failed" ? loader.retry() : loader.loadOlder());
    if (runId.current === at) setHistory(state);
    return state;
  }, [makeLoader]);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const ready = rows !== null;
  useEffect(() => {
    if (!ready || sentinel.current === null || typeof IntersectionObserver === "undefined") return;
    let visible = false, disposed = false, running = false;
    const observer = new IntersectionObserver(([entry]) => {
      const next = entry?.isIntersecting === true;
      if (next && !visible && !running) loaderRef.current = null;
      visible = next;
      if (!visible || running) return;
      running = true;
      void (async () => {
        try {
          while (visible && !disposed) {
            const state = await runHistory();
            if (state !== "loadable") break;
          }
        } finally { running = false; }
      })();
    });
    observer.observe(sentinel.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [ready, runHistory, reload]);
  const resolveThumb = useCallback(async (source: string): Promise<{ readonly kind: "image" | "video"; readonly url: string }> => {
    const media = await desktop.resolveAttachmentMedia(source);
    if (media?.kind === "image") return { kind: "image", url: media.dataUrl };
    if (media?.kind === "video") return { kind: "video", url: media.src };
    throw new Error("Media thumbnail unavailable");
  }, [desktop]);
  const resolveMedia = useCallback((source: string) => desktop.resolveAttachmentMedia(source), [desktop]);
  const refreshPages = useCallback(() => setSourceRetry((n) => n + 1), []);
  const provider = useMemo<LibraryPageProvider>(() => ({
    getCanvasShare: (args) => desktop.getCanvasShare(args) as never,
    setCanvasVisibility: async (args) => {
      const at = runId.current;
      const value = await desktop.setCanvasVisibility(args);
      if (runId.current === at) refreshPages();
      return value;
    },
    setDocumentVisibility: async (args) => {
      const at = runId.current;
      const value = await desktop.setDocumentVisibility(args);
      if (runId.current === at) refreshPages();
      return value;
    },
  }), [desktop]);
  const links = useMemo<LibraryLinkActions>(() => ({
    config: { nodeOrigin: origin ?? "" },
    copyLink: (href: string) => copyTextToClipboard(href),
    openExternal: (href: string) => { void desktop.openExternal(href); },
  }), [desktop, origin]);
  const renderedRun = runId.current;
  if (entriesFailed) {
    return <section aria-label="资料库" className="sand-agent-library">
      <div className="sand-library-heading"><h2>资料库</h2><p>对话中的文件</p></div><p role="alert">资料加载失败。</p>
      <button onClick={() => { setEntriesFailed(false); setReload((n) => n + 1); }} type="button">重试</button>
    </section>;
  }
  if (rows === null) {
    return <section aria-label="资料库" className="sand-agent-library">
      <div className="sand-library-heading"><h2>资料库</h2><p>对话中的文件</p></div><p role="status">正在加载资料…</p>
    </section>;
  }
  const openRow = (row: LibraryRow): void => {
    if (row.kind === "external-doc" && row.doc !== undefined) { void desktop.openExternal(row.doc.url); return; }
    if (row.kind === "media" && row.item !== undefined && mediaUrl(row.item) !== null) {
      void desktop.openExternal(mediaUrl(row.item) as string);
      return;
    }
    focusReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (replayNativeViewerChip(row)) return;
    if (row.kind === "media" && row.item !== undefined && (row.item.kind === "image" || row.item.kind === "video")) {
      const source = row.item.source;
      const index = galleryVisuals.findIndex((entry) => entry.path === source);
      setGallery(index >= 0 ? index : 0);
      return;
    }
    setOpened(row);
  };
  return <section aria-label="资料库" className="sand-agent-library">
    <div className="sand-library-heading"><h2>资料库</h2><p>对话中的文件</p></div>
    {pages?.failed ? <p className="sand-library-alert" role="alert">
      {pages.pages.length === 0 ? "无法加载你的页面" : "无法加载你的部分页面"}
      <button aria-label="重试" onClick={() => setSourceRetry((n) => n + 1)} type="button">重试</button>
    </p> : null}
    {docs?.failed && docs.docs.length === 0 ? <p className="sand-library-alert" role="alert">
      无法加载你的已连接文档
      <button aria-label="重试" onClick={() => setSourceRetry((n) => n + 1)} type="button">重试</button>
    </p> : null}
    {!gates?.grok_bot_library_v2 && gates?.grok_bot_library_pages && pages !== null && pages.pages.length > 0 ? <div className="sand-library-group" data-library-pages="v1">
      <h3>页面</h3><ul className="sand-library-card">{mergeLibrarySources({ pages: pages.pages, docs: [], media: [] }).slice(0, revealed.pages ?? GROUP_REVEAL).map((row) => row.page ? <li key={row.key}>
        <LibraryPageRow links={links} nowMs={now()} onOpen={() => openRow(row)} onVisibilityChange={() => {}} origin={origin} page={row.page} provider={provider} />
      </li> : null)}
      {(revealed.pages ?? GROUP_REVEAL) < pages.pages.length ? <li><button className="sand-library-expand" type="button" onClick={() => setRevealed((current) => ({ ...current, pages: (current.pages ?? GROUP_REVEAL) + GROUP_REVEAL }))}>展开</button></li> : null}
      </ul>
    </div> : null}
    {groups.length === 0 && (pages?.pages.length ?? 0) === 0 ? <p className="sand-library-empty">此 Bot 创建的页面、文件和应用会显示在这里</p> : null}
    {groups.map((group) => {
      const visible = visibleGroupItems(group.items, revealed[group.key] ?? 5);
      return <div className="sand-library-group" key={group.key}>
        <h3>{BUCKET_LABELS[group.key]}</h3>
        <ul className="sand-library-card">
          {visible.map((row) => <li key={row.key}>
            {row.kind === "page" && row.page !== undefined ? <LibraryPageRow
              links={links} nowMs={now()} onOpen={() => openRow(row)} onVisibilityChange={() => {}}
              origin={origin} page={row.page} provider={provider} /> : null}
            {row.kind === "external-doc" && row.doc !== undefined ? <LibraryExternalRow
              doc={row.doc} nowMs={now()} onOpen={() => openRow(row)} /> : null}
            {row.kind === "media" && row.item !== undefined ? <LibraryMediaRow
              nowMs={now()} onOpen={() => openRow(row)} resolveThumb={resolveThumb}
              row={row.item} /> : null}
          </li>)}
        {visible.length < group.items.length ? <li><button className="sand-library-expand" onClick={() => setRevealed((current) => ({ ...current, [group.key]: (current[group.key] ?? 5) + 5 }))} type="button">展开</button></li> : null}
        </ul>
      </div>;
    })}
    <div ref={sentinel} aria-hidden="true" data-library-history={history} style={{ height: 1 }} />
    {history === "failed" ? <button onClick={() => { void runHistory(); }} type="button">加载失败，重试</button> : null}
    {opened !== null ? <LibraryStage row={opened} desktop={desktop} origin={origin} theme={theme} provider={provider} links={links} resolveMedia={resolveMedia}
      onShareChange={() => setSourceRetry((n) => n + 1)}
      onTitleChange={(title) => {
        if (opened.page === undefined || runId.current !== renderedRun) return;
        const selected = opened.page;
        setPages((current) => current === null ? current : { ...current, pages: current.pages.map((page) => page.kind === "document" && selected.kind === "document" && page.storeId === selected.storeId && page.documentId === selected.documentId ? { ...page, title } : page) });
        setOpened((current) => current?.key === opened.key ? { ...current, page: { ...selected, title } } : current);
        setSourceRetry((n) => n + 1);
      }} onClose={() => { setOpened(null); focusReturn.current?.focus(); }} /> : null}
    {gallery !== null && galleryVisuals.length > 0 ? <MediaViewer attachments={galleryVisuals} startIndex={gallery}
      resolveMedia={(source) => desktop.resolveAttachmentMedia(source)}
      onDownload={(attachment) => { void desktop.downloadAttachment(attachment.path, attachment.name); }}
      onClose={() => { setGallery(null); focusReturn.current?.focus(); }}
      restoreFocus={() => { focusReturn.current?.focus(); }} /> : null}
  </section>;
};
function LibraryStage({ row, desktop, origin, theme, provider, links, resolveMedia, onShareChange, onTitleChange, onClose }: { row: LibraryRow; desktop: LibraryHostDesktop; origin: string | null; theme: "light" | "dark"; provider: LibraryPageProvider; links: LibraryLinkActions; resolveMedia: MediaResolver; onShareChange: () => void; onTitleChange: (title: string) => void; onClose: () => void }) {
  const documentProvider = useMemo(() => ({
    getDocument: (args: Parameters<LibraryHostDesktop["getDocument"]>[0]) => desktop.getDocument(args) as never,
    getDocumentEditRight: (args: Parameters<LibraryHostDesktop["getDocumentEditRight"]>[0]) => desktop.getDocumentEditRight(args),
    saveDocument: (args: Parameters<LibraryHostDesktop["saveDocument"]>[0]) => desktop.saveDocument(args),
    getDocumentAssets: (async (args: Parameters<LibraryHostDesktop["getDocumentAssets"]>[0]) => decodeLibraryJson(await desktop.getDocumentAssets(args))) as (args: Parameters<LibraryHostDesktop["getDocumentAssets"]>[0]) => Promise<{ assets: readonly DocumentAsset[] }>,
  }), [desktop]);
  if (row.kind === "page" && row.page !== undefined) {
    if (row.page.kind === "canvas") {
      return <CanvasStage locator={{ kind: "store", storeId: row.page.storeId, canvasId: row.page.canvasId }} providerOrigin={origin ?? ""}
        provider={provider} links={links} title={row.page.title} theme={theme} onClose={onClose} />;
    }
    return <OverlayDialog open onClose={onClose} label={row.page.title} dataPresentation="document-stage"
      panelStyle={{ width: "calc(100vw - 48px)", height: "calc(100vh - 48px)", overflow: "hidden", borderRadius: 12, background: "var(--cursor-bg-primary)", color: "var(--cursor-text-primary)" }}>
      <div data-library-page-stage="document">
        <DocumentStage locator={{ storeId: row.page.storeId, documentId: row.page.documentId }} title={row.page.title} onTitleChange={onTitleChange}
          provider={documentProvider} onClose={onClose} onShareChange={onShareChange} />
      </div>
    </OverlayDialog>;
  }
  if (row.kind === "media" && row.item !== undefined) {
    const file = mediaSource(row.item);
    if (file === null) return null;
    const sourceKind = classifyLibraryFileKind(sourceFileName(file.source, file.name));
    const fileKind = sourceKind === "unknown" ? classifyLibraryFileKind(file.name) : sourceKind;
    return <LibraryFileViewer kind={fileKind} source={file.source} name={file.name} isOpen onClose={onClose}
      resolveMedia={resolveMedia}
      readTextBytes={(source, maxBytes) => readMediaBytes(desktop, source, maxBytes)}
      readPdfBytes={(source, maxBytes) => readMediaBytes(desktop, source, maxBytes)}
      readDocxBytes={(source, maxBytes) => readMediaBytes(desktop, source, maxBytes)}
      readTableBytes={(source, maxBytes) => readMediaBytes(desktop, source, maxBytes)}
      onDownload={() => downloadMedia(desktop, file.source, file.name)} />;
  }
  return null;
}
async function readMediaBytes(desktop: LibraryHostDesktop, source: string, maxBytes: number): Promise<{ kind: "bytes"; bytes: Uint8Array } | { kind: "too-large"; size: number } | null> {
  try {
    return await desktop.readAttachmentBytes(source, maxBytes);
  } catch {
    return null;
  }
}
async function downloadMedia(desktop: LibraryHostDesktop, source: string, name: string): Promise<boolean> {
  try {
    return await desktop.downloadAttachment(source, name);
  } catch {
    return false;
  }
}
export type { LibraryRow };
