// @evidence src/app/package.json#pdfjs-dist=5.4.296
// @evidence src/app/dist/renderer/assets/pdf-WLgSwHwh.js#version=5.4.296
// @evidence src/app/dist/renderer/assets/pdf-WLgSwHwh.js#build=f56dc8601
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#lazy-pdf-viewer
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#pdf-viewer

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { AttachmentBytesResult } from "../../../contracts/desktop-bridge";
import { SandIconButton } from "../../../ui/sand-kit-primitives";

export const PDFJS_ASSET = "/upstream/assets/pdf-WLgSwHwh.js";
export const PDF_WORKER_FILENAME = "pdf.worker.min-qwK7q_zL.mjs";
export const PDF_WORKER_ASSET = `/upstream/assets/${PDF_WORKER_FILENAME}`;
export const PDFJS_VERSION = "5.4.296";
export const PDFJS_BUILD = "f56dc8601";
export const PDF_PREVIEW_BYTE_CAP = 25 * 1024 * 1024;
export const PDF_PAGE_ROOT_MARGIN = "400px 0px";

// @evidence index-UbX-y3il.js#lkn; declarations ship in index-lCyB53CO.css.
// Root class list mirrors upstream `lkn` exactly (incl. padding + no-drag), so
// library DIY viewers stack/scrim/click the same as the native sand-file-viewer.
export const FILE_VIEWER_CLASSES = {
  root: "sand-file-viewer sand-ixxii4 sand-10a8y8t sand-fo81ep sand-78zum5 sand-6s0dn4 sand-l56j7k sand-1gkjlqi sand-9f619 sand-1846v19 sand-lvsv26 sand-482pwi",
  panel: "sand-file-viewer__panel sand-1n2onr6 sand-78zum5 sand-dt5ytf sand-h8yej3 sand-5yr21d sand-1wmrhtn sand-mz0i5r sand-2lwn1j sand-hojbe8 sand-b3r6kr sand-vvtkfd sand-qjedn3 sand-1y0btm7 sand-fnq37j sand-anlk42",
  header: "sand-file-viewer__header sand-78zum5 sand-6s0dn4 sand-1v2ro7d sand-2lah0s sand-9f619 sand-1y1aw1k sand-wib8y2 sand-nm25rq sand-j9b1aj sand-1hkp6id sand-1q0q8m5 sand-1kp61ed sand-s6r99b",
  title: "sand-file-viewer__title sand-78zum5 sand-dt5ytf sand-12mrbbr sand-euugli sand-1iyjqo2 sand-s83m0k",
  toolbar: "sand-file-viewer__toolbar sand-78zum5 sand-6s0dn4 sand-167g77z sand-8x9d4c sand-2lah0s",
  actions: "sand-file-viewer__actions sand-78zum5 sand-6s0dn4 sand-167g77z sand-2lah0s",
  body: "sand-file-viewer__body sand-1n2onr6 sand-1iyjqo2 sand-2lwn1j sand-78zum5 sand-dt5ytf sand-vvtkfd",
} as const;

function documentBaseUrl(): string {
  if (typeof document !== "undefined") return document.baseURI;
  if (typeof location !== "undefined") return location.href;
  return "http://localhost/";
}

export function resolveShippedViewerAsset(filename: string, baseUrl = documentBaseUrl()): string {
  return new URL(`${new URL(baseUrl).protocol === "file:" ? "./assets/" : "/upstream/assets/"}${filename}`, baseUrl).href;
}

export function resolvePdfWorkerUrl(runtimeAssetUrl?: string, baseUrl = documentBaseUrl()): string {
  const runtimeUrl = new URL(runtimeAssetUrl ?? resolveShippedViewerAsset("pdf-WLgSwHwh.js", baseUrl), baseUrl);
  return new URL(PDF_WORKER_FILENAME, runtimeUrl).href;
}

interface PdfViewport {
  readonly width: number;
  readonly height: number;
}

interface PdfRenderTask {
  readonly promise: Promise<void>;
  cancel(): void;
}

interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  render(options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): PdfRenderTask;
  streamTextContent(): unknown;
}

interface PdfDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void> | void;
}

