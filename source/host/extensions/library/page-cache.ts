import { ZodError } from "zod";
import type { LibraryPage, LibraryPageRef, LibraryRequestContext } from "../../../shared/library-contracts.js";
import { libraryPageRefSchema } from "../../../shared/library/schemas.js";
import { LibraryContractError } from "../../../shared/library/errors.js";

/**
 * Task 8a: port of the original page-ref resolve cache (E e5/Y6).
 * Per-ref resolving/found/absent/failed with retain revalidation,
 * failed-only retry, in-flight dedup, and epoch invalidation so late
 * responses can never roll back newer share/title/source state.
 */
export type PageResolveStatus = "resolving" | "found" | "absent" | "failed";
export type PageResolveResult =
  | { readonly status: "found"; readonly ref: LibraryPageRef; readonly page: LibraryPage }
  | { readonly status: "absent" | "failed"; readonly ref: LibraryPageRef };
export interface PageFetchResult {
  readonly status: "found" | "absent";
  readonly page?: LibraryPage;
}
export interface PageResolvePort {
  fetchPage(ref: LibraryPageRef, context: LibraryRequestContext): Promise<PageFetchResult>;
}
type CacheSlot =
  | { status: "found"; page: LibraryPage; epoch: number; ref: LibraryPageRef }
  | { status: "resolving" | "absent" | "failed"; epoch: number; ref: LibraryPageRef };
export function pageRefKey(ref: LibraryPageRef): string {
  const parsed = libraryPageRefSchema.parse(ref);
  if (parsed.kind === "document") return `document:${parsed.storeId}:${parsed.documentId}`;
  if (parsed.kind === "canvas") return `canvas:${parsed.storeId}:${parsed.canvasId}`;
  return `active-user-store-canvas:${parsed.canvasId}`;
}
function scopeKey(context: LibraryRequestContext): string {
  return JSON.stringify([context.providerOrigin, context.principal.accountId, context.principal.principalId]);
}
export interface PageResolveCache {
  peek(ref: LibraryPageRef, context: LibraryRequestContext): CacheSlot | null;
  resolveRefs(args: { readonly refs: readonly LibraryPageRef[]; readonly includeDocuments: boolean }, context: LibraryRequestContext): Promise<readonly PageResolveResult[]>;
  retryFailed(context: LibraryRequestContext): Promise<readonly PageResolveResult[]>;
  invalidateScope(context: LibraryRequestContext): void;
  invalidateAll(): void;
}
export function createPageResolveCache(port: PageResolvePort): PageResolveCache {
  const slots = new Map<string, CacheSlot>();
  const inflight = new Map<string, Promise<PageResolveResult>>();
  let epoch = 0;
  const keyOf = (ref: LibraryPageRef, context: LibraryRequestContext): string => `${scopeKey(context)}\n${pageRefKey(ref)}`;
  const commit = (key: string, atEpoch: number, result: PageResolveResult): PageResolveResult => {
    if (atEpoch !== epoch) return { status: "failed", ref: result.ref };
    const slot = slots.get(key);
    if (slot != null && slot.epoch > atEpoch) return result;
    if (result.status === "found") {
      slots.set(key, { status: "found", page: result.page, epoch: atEpoch, ref: result.ref });
    } else {
      slots.set(key, { status: result.status, epoch: atEpoch, ref: result.ref });
    }
    return result;
  };
  const fetchOne = (ref: LibraryPageRef, context: LibraryRequestContext, atEpoch: number): Promise<PageResolveResult> => {
    const key = keyOf(ref, context);
    const running = inflight.get(key);
    if (running !== undefined) return running;
    const holder: { task?: Promise<PageResolveResult> } = {};
    holder.task = (async (): Promise<PageResolveResult> => {
      try {
        const fetched = await port.fetchPage(ref, context);
        if (fetched.status === "found") {
          if (fetched.page === undefined) {
            throw new LibraryContractError("invalid-argument", "Page fetch returned found without a page");
          }
          const parsedEcho = libraryPageRefSchema.parse(fetched.page.kind === "document"
            ? { kind: "document", storeId: fetched.page.storeId, documentId: fetched.page.documentId }
            : { kind: "canvas", storeId: fetched.page.storeId, canvasId: fetched.page.canvasId });
          const identityMatches = ref.kind === "active-user-store-canvas"
            ? parsedEcho.kind === "canvas" && parsedEcho.canvasId === ref.canvasId
            : pageRefKey(parsedEcho) === pageRefKey(ref);
          if (!identityMatches) {
            return commit(key, atEpoch, { status: "failed", ref });
          }
          return commit(key, atEpoch, { status: "found", ref, page: fetched.page });
        }
        return commit(key, atEpoch, { status: "absent", ref });
      } catch (error) {
        if (error instanceof LibraryContractError || error instanceof ZodError) throw error;
        return commit(key, atEpoch, { status: "failed", ref });
      } finally {
        if (inflight.get(key) === holder.task) inflight.delete(key);
      }
    })();
    const task = holder.task;
    inflight.set(key, task);
    return task;
  };
  return {
    peek(ref, context) {
      return slots.get(keyOf(ref, context)) ?? null;
    },
    async resolveRefs(args, context) {
      context.signal.throwIfAborted();
      const atEpoch = epoch;
      const pending = new Map<string, Promise<PageResolveResult>>();
      const out: Array<Promise<PageResolveResult>> = [];
      for (const ref of args.refs) {
        const parsed = libraryPageRefSchema.parse(ref);
        if (parsed.kind === "document" && !args.includeDocuments) {
          out.push(Promise.resolve({ status: "absent", ref: parsed } as const));
          continue;
        }
        const key = keyOf(parsed, context);
        const known = pending.get(key);
        if (known !== undefined) {
          out.push(known);
          continue;
        }
        const slot = slots.get(key);
        if (slot !== undefined && slot.epoch === atEpoch && slot.status === "found") {
          const hit: Promise<PageResolveResult> = Promise.resolve({ status: "found", ref: parsed, page: slot.page });
          pending.set(key, hit);
          out.push(hit);
          continue;
        }
        if (slot !== undefined && slot.epoch === atEpoch && (slot.status === "absent" || slot.status === "failed")) {
          const hit: Promise<PageResolveResult> = Promise.resolve(slot.status === "absent"
            ? { status: "absent", ref: parsed }
            : { status: "failed", ref: parsed });
          pending.set(key, hit);
          out.push(hit);
          continue;
        }
        slots.set(key, { status: "resolving", epoch: atEpoch, ref: parsed });
        const task = fetchOne(parsed, context, atEpoch);
        pending.set(key, task);
        out.push(task);
      }
      return Promise.all(out);
    },
    async retryFailed(context) {
      context.signal.throwIfAborted();
      const atEpoch = epoch;
      const scope = scopeKey(context);
      const out: Array<Promise<PageResolveResult>> = [];
      for (const [key, slot] of slots) {
        if (!key.startsWith(scope) || slot.status !== "failed" || slot.epoch !== atEpoch) continue;
        slots.set(key, { status: "resolving", epoch: atEpoch, ref: slot.ref });
        out.push(fetchOne(slot.ref, context, atEpoch));
      }
      return Promise.all(out);
    },
    invalidateScope(context) {
      epoch += 1;
      const scope = scopeKey(context);
      for (const key of [...slots.keys()]) if (key.startsWith(scope)) slots.delete(key);
      for (const key of [...inflight.keys()]) if (key.startsWith(scope)) inflight.delete(key);
    },
    invalidateAll() {
      epoch += 1;
      slots.clear();
      inflight.clear();
    },
  };
}
