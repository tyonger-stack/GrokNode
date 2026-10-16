import { useEffect, useRef, useState, type ReactElement } from "react";
import type { LibraryIdentity, LibraryPage, LibraryShare, LibraryWriteVisibility } from "../../../../../source/shared/library-contracts";
import { buildLibraryLink, type LibraryLinkConfig } from "../../../../../source/shared/library/links";
import { SandPopover, SandSelect } from "../../ui/sand-floating-primitives";
import { SandButton } from "../../ui/sand-kit-primitives";
import type { LibraryPageProvider } from "./canvas-provider";
import "./canvas-stage.css";

export type LibraryLinkActions = {
  readonly config: LibraryLinkConfig;
  readonly copyLink: (href: string) => Promise<void>;
  readonly openExternal: (href: string) => void;
};

export async function copyTextToClipboard(href: string): Promise<void> {
  await navigator.clipboard.writeText(href);
}

// Original mG/pG: public and unknown metadata never grant a sharing control.
export function pageShare(page: LibraryPage): LibraryShare | null {
  switch (page.visibility) {
    case "private": return { visibility: "private", canShareToTeam: page.canShareToTeam };
    case "team": return { visibility: "team-view", canShareToTeam: page.canShareToTeam };
    case "public": case "unknown": return null;
  }
}

export type PageShareProps = {
  readonly identity: LibraryIdentity;
  readonly title: string;
  readonly share: LibraryShare;
  readonly provider: LibraryPageProvider;
  readonly links: LibraryLinkActions;
  readonly onShareChange: (share: LibraryShare) => void;
  readonly trigger?: ReactElement;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
};

/** Original O6: server-confirmed private/team access, independent copy status. */
export function PageShare(props: PageShareProps) {
  const { identity, title, share, provider, links, onShareChange } = props;
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const href = buildLibraryLink(identity, links.config);
  const apply = async (visibility: LibraryWriteVisibility) => {
    if (busy.current || visibility === share.visibility || (visibility === "team-view" && !share.canShareToTeam)) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      const ref = identity.ref;
      const echo = ref.kind === "document"
        ? await provider.setDocumentVisibility({ locator: { storeId: ref.storeId, documentId: ref.documentId }, visibility })
        : await provider.setCanvasVisibility({ locator: ref.kind === "canvas"
          ? { kind: "store", storeId: ref.storeId, canvasId: ref.canvasId }
          : { kind: "active-user-store", canvasId: ref.canvasId }, visibility });
      if (active.current) onShareChange({ visibility: echo, canShareToTeam: share.canShareToTeam });
    } catch (error) {
      if (active.current) setFailed(true);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  };
  const copyLink = async () => {
    try { await links.copyLink(href); if (active.current) setCopy("copied"); }
    catch (error) { if (active.current) setCopy("failed"); }
  };
  return <SandPopover ariaLabel="Share page" open={props.open} onOpenChange={props.onOpenChange}
    placement="bottom-end" contentStyle={{ padding: 16, width: 360, background: "var(--cursor-bg-elevated)", borderRadius: 12 }}
    content={<div className="library-page-share">
      <h2>Share {title}</h2>
      <strong>Who can access</strong>
      <SandSelect<LibraryWriteVisibility> ariaLabel="Who can access" value={share.visibility} disabled={pending}
        onValueChange={value => { void apply(value); }} options={[
          { value: "private", label: "Private" },
          { value: "team-view", label: "Team", disabled: !share.canShareToTeam,
            labelMeta: share.canShareToTeam ? undefined : <small>Team sharing is unavailable.</small> },
        ]} />
      <p>{share.visibility === "private" ? "Only you can access this page." : "Anyone on your team can view this page."}</p>
      {failed ? <p role="alert">Failed to update sharing.</p> : null}
      <div className="library-page-share__links">
        <SandButton variant="secondary" onClick={() => { void copyLink(); }}>
          {copy === "copied" ? "Copied" : copy === "failed" ? "Failed to copy" : "Copy link"}
        </SandButton>
        <SandButton variant="secondary" onClick={() => links.openExternal(href)}>Open in browser</SandButton>
      </div>
    </div>}>
    {props.trigger ?? <SandButton variant="secondary">Share</SandButton>}
  </SandPopover>;
}
