import { createDeadlinePolicy, realClock } from "../../../internal/scheduling.js";
import { DOCUMENT_ASSET_LIMITS, type DocumentAsset, type DocumentAssets, type DocumentLocator, type LibraryArgs, type LibraryRequestContext } from "../../../shared/library-contracts.js";
import { documentAssetNameSchema, libraryArgsSchemas } from "../../../shared/library/schemas.js";
import { LibraryContractError } from "../../../shared/library/errors.js";
import { DocumentAssetCache } from "./asset-cache.js";
import { readDocumentAsset, type AuthorizedAssetSource } from "./asset-transport.js";

export type { AssetReadOptions, AssetResponse, AuthorizedAssetSource } from "./asset-transport.js";
type AssetArgs = LibraryArgs<"getDocumentAssets">;

/** Trusted provider resolves ACLs and owns all URLs/file handles. Never accepts a renderer path. */
export interface AuthorizedDocumentAssetPort {
  authorizeAssets(args: AssetArgs, context: LibraryRequestContext): Promise<AuthorizedDocumentAssetBatch>;
}
export type AuthorizedDocumentAssetBatch = {
  readonly context: Pick<LibraryRequestContext, "principal" | "providerOrigin">;
  readonly locator: DocumentLocator;
  readonly groupChatId?: string;
  readonly sources: ReadonlyMap<string, AuthorizedAssetSource>;
};

export function isDocumentAssetName(name: string): boolean { return documentAssetNameSchema.safeParse(name).success; }
const deadline = createDeadlinePolicy(realClock, { name: "document-asset-fetch", timeoutMs: DOCUMENT_ASSET_LIMITS.timeoutMs });

function scopePrefix(context: Pick<LibraryRequestContext, "principal" | "providerOrigin">): string {
  return JSON.stringify([context.providerOrigin, context.principal.accountId, context.principal.principalId]).slice(0, -1) + ",";
}

export function createDocumentAssetService(port: AuthorizedDocumentAssetPort) {
  const cache = new DocumentAssetCache();
  const active = new Map<AbortController, string>();
  let disposed = false;

  return {
    clearScope(context: Pick<LibraryRequestContext, "principal" | "providerOrigin">): void {
      const prefix = scopePrefix(context);
      cache.clear(prefix);
      for (const [controller, scope] of active) {
        if (scope === prefix) controller.abort(new DOMException("Document asset scope cleared", "AbortError"));
      }
    },
    dispose(): void {
      disposed = true;
      cache.clear("");
      for (const controller of active.keys()) controller.abort(new DOMException("Document asset service disposed", "AbortError"));
    },
    async getDocumentAssets(args: AssetArgs, context: LibraryRequestContext): Promise<DocumentAssets> {
      context.signal.throwIfAborted();
      if (disposed) throw new DOMException("Document asset service disposed", "AbortError");
      const parsed = libraryArgsSchemas.getDocumentAssets.parse(args);
      args = { locator: parsed.locator, names: parsed.names, ...(parsed.groupChatId === undefined ? {} : { groupChatId: parsed.groupChatId }) };
      const names = [...new Set(args.names.filter(isDocumentAssetName))].slice(0, DOCUMENT_ASSET_LIMITS.names);
      if (names.length === 0) return { assets: [] };
      const scope = scopePrefix(context);
      const controller = new AbortController();
      active.set(controller, scope);
      const signal = AbortSignal.any([context.signal, controller.signal]);
      try {
        // Authorize on every access, including a cached 304; revocation cannot expose old bytes.
        const batch = await deadline.run(readSignal => port.authorizeAssets({ ...args, names }, { ...context, signal: readSignal }), signal);
        signal.throwIfAborted();
        if (scopePrefix(batch.context) !== scope || batch.locator.storeId !== args.locator.storeId ||
            batch.locator.documentId !== args.locator.documentId || batch.groupChatId !== args.groupChatId) {
          throw new LibraryContractError("identity-mismatch", "Document asset authorization returned a different identity");
        }
        const assets: DocumentAsset[] = [];
        let next = 0;
        const worker = async () => {
          for (;;) {
            signal.throwIfAborted();
            const index = next++;
            const name = names[index];
            if (name === undefined) return;
            const key = scope + JSON.stringify([args.locator.storeId, args.locator.documentId, name, args.groupChatId ?? null]).slice(1);
            const source = batch.sources.get(name);
            if (source === undefined) { cache.delete(key); assets[index] = { name, status: "missing" }; continue; }
            try {
              const asset = await deadline.run(readSignal => readDocumentAsset({ name, source, cached: cache.get(key) }, readSignal), signal);
              signal.throwIfAborted();
              if (asset.status === "ready") cache.set(key, asset);
              else cache.delete(key);
              assets[index] = asset;
            } catch (error) {
              signal.throwIfAborted();
              cache.delete(key);
              if (!(error instanceof Error)) throw error;
              assets[index] = { name, status: "failed", reason: error.message };
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(names.length, DOCUMENT_ASSET_LIMITS.concurrency) }, worker));
        signal.throwIfAborted();
        return { assets };
      } finally {
        active.delete(controller);
      }
    },
  };
}
