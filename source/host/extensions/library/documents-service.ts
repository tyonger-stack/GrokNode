/**
 * Authoritative native document entity service (plan task 4, documents lane).
 *
 * Evidence anchors, original Grok Bot 0.68.1 electron-main/main-app.cjs
 * (artifacts/rea-library-2026-10-11-0681): k1e@1843877 builds the documents service.
 * getDocument reads "documents/<documentId>/source.md" (PYt="documents", EJt="source.md")
 * through readAgentStoreFile and returns share from documentOwnerView (UYt/I1e); the
 * group fallback (readGrokBotGroupChatDocument) runs ONLY when the caller passed
 * groupChatId AND the ordinary read came back absent, and then returns share:null with
 * groupChatId echoed. getDocumentEditRight is eQ@1842040: a USER-store ownership check
 * with an account-scope-keyed in-flight cache that keeps only true results and discards
 * late results whose account scope changed mid-flight. saveDocument returns the persisted
 * title and v1e maps PermissionDenied/Unauthenticated to
 * DocumentReadOnlyError("Only the document's owner can edit it."), NotFound to
 * DocumentNotFoundError("Document <id> was not found."), InvalidArgument to
 * DocumentRejectedError. setDocumentVisibility validates the echoed visibility and throws
 * DocumentVisibilityEchoError("Document visibility echo was not recognized.") on an
 * unknown echo. Title rule is L1e: first nonempty trimmed line; when it starts with "# "
 * the trimmed remainder is the title, otherwise null.
 *
 * Node design (not a claim about the original physical layout): content lives under the
 * catalog data root at stores/<encodedStoreId>/documents/<documentId>/source.md, written
 * atomically behind the agent-store-sync path guards, and authority comes only from the
 * persisted catalog identity in LibraryRequestContext. Renderer-supplied agent ids or
 * paths are never authorization.
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type {
  DocumentEditRight, DocumentLocator, DocumentRead, DocumentSave, LibraryArgs,
  LibraryRequestContext, LibraryWriteVisibility,
} from "../../../shared/library-contracts.js";
import { documentIdSchema, libraryArgsSchemas, libraryStoreIdSchema } from "../../../shared/library/schemas.js";
import {
  DocumentNotFoundError, DocumentReadOnlyError, DocumentRejectedError, DocumentVisibilityEchoError,
} from "../../../shared/library/errors.js";
import { assertNoSymlinkInPath, ensureSecureDirectoryChain } from "../../../packages/agent-store-sync/paths.js";
import type { CatalogObject, CatalogObjectKey, LibraryCatalog } from "./catalog.js";
import { LibraryCatalogError } from "./migrations.js";
import { objectKeySchema } from "./catalog/objects.js";

export {
  DocumentNotFoundError, DocumentReadOnlyError, DocumentRejectedError, DocumentVisibilityEchoError,
} from "../../../shared/library/errors.js";

const titleLimit = 16_384; // mirrors the catalog objectSchema title bound (catalog/objects.ts)
const notFoundMessage = (documentId: string): string => `Document ${documentId} was not found.`;
const readOnlyMessage = "Only the document's owner can edit it.";
const echoMessage = "Document visibility echo was not recognized.";

export type GroupChatDocumentRead = { readonly source: string };

export type DocumentsServiceOptions = {
  readonly dataRoot: string;
  readonly catalog: LibraryCatalog;
  /** Trusted host account scope (eQ getAccountScope parity); undefined disables the edit-right cache. */
  readonly getAccountScope?: () => string | undefined;
  /** Trusted group-chat port; consulted only when the caller passed groupChatId and the catalog read is absent. */
  readonly readGroupChatDocument?: (
    args: { readonly locator: DocumentLocator; readonly groupChatId: string },
    context: LibraryRequestContext,
  ) => Promise<GroupChatDocumentRead | null>;
  /** Async seam for ownership reads (original eQ read stores over RPC); defaults to the persisted catalog identity. */
  readonly readStoreOwnership?: (storeId: string, context: LibraryRequestContext) => Promise<boolean>;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
};

export interface DocumentsService {
  getDocument(args: LibraryArgs<"getDocument">, context: LibraryRequestContext): Promise<DocumentRead>;
  getDocumentEditRight(args: LibraryArgs<"getDocumentEditRight">, context: LibraryRequestContext): Promise<DocumentEditRight>;
  saveDocument(args: LibraryArgs<"saveDocument">, context: LibraryRequestContext): Promise<DocumentSave>;
  setDocumentVisibility(args: LibraryArgs<"setDocumentVisibility">, context: LibraryRequestContext): Promise<LibraryWriteVisibility>;
}

