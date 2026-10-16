import type { LibraryMethods, LibraryRequestContext, NodeLibraryProvider } from "../../../../../source/shared/library-contracts";

export type LibraryPageProvider = Pick<LibraryMethods, "getCanvasShare" | "setCanvasVisibility" | "setDocumentVisibility">;

/** Bind in the trusted service/IPC composition layer; renderer arguments never carry identity. */
export function bindLibraryPageProvider(
  provider: Pick<NodeLibraryProvider, keyof LibraryPageProvider>,
  trustedContext: () => LibraryRequestContext,
): LibraryPageProvider {
  return {
    getCanvasShare: args => provider.getCanvasShare(args, trustedContext()),
    setCanvasVisibility: args => provider.setCanvasVisibility(args, trustedContext()),
    setDocumentVisibility: args => provider.setDocumentVisibility(args, trustedContext()),
  };
}