interface PdfRuntime {
  readonly GlobalWorkerOptions: { workerSrc: string };
  readonly TextLayer: new (options: { textContentSource: unknown; container: HTMLDivElement; viewport: PdfViewport }) => {
    render(): Promise<void>;
    cancel(): void;
  };
  getDocument(options: { data: Uint8Array; isEvalSupported: false; disableAutoFetch: true }): { promise: Promise<PdfDocument> };
}

interface PdfRuntimeModule extends Partial<PdfRuntime> {
  readonly default?: Partial<PdfRuntime>;
}

export type PdfRuntimeLoader = () => Promise<PdfRuntime>;
export type PdfBytesResolver = (source: string, maxBytes: number) => Promise<AttachmentBytesResult | null>;

export type PdfBytesSnapshot =
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "too-large"; readonly size: number }
  | { readonly status: "ready"; readonly bytes: Uint8Array };

export type PdfDocumentSnapshot =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly doc: PdfDocument; readonly baseSize: PdfViewport };

export async function loadShippedPdfRuntime(): Promise<PdfRuntime> {
  const runtimeUrl = resolveShippedViewerAsset("pdf-WLgSwHwh.js");
  const module = await import(/* @vite-ignore */ runtimeUrl) as PdfRuntimeModule;
  const runtime = module.default?.getDocument == null ? module : module.default;
  if (runtime.getDocument == null || runtime.GlobalWorkerOptions == null || runtime.TextLayer == null) {
    throw new Error("Shipped PDF runtime is unavailable.");
  }
  runtime.GlobalWorkerOptions.workerSrc = resolvePdfWorkerUrl(runtimeUrl);
  return runtime as PdfRuntime;
}

function snapshotForBytes(result: AttachmentBytesResult | null): PdfBytesSnapshot {
  if (result == null) return { status: "missing" };
  if (result.kind === "too-large") return { status: "too-large", size: result.size };
  return { status: "ready", bytes: result.bytes };
}

export function createPdfBytesStore(source: string, readBytes: PdfBytesResolver, maxBytes = PDF_PREVIEW_BYTE_CAP) {
  let snapshot: PdfBytesSnapshot = { status: "loading" };
  let request = 0;
  const listeners = new Set<() => void>();
  let started = false;
  const notify = () => { for (const listener of listeners) listener(); };
  const start = () => {
    if (started) return;
    started = true;
    const current = ++request;
    void readBytes(source, maxBytes).then((result) => {
      if (current !== request) return;
      snapshot = snapshotForBytes(result);
      notify();
    }).catch(() => {
      if (current !== request) return;
      snapshot = { status: "missing" };
      notify();
    });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      const first = listeners.size === 0;
      listeners.add(listener);
      if (first) start();
      return () => { listeners.delete(listener); };
    },
    dispose() {
      request += 1;
      listeners.clear();
    },
  };
}

export function createPdfDocumentStore(bytes: Uint8Array, loadRuntime: PdfRuntimeLoader = loadShippedPdfRuntime) {
  let snapshot: PdfDocumentSnapshot = { status: "loading" };
  let request = 0;
  const listeners = new Set<() => void>();
  let documentProxy: PdfDocument | null = null;
  const notify = () => { for (const listener of listeners) listener(); };
  const start = () => {
    const current = ++request;
    let pending: PdfDocument | null = null;
    void loadRuntime().then((runtime) => runtime.getDocument({ data: bytes, isEvalSupported: false, disableAutoFetch: true }).promise).then(async (doc) => {
      pending = doc;
      const firstPage = await doc.getPage(1);
      if (current !== request || listeners.size === 0) {
        await doc.destroy();
        return;
      }
      documentProxy = doc;
      pending = null;
      snapshot = { status: "ready", doc, baseSize: firstPage.getViewport({ scale: 1 }) };
      notify();
    }).catch(async () => {
      if (pending != null) await pending.destroy();
      if (current !== request || listeners.size === 0) return;
      snapshot = { status: "error" };
      notify();
    });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      const first = listeners.size === 0;
      listeners.add(listener);
      if (first) {
        snapshot = { status: "loading" };
        start();
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        if (listeners.size === 0) {
          request += 1;
          const doc = documentProxy;
          documentProxy = null;
          snapshot = { status: "loading" };
          void doc?.destroy();
        }
      };
    },
    dispose() {
      request += 1;
      const doc = documentProxy;
      documentProxy = null;
      snapshot = { status: "loading" };
      void doc?.destroy();
      listeners.clear();
    },
  };
}

