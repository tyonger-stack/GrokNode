import type { LibraryPage, LibraryRequestContext } from "../../../shared/library-contracts.js";

/**
 * Task 8b: port of the original account page index (M $1e list path).
 * Canvases first (up to 20 pages of 50), then per-store document scans
 * (up to 10 pages of 1000, 200 documents total, 8 concurrent stores).
 * A canvas-list failure fails the listing; a document-scan failure
 * degrades it (isComplete false, isDegraded true) instead of faking
 * empty. Entries stay fresh for 30 seconds; a degraded entry forces
 * a revisit on the next call.
 */
export interface CanvasSummaryPage {
  readonly pages: readonly LibraryPage[];
  readonly nextPageToken?: string;
}
export interface DocumentSummaryPage {
  readonly pages: readonly LibraryPage[];
  readonly nextPageToken?: string;
}
export interface PageIndexPort {
  listCanvasSummaries(args: { pageSize: number; pageToken?: string }, context: LibraryRequestContext): Promise<CanvasSummaryPage>;
  ownedDocumentStores(context: LibraryRequestContext): readonly string[];
  listDocumentSummaries(args: { storeId: string; pageSize: number; pageToken?: string }, context: LibraryRequestContext): Promise<DocumentSummaryPage>;
}
export interface LibraryPageIndex {
  readonly pages: readonly LibraryPage[];
  readonly storeId: string | null;
  readonly isComplete: boolean;
  readonly isDegraded: boolean;
  readonly listedAtMs: number;
}
const CANVAS_PAGES = 20;
const CANVAS_PAGE_SIZE = 50;
const CANVAS_TOTAL = CANVAS_PAGES * CANVAS_PAGE_SIZE;
const DOC_PAGES = 10;
const DOC_PAGE_SIZE = 1000;
const DOC_TOTAL = 200;
const DOC_CONCURRENCY = 8;
const FRESH_MS = 30000;
interface IndexEntry {
  index: LibraryPageIndex;
  atMs: number;
  scope: string;
}
function indexScope(context: LibraryRequestContext, includeDocuments: boolean): string {
  return JSON.stringify([context.providerOrigin, context.principal.accountId, context.principal.principalId, includeDocuments]);
}
async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const current = next;
      next += 1;
      await work(items[current] as T);
    }
  });
  await Promise.all(runners);
}
export function createPageIndex(port: PageIndexPort, clock: () => number = Date.now) {
  let cached: IndexEntry | null = null;
  let epoch = 0;
  const clearFor = (scope: string): void => {
    if (cached != null && cached.scope === scope) cached = null;
  };
  return {
    invalidateScope(context: LibraryRequestContext): void {
      epoch += 1;
      clearFor(indexScope(context, true));
      clearFor(indexScope(context, false));
    },
    invalidateAll(): void {
      epoch += 1;
      cached = null;
    },
    async list(args: { includeDocuments: boolean }, context: LibraryRequestContext): Promise<LibraryPageIndex> {
      context.signal.throwIfAborted();
      const scope = indexScope(context, args.includeDocuments);
      if (cached != null && cached.scope === scope && clock() - cached.atMs < FRESH_MS && !cached.index.isDegraded) {
        return cached.index;
      }
      const atEpoch = epoch;
      const pages: LibraryPage[] = [];
      let degraded = false;
      let pageToken: string | undefined;
      for (let page = 0; page < CANVAS_PAGES; page += 1) {
        const listing = await port.listCanvasSummaries(pageToken === undefined ? { pageSize: CANVAS_PAGE_SIZE } : { pageSize: CANVAS_PAGE_SIZE, pageToken }, context);
        const remaining = CANVAS_TOTAL - pages.length;
        const bounded = listing.pages.slice(0, Math.min(remaining, CANVAS_PAGE_SIZE));
        if (bounded.length < listing.pages.length) degraded = true;
        pages.push(...bounded);
        if (pages.length >= CANVAS_TOTAL) {
          if (listing.nextPageToken !== undefined) degraded = true;
          break;
        }
        if (listing.nextPageToken === undefined) break;
        pageToken = listing.nextPageToken;
      }
      if (args.includeDocuments) {
        const stores = port.ownedDocumentStores(context);
        const collected: LibraryPage[] = [];
        await pool(stores, DOC_CONCURRENCY, async (storeId) => {
          let token: string | undefined;
          for (let page = 0; page < DOC_PAGES; page += 1) {
            let listing: DocumentSummaryPage;
            try {
              listing = await port.listDocumentSummaries(token === undefined ? { storeId, pageSize: DOC_PAGE_SIZE } : { storeId, pageSize: DOC_PAGE_SIZE, pageToken: token }, context);
            } catch {
              degraded = true;
              return;
            }
            collected.push(...listing.pages);
            if (listing.nextPageToken === undefined) return;
            token = listing.nextPageToken;
          }
        });
        pages.push(...collected.slice(0, DOC_TOTAL));
        if (collected.length > DOC_TOTAL) degraded = true;
      }
      const index: LibraryPageIndex = {
        pages,
        storeId: null,
        isComplete: !degraded,
        isDegraded: degraded,
        listedAtMs: clock(),
      };
      if (atEpoch !== epoch) return { ...index, pages: [], isComplete: false, isDegraded: true };
      cached = { index, atMs: index.listedAtMs, scope };
      return index;
    },
  };
}