/** Canonical Node layout for the original logical key documents/<documentId>/source.md. */
export function documentSourcePath(storeId: string, documentId: string): string {
  libraryStoreIdSchema.parse(storeId);
  documentIdSchema.parse(documentId);
  return `stores/${encodeURIComponent(storeId)}/documents/${encodeURIComponent(documentId)}/source.md`;
}

/** Original L1e: the first nonempty trimmed line decides; a "# " heading yields its trimmed text, anything else null. */
export function deriveDocumentTitle(source: string): string | null {
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length !== 0) return (trimmed.startsWith("# ") && trimmed.slice(2).trim()) || null;
  }
  return null;
}

function assertPrivateDirectory(directory: string): void {
  assertNoSymlinkInPath(directory);
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new LibraryCatalogError("path", "Library path must be private and owned by this process user");
  }
}

function resolveContentFile(root: string, contentPath: string): string {
  const file = resolve(root, contentPath);
  if (!file.startsWith(root + sep) || contentPath.startsWith(sep) || contentPath.includes("\0")) {
    throw new LibraryCatalogError("path", "Invalid content location");
  }
  return file;
}

function readContentFile(root: string, contentPath: string): Uint8Array {
  const file = resolveContentFile(root, contentPath);
  assertNoSymlinkInPath(file);
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) {
      throw new LibraryCatalogError("path", "Unsafe content file");
    }
    return new Uint8Array(readFileSync(descriptor));
  } finally { closeSync(descriptor); }
}

function readVerifiedSource(root: string, object: CatalogObject): string {
  const bytes = readContentFile(root, object.contentPath);
  if (createHash("sha256").update(bytes).digest("hex") !== object.contentHash) {
    throw new LibraryCatalogError("invalid", "Content hash mismatch");
  }
  return Buffer.from(bytes).toString("utf8");
}

function atomicWriteContent(root: string, contentPath: string, bytes: Uint8Array, nonceValue: string): void {
  const file = resolveContentFile(root, contentPath);
  const directory = dirname(file);
  ensureSecureDirectoryChain(directory);
  assertPrivateDirectory(directory);
  assertNoSymlinkInPath(file);
  const temporary = join(directory, `.${basename(file)}.tmp-${nonceValue}`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    let offset = 0;
    while (offset < bytes.byteLength) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
    const directoryDescriptor = openSync(directory, constants.O_RDONLY);
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch { /* the temporary name is already gone after the rename */ }
  }
}

function withDocumentLock<T>(locks: Map<string, Promise<unknown>>, locator: DocumentLocator, work: () => Promise<T>): Promise<T> {
  const key = `${locator.storeId}\n${locator.documentId}`;
  const prior = locks.get(key);
  const next = (prior === undefined ? Promise.resolve() : prior.catch(() => undefined)).then(work);
  const tracked: Promise<T> = next.finally(() => { if (locks.get(key) === tracked) locks.delete(key); });
  locks.set(key, tracked);
  return tracked;
}

