/** Renderer DTOs recovered from Grok Bot 0.68.1 main-app.cjs and eager-app. */
export type DocumentLocator = { readonly storeId: string; readonly documentId: string };
export type CanvasLocator =
  | { readonly kind: "store"; readonly storeId: string; readonly canvasId: string }
  | { readonly kind: "active-user-store"; readonly canvasId: string };
export type LibraryPageRef =
  | ({ readonly kind: "document" } & DocumentLocator)
  | { readonly kind: "canvas"; readonly storeId: string; readonly canvasId: string }
  | { readonly kind: "active-user-store-canvas"; readonly canvasId: string };
export type LibraryPageVisibility = "private" | "team" | "public" | "unknown";
export type LibraryWriteVisibility = "private" | "team-view";
export type LibraryShare = { readonly visibility: LibraryWriteVisibility; readonly canShareToTeam: boolean };
export type LibraryPage = Exclude<LibraryPageRef, { kind: "active-user-store-canvas" }> & {
  readonly title: string;
  readonly createdAtMs: number | null;
  readonly updatedAtMs: number | null;
  readonly visibility: LibraryPageVisibility;
  readonly canShareToTeam: boolean;
};
export type LibraryPageResolution =
  | { readonly status: "found"; readonly ref: LibraryPageRef; readonly page: LibraryPage }
  | { readonly status: "absent" | "failed"; readonly ref: LibraryPageRef };
export type LibraryPageState =
  | { readonly status: "resolving" | "absent" | "failed" }
  | { readonly status: "found"; readonly page: LibraryPage };
export type LibraryPages = {
  readonly pages: readonly LibraryPage[];
  readonly storeId: string | null;
  readonly isComplete: boolean;
  readonly isDegraded: boolean;
  readonly listedAtMs: number;
};
export type LibraryExternalProvider =
  | "notion" | "google-docs" | "google-sheets" | "google-slides" | "google-drive"
  | "onedrive" | "sharepoint" | "figma" | "figjam" | "figma-slides"
  | "linear-issue" | "linear-document" | "confluence-page" | "jira-issue"
  | "github-file" | "github-gist" | "github-issue" | "slack-canvas" | "box"
  | "dropbox" | "airtable" | "coda" | "miro" | "canva" | "hex" | "gmail-draft"
  | "google-calendar-event" | "slack-message" | "github-pull-request" | "web" | "other";
export type LibraryExternalDoc = {
  readonly key: string; readonly provider: LibraryExternalProvider; readonly externalId: string;
  readonly url: string; readonly title: string | null; readonly createdByBot: boolean;
  readonly lastAction: "created" | "edited";
  readonly firstTouchedAtMs: number; readonly lastTouchedAtMs: number;
};
export type LibraryDocs = { readonly docs: readonly LibraryExternalDoc[]; readonly listedAtMs: number };
export type DocumentReadArgs = { readonly locator: DocumentLocator; readonly groupChatId?: string };
export type DocumentRead = DocumentReadArgs & { readonly source: string; readonly share: LibraryShare | null };
export type DocumentEditRight = { readonly locator: DocumentLocator; readonly canEdit: boolean };
export type DocumentSave = { readonly locator: DocumentLocator; readonly title: string };
export type DocumentAsset = { readonly name: string } & (
  | { readonly status: "ready"; readonly bytes: Uint8Array; readonly contentType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; readonly etag: string | null }
  | { readonly status: "missing" | "not_image" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "too_large"; readonly sizeBytes: number }
);
export type DocumentAssets = { readonly assets: readonly DocumentAsset[] };
export type CanvasShare = { readonly storeId: string; readonly canvasId: string; readonly share: LibraryShare | null };
export type CanvasPayload = { readonly renderBundleGzip: Uint8Array; readonly dataJson: Uint8Array };

/** Original argument and result shapes. No origin or trusted principal is inserted here. */
export interface LibraryMethods {
  resolveLibraryPages(args: { readonly refs: readonly LibraryPageRef[]; readonly includeDocuments: boolean }): Promise<readonly LibraryPageResolution[]>;
  listLibraryPages(args: { readonly includeDocuments: boolean }): Promise<LibraryPages>;
  listLibraryDocs(args: { readonly agentId: string }): Promise<LibraryDocs>;
  getDocument(args: DocumentReadArgs): Promise<DocumentRead>;
  getDocumentEditRight(args: { readonly locator: DocumentLocator }): Promise<DocumentEditRight>;
  saveDocument(args: { readonly locator: DocumentLocator; readonly source: string }): Promise<DocumentSave>;
  setDocumentVisibility(args: { readonly locator: DocumentLocator; readonly visibility: LibraryWriteVisibility }): Promise<LibraryWriteVisibility>;
  getDocumentAssets(args: DocumentReadArgs & { readonly names: readonly string[] }): Promise<DocumentAssets>;
  getCanvasShare(args: { readonly locator: CanvasLocator }): Promise<CanvasShare>;
  setCanvasVisibility(args: { readonly locator: CanvasLocator; readonly visibility: LibraryWriteVisibility }): Promise<LibraryWriteVisibility>;
}
export const DOCUMENT_ASSET_LIMITS = {
  names: 20, concurrency: 4, bytes: 5 * 1024 * 1024, timeoutMs: 10_000, cacheBytes: 64 * 1024 * 1024,
} as const;
export type LibraryMethod = keyof LibraryMethods;
export type LibraryArgs<M extends LibraryMethod> = Parameters<LibraryMethods[M]>[0];
export type LibraryResult<M extends LibraryMethod> = Awaited<ReturnType<LibraryMethods[M]>>;
export type { LibraryIdentity, LibraryPrincipal, LibraryOwner, LibraryRequestContext, LibraryExecutionContext,
  NativePublishInput, NativePublishResult, NativePublishEvent, NativePublishOutbox, NodeLibraryProvider } from "./library/provider.js";
