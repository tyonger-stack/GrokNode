import { useEffect, useId, useRef, useState } from "react";
import type { CanvasLocator, CanvasShare } from "../../../../../source/shared/library-contracts";
import { buildLibraryLink, canvasLocatorToRef, libraryIdentityKey } from "../../../../../source/shared/library/links";
import { buildCanvasFrameUrl, type CanvasTheme } from "../../../../../source/host/extensions/library/canvas-protocol";
import { OverlayDialog } from "../../ui/overlay-primitives";
import { SandButton } from "../../ui/sand-kit-primitives";
import { LibraryStageCloseButton } from "./stage-icon-button";
import { SandSpinner } from "../../ui/sand-status-primitives";
import type { LibraryPageProvider } from "./canvas-provider";
import { PageShare, type LibraryLinkActions } from "./page-share";
import "./canvas-stage.css";

export type CanvasStageProps = {
  readonly locator: CanvasLocator;
  readonly providerOrigin: string;
  readonly provider: LibraryPageProvider;
  readonly links: LibraryLinkActions;
  readonly title: string;
  readonly theme: CanvasTheme;
  readonly revision?: string;
  readonly groupChatId?: string;
  readonly onClose: () => void;
  readonly onShareChange?: (snapshot: CanvasShare) => void;
};
type ShareLoad = { readonly kind: "loading" | "error" } | { readonly kind: "ready"; readonly snapshot: CanvasShare };

/** Original Jp/E$: locator changes retire metadata requests; frame loading is independent. */
export function CanvasStage(props: CanvasStageProps) {
  const key = libraryIdentityKey({ providerOrigin: props.providerOrigin, ref: canvasLocatorToRef(props.locator) });
  return <CanvasStageContent key={key} {...props} />;
}

function CanvasStageContent(props: CanvasStageProps) {
  const { provider, locator, links, providerOrigin } = props;
  const [load, setLoad] = useState<ShareLoad>({ kind: "loading" });
  const titleId = useId();
  const locatorKey = JSON.stringify(locator);
  useEffect(() => {
    let active = true;
    setLoad({ kind: "loading" });
    provider.getCanvasShare({ locator }).then(
      snapshot => { if (active) setLoad({ kind: "ready", snapshot }); },
      () => { if (active) setLoad({ kind: "error" }); },
    );
    return () => { active = false; };
  }, [provider, locatorKey]);
  const frameUrl = buildCanvasFrameUrl(locator, props.theme, props.groupChatId, props.revision);
  const snapshot = load.kind === "ready" ? load.snapshot : null;
  const identity = snapshot === null ? null : { providerOrigin,
    ref: { kind: "canvas" as const, storeId: snapshot.storeId, canvasId: snapshot.canvasId } };
  return <OverlayDialog open onClose={props.onClose} labelledBy={titleId} className="library-canvas-stage" dataPresentation="canvas-stage">
    <div data-canvas-sheet="stage" data-share-state={load.kind} className="library-canvas-stage__body">
      <header className="library-canvas-stage__header">
        <LibraryStageCloseButton aria-label="Close page" onClick={props.onClose} />
        <div className="library-canvas-stage__title"><small>Page</small><h2 id={titleId}>{props.title}</h2></div>
        <div className="library-canvas-stage__actions">
          {load.kind === "loading" ? <SandSpinner ariaLabel="Loading sharing" /> : null}
          {snapshot !== null && identity !== null ? snapshot.share !== null
            ? <PageShare key={libraryIdentityKey(identity)} identity={identity} title={props.title} share={snapshot.share} provider={provider} links={links}
                onShareChange={share => { const next = { ...snapshot, share }; setLoad({ kind: "ready", snapshot: next }); props.onShareChange?.(next); }} />
            : <SandButton variant="secondary" onClick={() => links.openExternal(buildLibraryLink(identity, links.config))}>Open in browser</SandButton>
            : load.kind === "error" ? <SandButton variant="secondary" disabled aria-label="Sharing unavailable">Share</SandButton> : null}
        </div>
      </header>
      <CanvasFrame key={frameUrl} frameUrl={frameUrl} title={props.title} onClose={props.onClose} />
    </div>
  </OverlayDialog>;
}

/** Original q6/R$: changing theme/revision remounts; only onLoad reveals the frame. */
function CanvasFrame({ frameUrl, title, onClose }: { readonly frameUrl: string; readonly title: string; readonly onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const close = (event: MessageEvent<unknown>) => {
      if (event.source !== null && event.source === frame.current?.contentWindow &&
          typeof event.data === "object" && event.data !== null && "type" in event.data &&
          event.data.type === "cursor-canvas-frame-close-request") onClose();
    };
    window.addEventListener("message", close);
    return () => window.removeEventListener("message", close);
  }, [onClose]);
  return <div className="library-canvas-frame" data-frame-state={loaded ? "loaded" : "loading"}>
    {loaded ? null : <div className="library-canvas-frame__loading"><SandSpinner ariaLabel="Loading page" /></div>}
    <iframe ref={frame} src={frameUrl} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer"
      style={{ opacity: loaded ? 1 : 0 }} onLoad={() => {
        frame.current?.contentWindow?.postMessage({ type: "cursor-canvas-frame-content-column",
          columnWidthPx: 656, gutterPx: 28, topInsetPx: 60, bottomInsetPx: 24 }, "*");
        setLoaded(true);
      }} />
  </div>;
}
