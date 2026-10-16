import { resolveLibraryHttpConfigFromEnv, startLibraryHttpServer, type LibraryHttpHandle } from "./http-server.js";
import { ZodError } from "zod";
import { assertNoSymlinkInPath } from "../../../packages/agent-store-sync/paths.js";
import { runWithLibraryMcpExecution } from "../../../shared/library/mcp-result-hook.js";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, constants, fstatSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type {
  LibraryArgs,
  LibraryPage,
  LibraryRequestContext,
} from "../../../shared/library-contracts.js";
import { libraryStoreIdSchema } from "../../../shared/library/schemas.js";
import { LibraryContractError } from "../../../shared/library/errors.js";
import { defineHostExtension } from "../../../internal/host-extensions.js";
import { getSandRootDir } from "../../host-paths.js";
import { HostExtensions } from "../extension-ids.generated.js";
import { LibraryCatalog } from "./catalog.js";
import { LibraryCatalogError } from "./migrations.js";
import { verifyContent } from "./catalog/secure.js";
import { createDocumentsService, type DocumentsService } from "./documents-service.js";
import { createDocumentAssetService, isDocumentAssetName, type AuthorizedDocumentAssetPort } from "./document-assets.js";
import type { AssetResponse, AuthorizedAssetSource } from "./asset-transport.js";
import { createCanvasService, CanvasStoreUnavailableError, type AuthorizedCanvasPort } from "./canvas-service.js";
import { createPageResolveCache } from "./page-cache.js";
import { createPageIndex } from "./page-index.js";
import { registerLibraryMcpResultHook } from "../../../shared/library/mcp-result-hook.js";
import { createNativeProducer } from "./native-producer.js";
import { createLibraryMcpRegistration } from "./mcp-registration.js";
import { createLibraryContentStore } from "./library-content.js";
/**
 * Task 13a: the host-owned Library composition (Node design).
 * One catalog, one content root and one provider origin feed documents,
 * assets, canvases, external touches, page resolution and the native
 * producer. Main-process callers authenticate with the provisioned
 * credential issued here; renderer arguments never carry identity.
 * No active-user-store exists on Node: those refs resolve absent and
 * those locators fail with the original store-unavailable error.
 */