export function createDocumentsService(options: DocumentsServiceOptions): DocumentsService {
  const dataRoot = resolve(options.dataRoot);
  const { catalog } = options;
  const now = options.now ?? (() => Date.now());
  const nonce = options.randomUUID ?? randomUUID;
  const editRights = new Map<string, Promise<boolean>>();
  const locks = new Map<string, Promise<unknown>>();

  const currentScope = (context: LibraryRequestContext): string | undefined =>
    options.getAccountScope === undefined
      ? JSON.stringify([context.providerOrigin, context.principal.accountId])
      : options.getAccountScope();

  const ownsStore = (storeId: string, context: LibraryRequestContext): boolean => {
    try { catalog.identity.requireOwner(context, storeId); return true; }
    catch (error) {
      if (error instanceof LibraryCatalogError && error.code === "denied") return false;
      throw error;
    }
  };
  const readStoreOwnership = options.readStoreOwnership ??
    (async (storeId: string, context: LibraryRequestContext) => ownsStore(storeId, context));

  /** eQ parity: cache per account scope + principal + store; only true sticks; a late scope change discards the result. */
  const storeEditRight = (storeId: string, context: LibraryRequestContext): Promise<boolean> => {
    const scope = currentScope(context);
    if (scope === undefined) return readStoreOwnership(storeId, context);
    const key = `${scope}\n${context.principal.principalId}\n${storeId}`;
    const inflight = editRights.get(key);
    if (inflight !== undefined) return inflight;
    const promise = (async () => {
      try {
        const canEdit = await readStoreOwnership(storeId, context) && currentScope(context) === scope;
        if (!canEdit) editRights.delete(key);
        return canEdit;
      } catch (error) { editRights.delete(key); throw error; }
    })();
    editRights.set(key, promise);
    return promise;
  };

  const documentKey = (locator: DocumentLocator): CatalogObjectKey | null => {
    const key = { storeId: locator.storeId, kind: "document" as const, objectId: locator.documentId };
    return objectKeySchema.safeParse(key).success ? key : null;
  };

  const readAuthorized = (context: LibraryRequestContext, locator: DocumentLocator): CatalogObject | null => {
    const key = documentKey(locator);
    return key === null ? null : catalog.readObject(context, key);
  };

  const storeExists = (storeId: string): boolean => {
    try { catalog.identity.owner(storeId); return true; }
    catch (error) {
      if (error instanceof LibraryCatalogError && error.code === "denied") return false;
      throw error;
    }
  };

  const requireOwnedObject = (context: LibraryRequestContext, locator: DocumentLocator): CatalogObject => {
    try { catalog.identity.requireOwner(context, locator.storeId); }
    catch (error) {
      if (!(error instanceof LibraryCatalogError) || error.code !== "denied") throw error;
      throw storeExists(locator.storeId) ? new DocumentReadOnlyError(readOnlyMessage) : new DocumentNotFoundError(notFoundMessage(locator.documentId));
    }
    const object = readAuthorized(context, locator);
    if (object === null) throw new DocumentNotFoundError(notFoundMessage(locator.documentId));
    return object;
  };

  const translateDenied = (error: unknown): unknown =>
    error instanceof LibraryCatalogError && error.code === "denied" ? new DocumentReadOnlyError(readOnlyMessage) : error;

  const restoreAfterFailedCommit = (object: CatalogObject, previous: Uint8Array, writtenHash: string): void => {
    try {
      const current = readContentFile(dataRoot, object.contentPath);
      // Another writer may have committed newer bytes; only our own unwritten-bytes state gets restored.
      if (createHash("sha256").update(current).digest("hex") !== writtenHash) return;
      atomicWriteContent(dataRoot, object.contentPath, previous, nonce());
    } catch { /* the catalog stays authoritative; the original commit failure is what gets reported */ }
  };

  return {
    async getDocument(args, context) {
      context.signal.throwIfAborted();
      const { locator, groupChatId } = libraryArgsSchemas.getDocument.parse(args);
      const object = readAuthorized(context, locator);
      if (object !== null) {
        const source = readVerifiedSource(dataRoot, object);
        const share = { visibility: object.visibility, canShareToTeam: catalog.canShareToTeam(context, locator.storeId) };
        context.signal.throwIfAborted();
        return { locator, source, share };
      }
      const readGroupChatDocument = options.readGroupChatDocument;
      if (groupChatId !== undefined && readGroupChatDocument !== undefined) {
        const fallback = await readGroupChatDocument({ locator, groupChatId }, context);
        context.signal.throwIfAborted();
        if (fallback !== null) return { locator, source: fallback.source, share: null, groupChatId };
      }
      throw new DocumentNotFoundError(notFoundMessage(locator.documentId));
    },
    async getDocumentEditRight(args, context) {
      context.signal.throwIfAborted();
      const { locator } = libraryArgsSchemas.getDocumentEditRight.parse(args);
      return { locator, canEdit: await storeEditRight(locator.storeId, context) };
    },
    async saveDocument(args, context) {
      context.signal.throwIfAborted();
      const { locator, source } = libraryArgsSchemas.saveDocument.parse(args);
      return withDocumentLock(locks, locator, async () => {
        const existing = requireOwnedObject(context, locator);
        const title = deriveDocumentTitle(source) ?? existing.title;
        if (title.length > titleLimit) throw new DocumentRejectedError(`Document title must be at most ${titleLimit} characters.`);
        const previous = readContentFile(dataRoot, existing.contentPath);
        const bytes = Buffer.from(source, "utf8");
        const contentHash = createHash("sha256").update(bytes).digest("hex");
        atomicWriteContent(dataRoot, existing.contentPath, bytes, nonce());
        const updated: CatalogObject = {
          ...existing, title, contentHash,
          updatedAtMs: Math.max(existing.updatedAtMs ?? 0, now()),
          revision: existing.revision + 1,
        };
        try { catalog.upsertObject(context, updated); }
        catch (error) {
          restoreAfterFailedCommit(existing, previous, contentHash);
          throw translateDenied(error);
        }
        return { locator, title: updated.title };
      });
    },
    async setDocumentVisibility(args, context) {
      context.signal.throwIfAborted();
      const { locator, visibility } = libraryArgsSchemas.setDocumentVisibility.parse(args);
      return withDocumentLock(locks, locator, async () => {
        const existing = requireOwnedObject(context, locator);
        const key: CatalogObjectKey = { storeId: existing.storeId, kind: "document", objectId: existing.objectId };
        let persisted: CatalogObject;
        try { persisted = catalog.setVisibility(context, key, visibility); }
        catch (error) { throw translateDenied(error); }
        const echo: string = persisted.visibility;
        if (echo !== visibility) throw new DocumentVisibilityEchoError(echoMessage);
        return persisted.visibility;
      });
    },
  };
}
