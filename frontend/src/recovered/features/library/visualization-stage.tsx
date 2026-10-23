import { useEffect, useRef, useState } from "react";
import type { TranscriptVisualization } from "../../../../../source/host/extensions/library/transcript-media";
import { frameDeclarations, heightDeclarations, themeDeclarations } from "./visualization-upstream.js";
import { OverlayDialog } from "../../ui/overlay-primitives";
const FRAME_CLASSNAME = "sand-visualization-frame";
const FRAME_FALLBACK_HEIGHT_PX = 360;
const FRAME_LOAD_TIMEOUT_MS = 30000;
export type VisualizationStageTheme = "light" | "dark";
export interface VisualizationStageMessage {
  readonly kind: "height" | "wheel" | "engaged" | "hover" | "escape" | "error" | "state";
  readonly contentHeightPx?: number;
  readonly error?: { readonly kind: string; readonly message: string; readonly stack?: string };
}
export interface VisualizationStageRuntime {
  parseVisualizationFragment(html: string): { readonly html: string; readonly runtimes: ReadonlyArray<string> };
  buildVisualizationDocument(args: {
    readonly title: string;
    readonly theme: VisualizationStageTheme;
    readonly themeVariables: Readonly<Record<string, string>>;
    readonly typography: unknown;
    readonly fragment: { readonly html: string; readonly runtimes: ReadonlyArray<string> };
    readonly runtimeSources: Readonly<Record<string, string>>;
    readonly contentHeightPx?: number;
  }): string;
  parseVisualizationFrameMessage(data: unknown): VisualizationStageMessage | null;
  visualizationBoundsMessage(bounds: { readonly height: number; readonly maxHeight: number }): unknown;
  isVisualizationThemeVariables(value: unknown): value is Readonly<Record<string, string>>;
  loadRuntimeSource(name: "d3" | "three"): Promise<string>;
}
export interface VisualizationStageDesktop {
  readVisualizationFragment(args: { readonly agentId: string; readonly entryId: string; readonly documentSha256: string }): Promise<{ readonly html: string }>;
  stageVisualizationDocument(args: { readonly html: string }): Promise<{ readonly frameUrl: string }>;
}
export type VisualizationStageStatus =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly frameUrl: string }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "unavailable" };
function assertUpstream(condition: unknown, message: string | (() => string)): void {
  if (condition) return;
  throw new Error(typeof message === "function" ? message() : message);
}
function upstreamDebounce(options: { readonly name: string; readonly delayMs: number }) {
  return {
    wrap<T extends (value: number) => void>(fn: T): T & { dispose(): void } {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const wrapped = ((value: number): void => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(value); }, options.delayMs);
      }) as T & { dispose(): void };
      wrapped.dispose = (): void => {
        if (timer !== null) { clearTimeout(timer); timer = null; }
      };
      return wrapped;
    },
  };
}
const frameApi = frameDeclarations({ contentHeight: (heightPx) => ({ height: Math.max(0, heightPx ?? 0), maxHeight: Math.max(0, heightPx ?? 0) }) });
const heightApi = heightDeclarations({ debounce: upstreamDebounce });
const themeApi = themeDeclarations({ assert: assertUpstream });
export function visualizationThemeVariables(theme: VisualizationStageTheme): Readonly<Record<string, string>> {
  return themeApi.theme.variables[theme];
}
export function visualizationTypography(): unknown {
  return themeApi.theme.typography;
}
export function visualizationDatavizTokens(theme: VisualizationStageTheme): Readonly<Record<string, string>> {
  return themeApi.series(theme);
}
export function defaultVisualizationRuntimeBaseUrl(): string {
  return new URL("./assets/", document.baseURI).href;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function requiredFunction(record: Record<string, unknown>, name: string): (...args: Array<never>) => unknown {
  const fn = record[name];
  if (typeof fn !== "function") throw new Error("visualization runtime is missing " + name);
  return fn as (...args: Array<never>) => unknown;
}
export function defaultVisualizationRuntime(baseUrl: string = defaultVisualizationRuntimeBaseUrl()): () => Promise<VisualizationStageRuntime> {
  let builder: VisualizationStageRuntime | null = null;
  const sources = new Map<string, Promise<string>>();
  return async (): Promise<VisualizationStageRuntime> => {
    if (builder !== null) return builder;
    const module = await import(baseUrl + "grok-node-0721-visualization.mjs") as unknown;
    if (!isRecord(module)) throw new Error("visualization runtime module has an unexpected shape");
    const parseFragment = requiredFunction(module, "parseVisualizationFragment") as (html: string) => { html: string; runtimes: string[] };
    const buildDocument = requiredFunction(module, "buildVisualizationDocument") as (args: {
      title: string; theme: VisualizationStageTheme; themeVariables: Readonly<Record<string, string>>;
      typography: unknown; fragment: { html: string; runtimes: string[] };
      runtimeSources: Record<string, string>; contentHeightPx?: number;
    }) => string;
    const parseFrameMessage = requiredFunction(module, "parseVisualizationFrameMessage") as (data: unknown) => VisualizationStageMessage | null;
    const boundsMessage = requiredFunction(module, "visualizationBoundsMessage") as (bounds: { height: number; maxHeight: number }) => unknown;
    const isThemeVars = requiredFunction(module, "isVisualizationThemeVariables") as (value: unknown) => boolean;
    const loadSource = (name: "d3" | "three"): Promise<string> => {
      const cached = sources.get(name);
      if (cached !== undefined) return cached;
      const pending = (async (): Promise<string> => {
        const runtimeModule = await import(baseUrl + "grok-node-0721-" + name + ".mjs") as unknown;
        if (!isRecord(runtimeModule)) throw new Error("visualization " + name + " runtime has an unexpected shape");
        const key = name === "d3" ? "VISUALIZATION_D3_RUNTIME_JS" : "VISUALIZATION_THREE_RUNTIME_JS";
        const source = runtimeModule[key];
        if (typeof source !== "string" || source.length === 0) throw new Error("visualization " + name + " runtime is empty");
        return source;
      })();
      sources.set(name, pending);
      return pending;
    };
    builder = {
      parseVisualizationFragment: (html) => {
        const fragment = parseFragment(html);
        return { html: fragment.html, runtimes: [...fragment.runtimes] };
      },
      buildVisualizationDocument: (args) => buildDocument({
        title: args.title,
        theme: args.theme,
        themeVariables: { ...args.themeVariables },
        typography: args.typography,
        fragment: { html: args.fragment.html, runtimes: [...args.fragment.runtimes] },
        runtimeSources: { ...args.runtimeSources },
        contentHeightPx: args.contentHeightPx,
      }),
      parseVisualizationFrameMessage: (data) => parseFrameMessage(data),
      visualizationBoundsMessage: (bounds) => boundsMessage({ height: bounds.height, maxHeight: bounds.maxHeight }),
      isVisualizationThemeVariables: (value): value is Readonly<Record<string, string>> => isThemeVars(value) as boolean,
      loadRuntimeSource: loadSource,
    };
    return builder;
  };
}
async function loadDocumentHtml(runtime: VisualizationStageRuntime, args: {
  readonly fragmentHtml: string;
  readonly title: string;
  readonly theme: VisualizationStageTheme;
  readonly contentHeightPx?: number;
}): Promise<string> {
  const fragment = runtime.parseVisualizationFragment(args.fragmentHtml);
  const themeVariables = visualizationThemeVariables(args.theme);
  if (!runtime.isVisualizationThemeVariables(themeVariables)) {
    throw new Error("visualization theme is missing required variables for " + args.theme);
  }
  const runtimeSources: Record<string, string> = {};
  for (const name of fragment.runtimes) {
    if (name !== "d3" && name !== "three") throw new Error("unsupported visualization runtime: " + name);
    runtimeSources[name] = await runtime.loadRuntimeSource(name);
  }
  return runtime.buildVisualizationDocument({
    title: args.title,
    theme: args.theme,
    themeVariables,
    typography: visualizationTypography(),
    fragment,
    runtimeSources,
    contentHeightPx: args.contentHeightPx,
  });
}
function isUnavailable(error: unknown): boolean {
  return error instanceof Error && /unavailable/i.test(error.message);
}
export function VisualizationStage(props: {
  readonly agentId: string;
  readonly visual: TranscriptVisualization;
  readonly theme: VisualizationStageTheme;
  readonly desktop: VisualizationStageDesktop;
  readonly runtime?: VisualizationStageRuntime | (() => Promise<VisualizationStageRuntime>);
  readonly onClose: () => void;
}): React.JSX.Element {
  const { agentId, visual, theme, desktop, onClose } = props;
  const runtimeProp = props.runtime;
  const loaderRef = useRef<() => Promise<VisualizationStageRuntime>>(
    typeof runtimeProp === "function" ? runtimeProp : async () => runtimeProp ?? defaultVisualizationRuntime()(),
  );
  const [status, setStatus] = useState<VisualizationStageStatus>({ status: "loading" });
  const [frameHeightPx, setFrameHeightPx] = useState<number>(() => visual.heightPx ?? 360);
  const [retryCount, setRetryCount] = useState(0);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setStatus((current) => current.status === "loading" ? { status: "failed", message: "visualization frame timed out" } : current);
    }, 30000);
    void (async () => {
      try {
        const runtime = await loaderRef.current();
        if (cancelled) return;
        const fragment = await desktop.readVisualizationFragment({ agentId, entryId: visual.entryId, documentSha256: visual.documentSha256 });
        if (cancelled) return;
        if (fragment.html.length === 0) {
          setStatus({ status: "unavailable" });
          return;
        }
        const documentHtml = await loadDocumentHtml(runtime, {
          fragmentHtml: fragment.html,
          title: visual.title,
          theme,
          contentHeightPx: visual.heightPx,
        });
        if (cancelled) return;
        const staged = await desktop.stageVisualizationDocument({ html: documentHtml });
        if (cancelled) return;
        if (typeof staged.frameUrl !== "string" || staged.frameUrl.length === 0) {
          throw new Error("visualization stage returned no frame url");
        }
        setStatus({ status: "ready", frameUrl: staged.frameUrl });
      } catch (error) {
        if (cancelled) return;
        if (isUnavailable(error)) setStatus({ status: "unavailable" });
        else setStatus({ status: "failed", message: error instanceof Error ? error.message : "visualization failed to load" });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [agentId, visual, theme, desktop, props.runtime, retryCount]);
  useEffect(() => {
    if (status.status !== "ready") return;
    const slot = slotRef.current;
    if (slot === null) return;
    const iframe = frameApi.attach(slot, { frameUrl: status.frameUrl, title: visual.title, className: "sand-visualization-frame" });
    iframe.style.width = "100%";
    iframe.style.height = frameHeightPx + "px";
    slot.dataset.visualizationHeight = String(frameHeightPx);
    const controller = heightApi.controller({
      appliedHeightPx: frameHeightPx,
      apply: (value) => { setFrameHeightPx(value); },
    });
    const pointer = frameApi.pointerRelease(iframe, () => undefined);
    const bounds = frameApi.bounds({ heightPx: frameHeightPx });
    const postBounds = (runtime: VisualizationStageRuntime): void => {
      try {
        iframe.contentWindow?.postMessage(runtime.visualizationBoundsMessage(bounds), "*");
      } catch { /* frame gone */ }
    };
    const onLoad = (): void => {
      const runtime = runtimeRef.current;
      if (runtime !== null) postBounds(runtime);
    };
    iframe.addEventListener("load", onLoad);
    const owner = iframe.ownerDocument.defaultView ?? window;
    const runtimeRef: { current: VisualizationStageRuntime | null } = { current: null };
    void loaderRef.current().then((runtime) => { runtimeRef.current = runtime; });
    const onMessage = (event: MessageEvent): void => {
      if (event.source == null || event.source !== iframe.contentWindow) return;
      const runtime = runtimeRef.current;
      if (runtime === null) return;
      const parsed = runtime.parseVisualizationFrameMessage(event.data);
      if (parsed === null) return;
      if (parsed.kind === "height" && typeof parsed.contentHeightPx === "number") {
        controller.report(heightApi.height(parsed.contentHeightPx));
      } else if (parsed.kind === "escape") {
        closeRef.current();
      } else if (parsed.kind === "hover" || parsed.kind === "engaged") {
        pointer.arm();
      } else if (parsed.kind === "error") {
        setStatus({ status: "failed", message: parsed.error?.message ?? "visualization frame failed" });
      }
    };
    owner.addEventListener("message", onMessage);
    void loaderRef.current().then((runtime) => { runtimeRef.current = runtime; postBounds(runtime); });
    return () => {
      owner.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", onLoad);
      pointer.dispose();
      controller.dispose();
      iframe.remove();
    };
  }, [status, visual.title, frameHeightPx]);
  if (status.status === "loading") {
    return (
      <OverlayDialog open onClose={onClose} label={visual.title} dataPresentation="visualization-stage">
        <p role="status">\u6b63\u5728\u52a0\u8f7d\u53ef\u89c6\u5316\u2026</p>
      </OverlayDialog>
    );
  }
  if (status.status === "unavailable") {
    return (
      <OverlayDialog open onClose={onClose} label={visual.title} dataPresentation="visualization-stage">
        <p role="alert">\u53ef\u89c6\u5316\u6682\u4e0d\u53ef\u7528</p>
        {visual.summary === "" ? null : <p>{visual.summary}</p>}
        <button onClick={onClose} type="button">\u5173\u95ed</button>
      </OverlayDialog>
    );
  }
  if (status.status === "failed") {
    return (
      <OverlayDialog open onClose={onClose} label={visual.title} dataPresentation="visualization-stage">
        <p role="alert">{status.message}</p>
        <button onClick={() => setRetryCount((n) => n + 1)} type="button">\u91cd\u8bd5</button>
      </OverlayDialog>
    );
  }
  return (
    <OverlayDialog open onClose={onClose} label={visual.title} dataPresentation="visualization-stage">
      <div ref={slotRef} data-visualization-frame={visual.key} />
    </OverlayDialog>
  );
}