const emptySnapshot: PdfBytesSnapshot = { status: "loading" };

function usePdfBytes(source: string, readBytes: PdfBytesResolver): PdfBytesSnapshot {
  const storeRef = useRef<{ source: string; store: ReturnType<typeof createPdfBytesStore> } | null>(null);
  if (storeRef.current?.source !== source) {
    storeRef.current?.store.dispose();
    storeRef.current = { source, store: createPdfBytesStore(source, readBytes) };
  }
  const store = storeRef.current?.store;
  return useSyncExternalStore(store?.subscribe ?? (() => () => {}), store?.getSnapshot ?? (() => emptySnapshot), store?.getSnapshot ?? (() => emptySnapshot));
}

function usePdfDocument(bytes: Uint8Array | null): PdfDocumentSnapshot {
  const [snapshot, setSnapshot] = useState<PdfDocumentSnapshot>({ status: "loading" });
  useEffect(() => {
    if (bytes == null) {
      setSnapshot({ status: "loading" });
      return undefined;
    }
    const store = createPdfDocumentStore(bytes);
    const unsubscribe = store.subscribe(() => setSnapshot(store.getSnapshot()));
    setSnapshot(store.getSnapshot());
    return () => { unsubscribe(); store.dispose(); };
  }, [bytes]);
  return snapshot;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rasterScale(pageSize: PdfViewport, displayScale: number, devicePixelRatio: number, viewportWidth: number, viewportHeight: number): number {
  const sourcePixels = pageSize.width * pageSize.height;
  const requested = displayScale * devicePixelRatio > 0 ? displayScale * devicePixelRatio : 1;
  if (!(sourcePixels > 0)) return requested;
  const viewportPixels = viewportWidth * viewportHeight * devicePixelRatio ** 2;
  const pixelBudget = viewportPixels > 0 ? Math.min(1 << 24, viewportPixels * 8) : 1 << 24;
  return Math.min(requested, Math.sqrt(pixelBudget / sourcePixels), 32767 / pageSize.width, 32767 / pageSize.height);
}

function PdfPage({ doc, pageNumber, baseSize, displayScale, textLayerScale, root, pageRef }: { doc: PdfDocument; pageNumber: number; baseSize: PdfViewport; displayScale: number; textLayerScale: number; root: HTMLDivElement | null; pageRef: (element: HTMLDivElement | null) => void }) {
  const pageElementRef = useRef<HTMLDivElement | null>(null);
  const textElementRef = useRef<HTMLDivElement | null>(null);
  const [pageElement, setPageElement] = useState<HTMLDivElement | null>(null);
  const [intersecting, setIntersecting] = useState(false);
  const [pageSize, setPageSize] = useState(baseSize);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const setPageElementRef = useCallback((element: HTMLDivElement | null) => {
    pageElementRef.current = element;
    setPageElement(element);
  }, []);
  useEffect(() => {
    pageRef(pageElement);
    return () => pageRef(null);
  }, [pageElement, pageRef]);

  useEffect(() => {
    if (pageElement == null || root == null) return undefined;
    const observer = new IntersectionObserver(([entry]) => setIntersecting(entry?.isIntersecting === true), { root, rootMargin: PDF_PAGE_ROOT_MARGIN });
    observer.observe(pageElement);
    return () => observer.disconnect();
  }, [pageElement, root]);

  useEffect(() => {
    if (!intersecting) return undefined;
    let cancelled = false;
    let renderTask: PdfRenderTask | null = null;
    const canvas = document.createElement("canvas");
    void doc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const pageViewport = page.getViewport({ scale: 1 });
      setPageSize((current) => current.width === pageViewport.width && current.height === pageViewport.height ? current : pageViewport);
      const devicePixelRatio = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
      const scale = rasterScale(pageViewport, displayScale, devicePixelRatio, root?.clientWidth ?? 0, root?.clientHeight ?? 0);
      const renderViewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      const context = canvas.getContext("2d");
      if (context == null) return;
      renderTask = page.render({ canvas, canvasContext: context, viewport: renderViewport });
      return renderTask.promise.then(() => {
        if (!cancelled) setImageUrl(canvas.toDataURL("image/png"));
      });
    }).catch(() => {});
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [displayScale, doc, intersecting, pageNumber]);

  useEffect(() => {
    if (!intersecting || textElementRef.current == null) return undefined;
    let cancelled = false;
    let textLayer: { render(): Promise<void>; cancel(): void } | null = null;
    void loadShippedPdfRuntime().then((runtime) => doc.getPage(pageNumber).then((page) => {
      if (cancelled || textElementRef.current == null) return;
      textLayer = new runtime.TextLayer({ textContentSource: page.streamTextContent(), container: textElementRef.current, viewport: page.getViewport({ scale: textLayerScale }) });
      return textLayer.render();
    })).catch(() => {});
    return () => { cancelled = true; textLayer?.cancel(); };
  }, [doc, intersecting, pageNumber, textLayerScale]);

  const width = pageSize.width * displayScale;
  const height = pageSize.height * displayScale;
  return <div className="sand-pdf-page sand-1n2onr6 sand-83z2og sand-a7y4k sand-1cum3z5 sand-b3r6kr sand-2lah0s" ref={setPageElementRef} style={{ width, height }}>
    {intersecting && imageUrl != null ? <img alt="" aria-hidden className="sand-10l6tqk sand-10a8y8t sand-1lliihq" src={imageUrl} style={{ width, height }} /> : null}
    {intersecting ? <div className="sand-pdf-page__text" ref={textElementRef} /> : null}
    <span aria-hidden className="sand-pdf-page__badge sand-10l6tqk sand-1nrll8i sand-qo3gd sand-uuh30 sand-1nn3v0j sand-1120s5i sand-163pfp sand-y13l1i sand-149ho13 sand-8qq8ib sand-60d0xz sand-47corl sand-htitgo">{pageNumber}</span>
  </div>;
}

