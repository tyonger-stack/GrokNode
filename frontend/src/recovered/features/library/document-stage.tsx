import { useEffect, useRef, useState } from "react";
import "./document-stage.css";
import { SandIconButton } from "../../ui/sand-kit-primitives";
import { LibraryStageCloseButton } from "./stage-icon-button";
import type { NativeDocumentHandle } from "./native-document-markdown";
import { NativeDocumentMarkdown, extractDocumentAssetNames } from "./native-document-markdown";
export { extractDocumentAssetNames, extractLocalAssetNames } from "./native-document-markdown";
import type { DocumentAsset, DocumentLocator, LibraryWriteVisibility } from "../../../../../source/shared/library-contracts";

export interface DocumentStageProvider {
  getDocument(args: { locator: DocumentLocator }): Promise<{ source: string; share: { visibility: LibraryWriteVisibility; canShareToTeam: boolean } | null }>;
  getDocumentEditRight(args: { locator: DocumentLocator }): Promise<{ canEdit: boolean }>;
  saveDocument(args: { locator: DocumentLocator; source: string }): Promise<{ title: string }>;
  getDocumentAssets(args: { locator: DocumentLocator; names: readonly string[] }): Promise<{ assets: readonly DocumentAsset[] }>;
}
export interface DocumentStageProps {
  readonly locator: DocumentLocator;
  readonly title: string;
  readonly provider: DocumentStageProvider;
  readonly assetNames?: readonly string[];
  readonly saveDelayMs?: number;
  readonly onClose: () => void;
  readonly onTitleChange?: (title: string) => void;
  readonly onShareChange?: (share: { visibility: LibraryWriteVisibility; canShareToTeam: boolean } | null) => void;
  readonly onEditAttempt?: (kind: "focus" | "key" | "pointer") => void;
  readonly editorHandle?: { current: NativeDocumentHandle | null };
  readonly restoreFocus?: () => void;
}
type ContentLoad = { kind: "loading" } | { kind: "ready"; source: string } | { kind: "error" };
type SaveState = "clean" | "saving" | "saved" | "error";
export function assetLabel(asset: DocumentAsset): string {
  switch (asset.status) {
    case "ready": return `${asset.name} (${asset.contentType})`;
    case "missing": return `${asset.name} (missing)`;
    case "failed": return `${asset.name} (failed: ${asset.reason})`;
    case "too_large": return `${asset.name} (too large: ${asset.sizeBytes} bytes)`;
    case "not_image": return `${asset.name} (not an image)`;
  }
}
export function DocumentStage(props: DocumentStageProps) {
  const { locator, provider, assetNames = [], saveDelayMs = 2000 } = props;
  const [reload, setReload] = useState(0);
  const locatorKey = JSON.stringify(locator);
  const [content, setContent] = useState<ContentLoad>({ kind: "loading" });
  const [editable, setEditable] = useState(false);
  const [draft, setDraft] = useState("");
  const [save, setSave] = useState<SaveState>("clean");
  const [assets, setAssets] = useState<readonly DocumentAsset[] | null>(null);
  const [assetsFailed, setAssetsFailed] = useState(false);
  const generation = useRef(0);
  const persisted = useRef("");
  const inFlight = useRef(false);
  const queued = useRef(false);
  const namesRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ draft, save });
  latest.current = { draft, save };
  const close = (): void => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    void flushRef.current();
    props.restoreFocus?.();
    props.onClose();
  };
  const flushRef = useRef((): Promise<void> => Promise.resolve());
  flushRef.current = async (): Promise<void> => {
    const current = latest.current;
    if (!editable) return;
    if (inFlight.current) { queued.current = true; return; }
    if (current.draft === persisted.current) return;
    inFlight.current = true;
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    const at = generation.current;
    setSave("saving");
    try {
      const saved = await provider.saveDocument({ locator: JSON.parse(locatorKey), source: current.draft });
      if (generation.current !== at) return;
      persisted.current = current.draft;
      inFlight.current = false;
      setSave("saved");
      props.onTitleChange?.(saved.title);
      if (queued.current || latest.current.draft !== persisted.current) {
        queued.current = false;
        void flushRef.current();
      }
    } catch {
      if (generation.current !== at) return;
      inFlight.current = false;
      queued.current = false;
      setSave("error");
    }
  };
  useEffect(() => {
    const at = (generation.current += 1);
    inFlight.current = false; queued.current = false;
    namesRef.current = null;
    setContent({ kind: "loading" });
    setEditable(false);
    setSave("clean");
    setAssets(null);
    setAssetsFailed(false);
    provider.getDocument({ locator }).then(
      (read) => { if (generation.current !== at) return; persisted.current = read.source; latest.current.draft = read.source; setDraft(read.source); props.onShareChange?.(read.share); setContent({ kind: "ready", source: read.source }); },
      () => { if (generation.current === at) setContent({ kind: "error" }); },
    );
    provider.getDocumentEditRight({ locator }).then(
      (right) => { if (generation.current === at) setEditable(right.canEdit); },
      () => { if (generation.current === at) setEditable(false); },
    );
    return () => { generation.current += 1; if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } };
  }, [locatorKey, reload, provider]);
  useEffect(() => {
    if (content.kind !== "ready") return;
    const at = generation.current;
    const names = [...new Set([...assetNames, ...extractDocumentAssetNames(draft)])];
    const namesKey = names.join("\0");
    if (namesKey === namesRef.current) return;
    namesRef.current = namesKey;
    if (names.length === 0) {
      if (generation.current === at) setAssets([]);
      return;
    }
    setAssets(null);
    setAssetsFailed(false);
    provider.getDocumentAssets({ locator: JSON.parse(locatorKey), names }).then(
      (result) => { if (generation.current === at) setAssets(result.assets); },
      () => { if (generation.current === at) setAssetsFailed(true); },
    );
  }, [locatorKey, reload, content.kind === "ready" ? draft : null, JSON.stringify(assetNames), provider]);
  const edit = (next: string): void => {
    latest.current.draft = next;
    setDraft(next);
    if (!editable) return;
    if (inFlight.current) queued.current = true;
    if (save === "error") setSave("clean");
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flushRef.current(); }, saveDelayMs);
  };
  const retryAsset = (name: string): void => {
    const at = generation.current;
    provider.getDocumentAssets({ locator: JSON.parse(locatorKey), names: [name] }).then(
      (result) => {
        if (generation.current !== at) return;
        setAssetsFailed(false);
        const next = result.assets.find(asset => asset.name === name);
        if (next === undefined) return;
        setAssets((current) => (current ?? []).map((asset) => (asset.name === name ? next : asset)));
      },
      () => { if (generation.current === at) setAssetsFailed(true); },
    );
  };
  if (content.kind === "loading") return <p role="status">Loading document\u2026</p>;
  if (content.kind === "error") {
    return <div role="alert"><p>Couldn&apos;t load this document.</p>
      <button onClick={() => { setReload((n) => n + 1); }} type="button">Retry</button>
      <button onClick={close} type="button">Close</button></div>;
  }
  return <div className="library-document-stage">
    <header className="library-document-stage__header">
      <LibraryStageCloseButton aria-label="Close document" onClick={close} />
      <div className="library-document-stage__title"><h2>{props.title}</h2></div>
      <div className="library-document-stage__actions">
        <span role="status" aria-label="Save state">{save === "clean" ? "Saved" : save === "saving" ? "Saving\u2026" : save === "saved" ? "All changes saved" : "Save failed"}</span>
        {save === "error" ? <SandIconButton aria-label="Retry save" icon="refresh" onClick={() => { void flushRef.current(); }} shape="circle" size="sm" variant="ghost" /> : null}
      </div>
    </header>
    <NativeDocumentMarkdown key={locatorKey + reload} source={draft} editable={editable}
      assets={assets} onChange={edit} onBlur={() => { void flushRef.current(); }} onRetryAsset={retryAsset}
      onEditAttempt={props.onEditAttempt}
      editorHandle={props.editorHandle} />
    {assetsFailed ? <p role="alert">Could not load materials. <button type="button" onClick={() => { for (const name of extractDocumentAssetNames(draft)) retryAsset(name); }}>Retry materials</button></p> : null}
  </div>;
}
