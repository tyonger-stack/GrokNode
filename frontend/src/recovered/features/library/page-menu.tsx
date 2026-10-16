import { useState } from "react";
import type { LibraryPage, LibraryPageRef, LibraryPageVisibility } from "../../../../../source/shared/library-contracts";
import { libraryIdentityKey } from "../../../../../source/shared/library/links";
import { SandMenuRoot, SandMenuTrigger, SandMenuContent, SandMenuItem } from "../../ui/sand-floating-primitives";
import { SandIconButton } from "../../ui/sand-kit-primitives";
import type { LibraryPageProvider } from "./canvas-provider";
import { PageShare, pageShare, type LibraryLinkActions } from "./page-share";

export type LibraryPageMenuProps = {
  readonly page: LibraryPage;
  readonly providerOrigin: string;
  readonly provider: LibraryPageProvider;
  readonly links: LibraryLinkActions;
  readonly onOpen: () => void;
  readonly onVisibilityChange: (visibility: LibraryPageVisibility) => void;
};

/** Original xG/mG/pG: Open is unconditional; sharing follows the page's metadata. */
export function LibraryPageMenu(props: LibraryPageMenuProps) {
  const identity = { providerOrigin: props.providerOrigin, ref: pageRefOf(props.page) };
  return <PageMenuContent key={libraryIdentityKey(identity)} {...props} />;
}

function pageRefOf(page: LibraryPage): LibraryPageRef {
  if (page.kind === "document") return { kind: "document", storeId: page.storeId, documentId: page.documentId };
  return { kind: "canvas", storeId: page.storeId, canvasId: page.canvasId };
}

function PageMenuContent({ page, providerOrigin, provider, links, onOpen, onVisibilityChange }: LibraryPageMenuProps) {
  const [sharing, setSharing] = useState(false);
  const share = pageShare(page);
  const trigger = <SandIconButton icon="dots-3-horizontal" label={`更多操作: ${page.title}`} size="sm" shape="circle" />;
  return <>
    <SandMenuRoot placement="bottom-end" focusItemOnOpen activeIndex={0}>
      <SandMenuTrigger>{trigger}</SandMenuTrigger>
      <SandMenuContent ariaLabel="页面操作" style={{ minWidth: 160 }}>
        <SandMenuItem index={0} onSelect={onOpen}>打开</SandMenuItem>
        {share === null ? null : <SandMenuItem index={1} onSelect={() => setSharing(true)}>分享…</SandMenuItem>}
      </SandMenuContent>
    </SandMenuRoot>
    {share === null ? null : <PageShare identity={{ providerOrigin, ref: pageRefOf(page) }} title={page.title} share={share}
      provider={provider} links={links} open={sharing} onOpenChange={setSharing}
      trigger={<span aria-hidden="true" className="library-page-share-anchor" />}
      onShareChange={next => onVisibilityChange(next.visibility === "private" ? "private" : "team")} />}
  </>;
}