function PdfDocumentPages({ documentState, zoom, onPage, viewportRef }: { documentState: Extract<PdfDocumentSnapshot, { status: "ready" }>; zoom: number; onPage: (page: number) => void; viewportRef: (element: HTMLDivElement | null) => void }) {
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);
  const currentPageRef = useRef(1);
  const setViewportRef = useCallback((element: HTMLDivElement | null) => {
    viewportRef(element);
    setViewportElement((current) => current === element ? current : element);
  }, [viewportRef]);
  const { doc, baseSize } = documentState;
  const displayScale = zoom;
  const onScroll = () => {
    const viewport = viewportElement;
    if (viewport == null) return;
    const line = viewport.scrollTop + 80;
    let page = 1;
    for (let index = 0; index < pageRefs.current.length; index += 1) if ((pageRefs.current[index]?.offsetTop ?? -1) <= line) page = index + 1;
    if (page !== currentPageRef.current) { currentPageRef.current = page; onPage(page); }
  };
  useEffect(() => {
    const viewport = viewportElement;
    if (viewport == null) return undefined;
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [viewportElement]);
  return <div className={FILE_VIEWER_CLASSES.body} ref={setViewportRef}>
    <div className="sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-ou54vl sand-1cnzs8 sand-84yb8i sand-nm25rq sand-yfqnmn">{Array.from({ length: doc.numPages }, (_, index) => <PdfPage baseSize={baseSize} displayScale={displayScale} doc={doc} key={index} pageNumber={index + 1} pageRef={(element) => { pageRefs.current[index] = element; }} root={viewportElement} textLayerScale={displayScale} />)}</div>
  </div>;
}

export interface PdfAttachmentViewerProps {
  source: string;
  name: string;
  isOpen: boolean;
  onClose: () => void;
  readBytes: PdfBytesResolver;
  onDownload: () => Promise<boolean>;
  restoreFocus?: () => void;
}