export const GROK_NODE_LIBRARY_ORIGIN = "https://groknode.local";
const MAIN_ACCOUNT = "node-local-account";
export const LIBRARY_MAIN_STORE = "node-local-store";
const MAIN_STORE = LIBRARY_MAIN_STORE;
export interface LibraryExtensionOptions {
  readonly dataRoot?: string;
  readonly providerOrigin?: string;
  readonly randomUUID?: () => string;
  readonly transcript?: { getAgentTranscriptPage(agentId: string, query: unknown): unknown; listAgentIds?(): readonly string[] | Promise<readonly string[]> };
}
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function readLocalFile(root: string, relativePath: string): Uint8Array | null {
  const file = resolve(root, relativePath);
  if (!file.startsWith(root + sep) || relativePath.startsWith(sep)) throw new LibraryContractError("invalid-argument", "Invalid asset path");
  try {
    assertNoSymlinkInPath(file);
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new LibraryContractError("rejected", "Unsafe asset file");
      return new Uint8Array(readFileSync(fd));
    } finally { closeSync(fd); }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
function toAssetResponse(bytes: Uint8Array | null, ifNoneMatch: string | undefined): AssetResponse {
  if (bytes === null) return { status: 404, headers: { get: () => null }, body: null };
  const etag = `"${sha256Hex(bytes)}"`;
  if (ifNoneMatch !== undefined && ifNoneMatch === etag) {
    return { status: 304, headers: { get: () => null }, body: null };
  }
  let done = false;
  return {
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === "content-length" ? String(bytes.byteLength) : name.toLowerCase() === "etag" ? etag : null) },
    body: {
      cancel: async () => { done = true; },
      getReader: () => ({
        read: async () => {
          if (done) return { done: true };
          done = true;
          return { done: false, value: bytes };
        },
        cancel: async () => { done = true; },
        releaseLock: () => undefined,
      }),
    },
  };
}
export function createLibraryHostService(options: LibraryExtensionOptions = {}) {
  const dataRoot = resolve(options.dataRoot ?? join(getSandRootDir(), "library"));
  const nodeOrigin = options.providerOrigin ?? process.env.SAND_LIBRARY_ORIGIN ?? GROK_NODE_LIBRARY_ORIGIN;
  const catalog = new LibraryCatalog({ dataRoot, providerOrigin: nodeOrigin });
  const documents: DocumentsService = createDocumentsService({ dataRoot, catalog });
  const content = createLibraryContentStore({ dataRoot });
  const assets = createDocumentAssetService({
    async authorizeAssets(args, context) {
      const object = catalog.readObject(context, { storeId: args.locator.storeId, kind: "document", objectId: args.locator.documentId });
      const sources = new Map<string, AuthorizedAssetSource>();
      if (object === null) return { context, locator: args.locator, sources };
      for (const name of new Set(args.names.filter(isDocumentAssetName)).size > 0 ? args.names.filter(isDocumentAssetName) : []) {
        const relativePath = `library/documents/${object.objectId}/assets/${name}`;
        sources.set(name, { kind: "read", read: async (readOptions) => toAssetResponse(readLocalFile(dataRoot, relativePath), readOptions.ifNoneMatch) });
      }
      return { context, locator: args.locator, sources };
    },
  } satisfies AuthorizedDocumentAssetPort);
  const canvasPort: AuthorizedCanvasPort = {
    async listUserCanvases(context) { return { storeId: activeUserStore(context) }; },
    async readGroupChatCanvas() { throw new CanvasStoreUnavailableError("Group chat canvases are unavailable on this host."); },
    async getCanvasPayload({ storeId, canvasId }, context) {
      const object = catalog.readObject(context, { storeId, kind: "canvas", objectId: canvasId });
      if (object === null) return { metadata: null, renderBundleGzip: new Uint8Array(), dataJson: new Uint8Array() };
      verifyContent(dataRoot, object.contentPath, object.contentHash);
      const bytes = readLocalFile(dataRoot, object.contentPath);
      if (bytes === null) return { metadata: null, renderBundleGzip: new Uint8Array(), dataJson: new Uint8Array() };
      if (sha256Hex(bytes) !== object.contentHash) throw new LibraryContractError("rejected", "Canvas content hash mismatch");
      const manifest = JSON.parse(Buffer.from(bytes).toString("utf8")) as { version?: number; renderBundleGzip?: string; dataJson?: string };
      if (manifest.version !== 1 || typeof manifest.renderBundleGzip !== "string" || typeof manifest.dataJson !== "string") {
        throw new LibraryContractError("invalid-argument", "Canvas manifest is not recognized.");
      }
      return {
        metadata: { storeId, canvasId, share: canvasShareJson(object, context) },
        renderBundleGzip: new Uint8Array(Buffer.from(manifest.renderBundleGzip, "base64")),
        dataJson: new Uint8Array(Buffer.from(manifest.dataJson, "base64")),
      };
    },
    async getCanvasMetadata({ storeId, canvasId }, context) {
      const object = catalog.readObject(context, { storeId, kind: "canvas", objectId: canvasId });
      if (object === null) return { metadata: null };
      return { metadata: { storeId, canvasId, share: canvasShareJson(object, context) } };
    },
    async setCanvasVisibility({ storeId, canvasId, visibility }, context) {
      const updated = catalog.setVisibility(context, { storeId, kind: "canvas", objectId: canvasId }, visibility);
      return { visibility: updated.visibility === "private" ? "CANVAS_VISIBILITY_PRIVATE" : "CANVAS_VISIBILITY_TEAM_VIEW" };
    },
  };
  const activeUserStore = (context: LibraryRequestContext): string | null =>
    catalog.identity.ownedStores(context).includes(MAIN_STORE) ? MAIN_STORE : null;
  const canvas = createCanvasService(canvasPort, { dataRoot, catalog });
  const pages = createPageResolveCache({
    async fetchPage(ref, context) {
      const storeId = ref.kind === "active-user-store-canvas" ? activeUserStore(context) : ref.storeId;
      if (storeId === null) return { status: "absent" };
      const object = catalog.readObject(context, ref.kind === "document"
        ? { storeId, kind: "document", objectId: ref.documentId }
        : { storeId, kind: "canvas", objectId: ref.canvasId });
      if (object === null) return { status: "absent" };
      return { status: "found", page: toLibraryPage(object, context) };
    },
  });
  const index = createPageIndex({
    async listCanvasSummaries({ pageSize, pageToken }, context) {
      const all = catalog.listPages(context, false).filter((page) => page.kind === "canvas");
      const start = pageToken === undefined ? 0 : Number(pageToken);
      if (!Number.isSafeInteger(start) || start < 0) throw new LibraryContractError("invalid-argument", "Invalid canvas page token.");
      const slice = all.slice(start, start + pageSize);
      return start + pageSize < all.length ? { pages: slice, nextPageToken: String(start + pageSize) } : { pages: slice };
    },
    ownedDocumentStores(context: LibraryRequestContext) {
      return catalog.identity.ownedStores(context);
    },
    async listDocumentSummaries({ storeId, pageSize, pageToken }, context) {
      libraryStoreIdSchema.parse(storeId);
      const all = catalog.listPages(context, true).filter((page) => page.kind === "document" && page.storeId === storeId);
      const start = pageToken === undefined ? 0 : Number(pageToken);
      if (!Number.isSafeInteger(start) || start < 0) throw new LibraryContractError("invalid-argument", "Invalid document page token.");
      const slice = all.slice(start, start + pageSize);
      return start + pageSize < all.length ? { pages: slice, nextPageToken: String(start + pageSize) } : { pages: slice };
    },
  });
  const producer = createNativeProducer({
    catalog, content, nodeOrigin,
    ...(options.randomUUID === undefined ? {} : { randomUUID: options.randomUUID }),
  });
  let mainPrincipal: { readonly accountId: string; readonly principalId: string; readonly credential: string } | null = null;
  const registration = createLibraryMcpRegistration({ catalog });
  const unregisterHook = registerLibraryMcpResultHook(registration.hook);
  const invalidate = (): void => { pages.invalidateAll(); index.invalidateAll(); };
  const unsubscribeIdentity = catalog.identity.onChange(invalidate);
  let dataVersion = catalog.identity.dataVersion();
  const withCredential = (credential: string, signal: AbortSignal): LibraryRequestContext => {
    const current = catalog.identity.dataVersion();
    if (current !== dataVersion) { invalidate(); dataVersion = current; }
    return catalog.identity.resolveCredential(credential, signal);
  };
  const identityFile = join(dataRoot, "library", "host-identity.json");
  const ensureProvisioned = (): string => {
    if (mainPrincipal !== null) return mainPrincipal.credential;
    try {
      const saved = JSON.parse(readFileSync(identityFile, "utf8")) as { accountId?: unknown; principalId?: unknown; credential?: unknown };
      if (typeof saved.credential === "string" && saved.credential.length > 0) {
        const context = catalog.identity.resolveCredential(saved.credential, AbortSignal.timeout(5000));
        catalog.identity.requireOwner(context, MAIN_STORE);
        mainPrincipal = { accountId: context.principal.accountId, principalId: context.principal.principalId, credential: saved.credential };
        return saved.credential;
      }
      throw new LibraryContractError("rejected", "Invalid persisted main identity");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const created = catalog.identity.createLocalPrincipal(MAIN_ACCOUNT);
    catalog.identity.registerStore({ accountId: created.accountId, principalId: created.principalId, storeId: MAIN_STORE, teamId: null });
    mainPrincipal = created;
    mkdirSync(dirname(identityFile), { recursive: true });
    writeFileSync(identityFile, JSON.stringify({ accountId: created.accountId, principalId: created.principalId, credential: created.credential }), { mode: 0o600 });
    return created.credential;
  };
  async function requireAgent(context: LibraryRequestContext, agentId: string): Promise<void> {
    catalog.identity.authenticate(context);
    if (mainPrincipal !== null && context.principal.accountId === mainPrincipal.accountId && context.principal.principalId === mainPrincipal.principalId &&
        (await options.transcript?.listAgentIds?.())?.includes(agentId)) return;
    catalog.identity.requireAgent(context, agentId);
  }
  const enrollTrustedAgent = (agentId: string): boolean => {
    if (mainPrincipal === null) return false;
    const ids = options.transcript?.listAgentIds?.();
    if (!Array.isArray(ids) || !ids.includes(agentId)) return false;
    catalog.identity.assignAgent({ ...mainPrincipal, agentId }, true);
    return true;
  };
  const enrollTrustedAgents = async (signal: AbortSignal): Promise<readonly string[]> => {
    const context = withCredential(ensureProvisioned(), signal);
    const ids = await options.transcript?.listAgentIds?.() ?? [];
    for (const agentId of ids) {
      catalog.identity.authenticate(context);
      catalog.identity.assignAgent({ ...context.principal, agentId }, true);
    }
    return ids;
  };
  const publicArgs = <T extends { credential?: string }>(args: T): Omit<T, "credential"> => {
    const { credential: _credential, ...rest } = args;
    return rest;
  };
  const executionFor = (credential: string, agentId: string, storeId: string, toolCallId: string, idempotencyKey: string, signal: AbortSignal) => {
    const context = withCredential(credential, signal);
    return {
      context,
      execution: {
        agentId, storeId, toolCallId, idempotencyKey,
        principal: context.principal,
        providerOrigin: context.providerOrigin,
        signal: context.signal,
      },
    };
  };
  const service = {
    catalog,
    nodeOrigin,
    dataRoot,
    mainCredential(): string { return ensureProvisioned(); },
    getLibraryOrigin(): string { return nodeOrigin; },
    executionBase(args: { readonly agentId: string }, signal: AbortSignal) {
      const credential = ensureProvisioned();
      const context = withCredential(credential, signal);
      enrollTrustedAgent(args.agentId);
      catalog.identity.requireAgent(context, args.agentId);
      return { agentId: args.agentId, storeId: MAIN_STORE, principal: context.principal, providerOrigin: context.providerOrigin, credential };
    },
    async resolveLibraryPages(args: LibraryArgs<"resolveLibraryPages"> & { credential: string }, signal: AbortSignal) {
      const context = withCredential(args.credential, signal);
      const version = dataVersion;
      const result = await pages.resolveRefs(publicArgs(args), context);
      if (catalog.identity.dataVersion() !== version) { invalidate(); throw new LibraryContractError("rejected", "Library authorization changed during read"); }
      return result;
    },
    async listLibraryPages(args: LibraryArgs<"listLibraryPages"> & { credential: string }, signal: AbortSignal) {
      const context = withCredential(args.credential, signal);
      const version = dataVersion;
      const result = await index.list(publicArgs(args), context);
      if (catalog.identity.dataVersion() !== version) { invalidate(); throw new LibraryContractError("rejected", "Library authorization changed during read"); }
      return result;
    },
    async listLibraryDocs(args: LibraryArgs<"listLibraryDocs"> & { credential: string }, signal: AbortSignal) {
      const context = withCredential(args.credential, signal);
      const { agentId } = publicArgs(args);
      await requireAgent(context, agentId);
      return { docs: catalog.external.list(context, agentId), listedAtMs: Date.now() };
    },
    async getDocument(args: LibraryArgs<"getDocument"> & { credential: string }, signal: AbortSignal) {
      return documents.getDocument(publicArgs(args), withCredential(args.credential, signal));
    },
    async getDocumentEditRight(args: LibraryArgs<"getDocumentEditRight"> & { credential: string }, signal: AbortSignal) {
      return documents.getDocumentEditRight(publicArgs(args), withCredential(args.credential, signal));
    },
    async saveDocument(args: LibraryArgs<"saveDocument"> & { credential: string }, signal: AbortSignal) {
      const context = withCredential(args.credential, signal);
      const saved = await documents.saveDocument(publicArgs(args), context);
      invalidate();
      return saved;
    },
    async setDocumentVisibility(args: LibraryArgs<"setDocumentVisibility"> & { credential: string }, signal: AbortSignal) {
      const context = withCredential(args.credential, signal);
      const updated = await documents.setDocumentVisibility(publicArgs(args), context);
      invalidate();
      return updated;
    },
    async getDocumentAssets(args: LibraryArgs<"getDocumentAssets"> & { credential: string }, signal: AbortSignal) {
      return assets.getDocumentAssets(publicArgs(args), withCredential(args.credential, signal));
    },
    async getCanvasShare(args: LibraryArgs<"getCanvasShare"> & { credential: string }, signal: AbortSignal) {
      return canvas.getCanvasShare(publicArgs(args), withCredential(args.credential, signal));
    },
    async setCanvasVisibility(args: LibraryArgs<"setCanvasVisibility"> & { credential: string }, signal: AbortSignal) {
      const context = withCredential(args.credential, signal);
      const updated = await canvas.setCanvasVisibility(publicArgs(args), context);
      invalidate();
      return updated;
    },
    async getCanvasPayload(args: { locator: { kind: "store"; storeId: string; canvasId: string } | { kind: "active-user-store"; canvasId: string }; groupChatId?: string; credential: string }, signal: AbortSignal) {
      return canvas.getCanvasPayload(publicArgs(args), withCredential(args.credential, signal));
    },
    async publishNativeArtifact(args: { input: Parameters<ReturnType<typeof createNativeProducer>["publishNativeArtifact"]>[0]; execution: { agentId: string; storeId: string; toolCallId: string; idempotencyKey: string; credential: string } }, signal: AbortSignal) {
      const { credential, agentId, storeId, toolCallId, idempotencyKey } = args.execution;
      const { context, execution } = executionFor(credential, agentId, storeId, toolCallId, idempotencyKey, signal);
      await requireAgent(context, agentId);
      catalog.identity.assignAgent({ ...context.principal, agentId }, true);
      const published = await producer.publishNativeArtifact(args.input, execution);
      invalidate();
      return published;
    },
    confirmPublished(args: { execution: { agentId: string; storeId: string; toolCallId: string; idempotencyKey: string; credential: string }; eventId: string; messageId: string; publishedAtMs: number }, signal: AbortSignal) {
      const { execution } = executionFor(args.execution.credential, args.execution.agentId, args.execution.storeId, args.execution.toolCallId, args.execution.idempotencyKey, signal);
      producer.confirmPublished(execution, args);
    },
    pendingPublications(args: { credential: string; agentId: string; storeId: string }, signal: AbortSignal) {
      try {
        enrollTrustedAgent(args.agentId);
        const { execution } = executionFor(args.credential, args.agentId, args.storeId, "pending-read", "pending-read", signal);
        return producer.pendingPublications(execution);
      } catch (error) {
        if (error instanceof LibraryCatalogError && error.code === "denied") return [];
        throw error;
      }
    },
    acknowledgePublishedLinks(args: { credential: string; agentId: string; storeId: string; messageId: string; content: string; publishedAtMs: number }, signal: AbortSignal): readonly string[] {
      const pending = service.pendingPublications(args, signal);
      const acked: string[] = [];
      for (const item of pending) {
        if (!args.content.includes(item.event.url)) continue;
        service.confirmPublished({ execution: { credential: args.credential, agentId: args.agentId, storeId: args.storeId, toolCallId: item.event.toolCallId, idempotencyKey: item.idempotencyKey }, eventId: item.event.eventId, messageId: args.messageId, publishedAtMs: args.publishedAtMs }, signal);
        acked.push(item.event.eventId);
      }
      return acked;
    },
    async runMcpExecution<T>(args: { credential: string; agentId: string; storeId: string; toolCallId: string; connectorAccount: string }, signal: AbortSignal, work: () => T): Promise<T> {
      const context = withCredential(args.credential, signal);
      await requireAgent(context, args.agentId);
      catalog.identity.assignAgent({ ...context.principal, agentId: args.agentId }, true);
      catalog.identity.requireOwner(context, args.storeId);
      return runWithLibraryMcpExecution({ ...context, agentId: args.agentId, storeId: args.storeId, toolCallId: args.toolCallId, idempotencyKey: `mcp:${args.toolCallId}`, connectorAccount: args.connectorAccount }, work);
    },
    enrollTrustedAgents,
    dispose(): void { unregisterHook(); unsubscribeIdentity(); invalidate(); catalog.close(); },
    async readTranscriptEntries(args: { agentId: unknown; cursor?: unknown; limit?: unknown; credential: string }, signal: AbortSignal): Promise<unknown> {
      const agentId = typeof args.agentId === "string" && args.agentId.length > 0 ? args.agentId : null;
      if (agentId === null) throw new LibraryContractError("invalid-argument", "Library transcript requires an agent id.");
      const context = withCredential(args.credential, signal);
      await requireAgent(context, agentId);
      if (options.transcript === undefined) throw new LibraryContractError("invalid-argument", "Library transcript reads are unavailable.");
      const limit = typeof args.limit === "number" && Number.isSafeInteger(args.limit) ? Math.min(200, Math.max(1, args.limit)) : 100;
      const query = args.cursor === undefined
        ? { limit }
        : { limit, beforeSeq: typeof args.cursor === "number" && Number.isSafeInteger(args.cursor) ? args.cursor : undefined };
      return options.transcript.getAgentTranscriptPage(agentId, query);
    },
  };
  function toLibraryPage(object: { storeId: string; kind: "document" | "canvas"; objectId: string; title: string; createdAtMs: number | null; updatedAtMs: number | null; visibility: "private" | "team-view" }, context: LibraryRequestContext): LibraryPage {
    const visibility = object.visibility === "private" ? "private" : "team";
    const base = { title: object.title, createdAtMs: object.createdAtMs, updatedAtMs: object.updatedAtMs, visibility, canShareToTeam: catalog.canShareToTeam(context, object.storeId) } as const;
    return object.kind === "document"
      ? { kind: "document", storeId: object.storeId, documentId: object.objectId, ...base }
      : { kind: "canvas", storeId: object.storeId, canvasId: object.objectId, ...base };
  }
  function canvasShareJson(object: { storeId: string; visibility: "private" | "team-view" }, context: LibraryRequestContext): { visibility: "CANVAS_VISIBILITY_PRIVATE" | "CANVAS_VISIBILITY_TEAM_VIEW"; canShareToTeam: boolean } | null {
    try {
      const canShareToTeam = catalog.canShareToTeam(context, object.storeId);
      const visibility = object.visibility === "private" ? "CANVAS_VISIBILITY_PRIVATE" : "CANVAS_VISIBILITY_TEAM_VIEW";
      return { visibility, canShareToTeam };
    } catch { return null; }
  }
  return new Proxy(service, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        try {
          const result: unknown = Reflect.apply(value, target, args);
          return result instanceof Promise ? result.catch(boundaryError) : result;
        } catch (error) { return boundaryError(error); }
      };
    },
  });
}
function boundaryError(error: unknown): never {
  if (error instanceof LibraryContractError) throw error;
  if (error instanceof ZodError) throw new LibraryContractError("invalid-argument", "Invalid Library request");
  if (error instanceof LibraryCatalogError) {
    throw new LibraryContractError(error.code === "denied" ? "read-only" : error.code === "invalid" ? "invalid-argument" : "rejected", error.message);
  }
  throw error;
}
export type LibraryHostService = ReturnType<typeof createLibraryHostService>;
export const libraryExtension = defineHostExtension({
  id: HostExtensions.Library,
  dependencies: [HostExtensions.Transcript],
  start: async (context) => {
    const deps = context.deps as { transcript: { getAgentTranscriptPage(agentId: string, query: unknown): unknown; listAgentIds?(): readonly string[] | Promise<readonly string[]> } };
    const transcript = deps.transcript;
    const service = createLibraryHostService({ transcript });
    let receiver: LibraryHttpHandle | undefined;
    try {
      service.mainCredential();
      await service.enrollTrustedAgents(AbortSignal.timeout(5000));
      const config = resolveLibraryHttpConfigFromEnv(service.nodeOrigin);
      if (config !== null) receiver = await startLibraryHttpServer({ ...config, service });
    } catch (error) {
      service.dispose();
      throw error;
    }
    context.onStop(async () => {
      try { await receiver?.close(); }
      finally { service.dispose(); }
    });
    return {
      ...service,
      async getLibraryTranscript(args: { agentId: unknown; cursor?: unknown; limit?: unknown; credential: string }, signal: AbortSignal) {
        return service.readTranscriptEntries(args, signal);
      },
    };
  },
});
