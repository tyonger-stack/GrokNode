import type { LibraryExternalDoc, LibraryPage } from "../../../shared/library-contracts.js";
import type { TranscriptMediaRow } from "./transcript-media.js";

/**
 * Task 9: port of the original v1/v2 merge, sort, grouping and history
 * rules (R MRe/ZF/oG/dG, E Ace/yUe/mUe). Timestamps sort descending
 * with null last; ties break page, external-doc, media, then key.
 * Groups use local midnights: today, six-day week, older (null older).
 * Each group reveals 5 rows at a time; history loads at most 10 older
 * batches per visible run through a loadable/loading/failed/exhausted
 * gate owned here so the view stays a pure renderer of this state.
 */
export type LibraryGroupKey = "today" | "week" | "older";
export type LibraryRowKind = "page" | "external-doc" | "media";
export interface LibraryRow {
  readonly kind: LibraryRowKind;
  readonly key: string;
  readonly timestampMs: number | null;
  readonly page?: LibraryPage;
  readonly doc?: LibraryExternalDoc;
  readonly item?: TranscriptMediaRow;
}
export interface LibraryGroup {
  readonly key: LibraryGroupKey;
  readonly items: readonly LibraryRow[];
}
const ROW_ORDER: Record<LibraryRowKind, number> = { page: 0, "external-doc": 1, media: 2 };
export const GROUP_REVEAL = 5;
export const HISTORY_MAX_CALLS = 10;
export type HistoryState = "loadable" | "loading" | "failed" | "exhausted";
export function dayStartMs(nowMs: number): number {
  const day = new Date(nowMs);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}
export function bucketForTimestamp(timestampMs: number | null | undefined, nowMs: number): LibraryGroupKey {
  if (timestampMs == null) return "older";
  if (timestampMs >= dayStartMs(nowMs)) return "today";
  const week = new Date(nowMs);
  week.setDate(week.getDate() - 6);
  week.setHours(0, 0, 0, 0);
  if (timestampMs >= week.getTime()) return "week";
  return "older";
}
export function compareLibraryRows(a: LibraryRow, b: LibraryRow): number {
  const aTs = a.timestampMs == null ? Number.NEGATIVE_INFINITY : a.timestampMs;
  const bTs = b.timestampMs == null ? Number.NEGATIVE_INFINITY : b.timestampMs;
  if (aTs !== bTs) return bTs - aTs;
  if (a.kind !== b.kind) return ROW_ORDER[a.kind] - ROW_ORDER[b.kind];
  return a.key.localeCompare(b.key);
}
export function pageRowKey(page: LibraryPage): string {
  if (page.kind === "document") return `document:${page.storeId}:${page.documentId}`;
  return `canvas:${page.storeId}:${page.canvasId}`;
}
export function mergeLibrarySources(args: { pages: readonly LibraryPage[]; docs: readonly LibraryExternalDoc[]; media: readonly TranscriptMediaRow[] }): LibraryRow[] {
  const rows: LibraryRow[] = [
    ...args.pages.map((page): LibraryRow => ({
      kind: "page", key: pageRowKey(page),
      timestampMs: page.updatedAtMs ?? null, page,
    })),
    ...args.docs.map((doc): LibraryRow => ({
      kind: "external-doc", key: `doc:${doc.key}`,
      timestampMs: doc.lastTouchedAtMs, doc,
    })),
    ...args.media.map((item): LibraryRow => ({
      kind: "media", key: `media:${item.id}`,
      timestampMs: item.timestampMs, item,
    })),
  ];
  return rows.toSorted(compareLibraryRows);
}
export function groupLibraryRows(rows: readonly LibraryRow[], nowMs: number): LibraryGroup[] {
  const groups: Record<LibraryGroupKey, LibraryRow[]> = { today: [], week: [], older: [] };
  for (const row of rows) groups[bucketForTimestamp(row.timestampMs, nowMs)].push(row);
  const out: LibraryGroup[] = [];
  for (const key of ["today", "week", "older"] as const) {
    if (groups[key].length > 0) out.push({ key, items: groups[key] });
  }
  return out;
}
export function visibleGroupItems<T>(items: readonly T[], revealed: number): readonly T[] {
  return items.slice(0, Math.max(GROUP_REVEAL, revealed));
}
export interface HistoryLoader {
  readonly state: HistoryState;
  readonly calls: number;
  loadOlder(): Promise<HistoryState>;
  retry(): Promise<HistoryState>;
}
export function createHistoryLoader(loadBatch: () => Promise<boolean>): HistoryLoader {
  let state: HistoryState = "loadable";
  let calls = 0;
  const run = async (): Promise<HistoryState> => {
    if (state === "loading") return state;
    if (calls >= HISTORY_MAX_CALLS) {
      state = "exhausted";
      return state;
    }
    state = "loading";
    calls += 1;
    try {
      state = (await loadBatch()) ? "loadable" : "exhausted";
    } catch {
      state = "failed";
    }
    return state;
  };
  return {
    get state() { return state; },
    get calls() { return calls; },
    loadOlder: run,
    retry: run,
  };
}