function OpenPdfAttachmentViewer({ source, name, onClose, readBytes, onDownload, restoreFocus }: Omit<PdfAttachmentViewerProps, "isOpen">) {
  const bytes = usePdfBytes(source, readBytes);
  const documentState = usePdfDocument(bytes.status === "ready" ? bytes.bytes : null);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const setViewportRef = useCallback((element: HTMLDivElement | null) => { viewportRef.current = element; }, []);
  const pageCountRef = useRef(0);
  pageCountRef.current = documentState.status === "ready" ? documentState.doc.numPages : 0;
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef(restoreFocus);
  onCloseRef.current = onClose;
  restoreFocusRef.current = restoreFocus;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); }
      else if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoom((value) => clamp(value + 0.25, 0.5, 4)); }
      else if (event.key === "-") { event.preventDefault(); setZoom((value) => clamp(value - 0.25, 0.5, 4)); }
      else if (event.key === "PageDown" || event.key === "ArrowRight") { event.preventDefault(); setCurrentPage((value) => Math.min(pageCountRef.current || value, value + 1)); }
      else if (event.key === "PageUp" || event.key === "ArrowLeft") { event.preventDefault(); setCurrentPage((value) => Math.max(1, value - 1)); }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("keydown", onKeyDown, true); document.body.style.overflow = previousOverflow; restoreFocusRef.current?.(); };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const page = viewport?.querySelector<HTMLDivElement>(`.sand-pdf-page:nth-child(${currentPage})`);
    if (viewport != null && page != null) viewport.scrollTo({ top: Math.max(0, page.offsetTop - 16) });
  }, [currentPage]);
  const pages = documentState.status === "ready" ? documentState.doc.numPages : 0;
  const content = bytes.status === "too-large"
    ? <div className={FILE_VIEWER_CLASSES.body} role="alert"><strong>PDF too large to preview</strong><span>This PDF is too large to preview here. Download it to open in your PDF reader.</span><button onClick={() => { void onDownload(); }} type="button">Download</button></div>
    : bytes.status === "missing" || documentState.status === "error"
      ? <div className={FILE_VIEWER_CLASSES.body} role="alert"><strong>{bytes.status === "missing" ? "File unavailable" : "Couldn't render this PDF"}</strong>{documentState.status === "error" ? <button onClick={() => { void onDownload(); }} type="button">Download</button> : null}</div>
      : documentState.status !== "ready"
        ? <div aria-live="polite" className={FILE_VIEWER_CLASSES.body} role="status">Loading PDF…</div>
        : <PdfDocumentPages documentState={documentState} onPage={setCurrentPage} viewportRef={setViewportRef} zoom={zoom} />;
  const titleId = useId();
  return createPortal(<div aria-labelledby={titleId} aria-modal="true" className={FILE_VIEWER_CLASSES.root} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog">
    <section className={FILE_VIEWER_CLASSES.panel}>
      <header className={FILE_VIEWER_CLASSES.header}><div className={FILE_VIEWER_CLASSES.title}><h2 id={titleId}>{name}</h2>{pages > 0 ? <span>{pages} {pages === 1 ? "page" : "pages"}</span> : null}</div><div className={FILE_VIEWER_CLASSES.toolbar}><button aria-label="Zoom out" onClick={() => setZoom((value) => clamp(value - 0.25, 0.5, 4))} type="button">−</button><span aria-label={`Page ${currentPage} of ${pages}`}>{pages > 0 ? `${currentPage} / ${pages}` : ""}</span><button aria-label="Zoom in" onClick={() => setZoom((value) => clamp(value + 0.25, 0.5, 4))} type="button">+</button></div><div className={FILE_VIEWER_CLASSES.actions}><SandIconButton aria-label="下载" icon="desktop-download" onClick={() => { void onDownload(); }} shape="square" size="sm" variant="ghost" /><SandIconButton aria-label="关闭" icon="close" onClick={onClose} shape="square" size="sm" variant="ghost" /></div></header>
      {content}
    </section>
  </div>, document.body);
}

export function PdfAttachmentViewer(props: PdfAttachmentViewerProps) {
  if (!props.isOpen || typeof document === "undefined") return null;
  return <OpenPdfAttachmentViewer {...props} />;
}
