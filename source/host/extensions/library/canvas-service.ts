import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, linkSync, openSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRetryPolicy, realClock, type RetryPolicy } from "../../../internal/scheduling.js";
import type {
  CanvasLocator,
  CanvasPayload,
  CanvasShare,
  LibraryArgs,
  LibraryExecutionContext,
  LibraryRequestContext,
  LibraryWriteVisibility,
  NativePublishEvent,
  NativePublishInput,
  NativePublishResult,
} from "../../../shared/library-contracts.js";
import { canvasLocatorSchema, libraryArgsSchemas, libraryStoreIdSchema } from "../../../shared/library/schemas.js";
import {
  CanvasPayloadIdentityError,
  CanvasShareIdentityError,
  CanvasStoreUnavailableError,
  CanvasVisibilityEchoError,
  LibraryContractError,
} from "../../../shared/library/errors.js";
import { buildLibraryLink } from "../../../shared/library/links.js";
import type { CatalogObject, LibraryCatalog } from "./catalog.js";
import { assertNoSymlinkInPath, ensureSecureDirectoryChain } from "../../../packages/agent-store-sync/paths.js";
import {
  decodeCanvasContent,
  parseCanvasFrameUrl,
  parseCanvasShareJson,
  parseCanvasVisibilityEcho,
  type CanvasDecodedContent,
} from "./canvas-protocol.js";

export {
  CanvasPayloadIdentityError,
  CanvasShareIdentityError,
  CanvasStoreUnavailableError,
  CanvasVisibilityEchoError,
} from "../../../shared/library/errors.js";

export type AuthorizedCanvasPayload = CanvasPayload & {
  readonly metadata: { readonly storeId: string; readonly canvasId: string } | null;
};
export type AuthorizedCanvasMetadata = {
  readonly storeId: string;
  readonly canvasId: string;
  readonly share: unknown;
};
export interface AuthorizedCanvasPort {
  listUserCanvases(context: LibraryRequestContext): Promise<{ readonly storeId: string | null }>;
  getCanvasPayload(
    args: { readonly storeId: string; readonly canvasId: string },
    context: LibraryRequestContext,
  ): Promise<AuthorizedCanvasPayload>;
  readGroupChatCanvas(
    args: { readonly storeId: string; readonly canvasId: string; readonly groupChatId: string },
    context: LibraryRequestContext,
  ): Promise<CanvasPayload>;
  getCanvasMetadata(
    args: { readonly storeId: string; readonly canvasId: string },
    context: LibraryRequestContext,
  ): Promise<{ readonly metadata: AuthorizedCanvasMetadata | null }>;
  setCanvasVisibility(
    args: { readonly storeId: string; readonly canvasId: string; readonly visibility: LibraryWriteVisibility },
    context: LibraryRequestContext,
  ): Promise<{ readonly visibility: unknown }>;
}
export interface CanvasObjectUnavailable {
  readonly canvasObjectUnavailable: true;
}
export type CanvasFrameRead =
  | { readonly status: 200; readonly content: CanvasDecodedContent }
  | { readonly status: 400 | 404 | 422 | 499 };
export type CanvasServiceOptions = {
  readonly dataRoot: string;
  readonly catalog: LibraryCatalog;
  readonly retry?: RetryPolicy;
  readonly isEnabled?: () => boolean;
  readonly randomUUID?: () => string;
};

export const CANVAS_ACTIVE_USER_STORE_RETRY = {
  name: "canvas-active-user-store-read",
  maxAttempts: 7,
  initialDelayMs: 500,
  maxDelayMs: 2500,
  backoffFactor: 2,
} as const;

export function isCanvasObjectUnavailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "canvasObjectUnavailable" in error &&
    (error as CanvasObjectUnavailable).canvasObjectUnavailable === true;
}

function activeScope(context: LibraryRequestContext): string {
  return JSON.stringify([context.providerOrigin, context.principal.accountId]);
}

type ActiveUserStoreRunner = {
  run<T>(context: LibraryRequestContext, work: (storeId: string) => Promise<T>): Promise<T>;
};

function createActiveUserStoreRunner(port: AuthorizedCanvasPort): ActiveUserStoreRunner {
  let cached: { readonly scope: string; readonly storeId: Promise<string> } | undefined;
  const resolveStore = (context: LibraryRequestContext, scope: string): Promise<string> => {
    if (cached?.scope !== scope) {
      cached = {
        scope,
        storeId: (async () => {
          const response = await port.listUserCanvases(context);
          const store = libraryStoreIdSchema.safeParse(response.storeId ?? "");
          if (!store.success) throw new CanvasStoreUnavailableError("Canvas store resolution returned no store.");
          return store.data;
        })(),
      };
    }
    return cached.storeId;
  };
  return {
    async run<T>(context: LibraryRequestContext, work: (storeId: string) => Promise<T>): Promise<T> {
      const scope = activeScope(context);
      const storeId = resolveStore(context, scope);
      try {
        const resolved = await storeId;
        if (activeScope(context) !== scope) {
          throw new CanvasStoreUnavailableError("The signed-in account changed while its canvas store was being resolved.");
        }
        return await work(resolved);
      } catch (error) {
        if (cached?.storeId === storeId) cached = undefined;
        throw error;
      }
    },
  };
}

function writeCanvasManifest(root: string, canvasId: string, bytes: Uint8Array, nonce: string): void {
  const file = resolve(root, "library", "canvases", canvasId + ".json");
  const directory = dirname(file);
  ensureSecureDirectoryChain(directory);
  assertNoSymlinkInPath(file);
  const temporary = join(directory, "." + canvasId + ".tmp-" + nonce);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    let offset = 0;
    while (offset < bytes.byteLength) offset += writeSync(descriptor, bytes, offset);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporary, file);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch {}
  }
}

export function createCanvasService(port: AuthorizedCanvasPort, options: CanvasServiceOptions) {
  const dataRoot = resolve(options.dataRoot);
  const retry = options.retry ?? createRetryPolicy(realClock, {
    ...CANVAS_ACTIVE_USER_STORE_RETRY,
    shouldRetry: error => error instanceof CanvasStoreUnavailableError,
  });
  const isEnabled = options.isEnabled ?? (() => true);
  const uuid = options.randomUUID ?? randomUUID;
  const activeUserStore = createActiveUserStoreRunner(port);

  const readDirect = async (storeId: string, canvasId: string, context: LibraryRequestContext): Promise<CanvasPayload> => {
    const response = await port.getCanvasPayload({ storeId, canvasId }, context);
    if (response.metadata === null || response.metadata.storeId !== storeId || response.metadata.canvasId !== canvasId) {
      throw new CanvasPayloadIdentityError("Canvas payload returned an invalid identity.");
    }
    return { renderBundleGzip: response.renderBundleGzip, dataJson: response.dataJson ?? new Uint8Array() };
  };

  const readGroup = async (
    storeId: string,
    canvasId: string,
    groupChatId: string,
    context: LibraryRequestContext,
  ): Promise<CanvasPayload> => {
    const response = await port.readGroupChatCanvas({ storeId, canvasId, groupChatId }, context);
    return { renderBundleGzip: response.renderBundleGzip, dataJson: response.dataJson ?? new Uint8Array() };
  };

  const readStoreCanvas = async (
    locator: Extract<CanvasLocator, { kind: "store" }>,
    groupChatId: string | undefined,
    context: LibraryRequestContext,
  ): Promise<CanvasPayload> => {
    try {
      return await readDirect(locator.storeId, locator.canvasId, context);
    } catch (error) {
      if (groupChatId === undefined || !isCanvasObjectUnavailable(error)) throw error;
      try {
        return await readGroup(locator.storeId, locator.canvasId, groupChatId, context);
      } catch (fallbackError) {
        throw isCanvasObjectUnavailable(fallbackError) ? error : fallbackError;
      }
    }
  };

  const withStore = async <T>(
    locator: CanvasLocator,
    context: LibraryRequestContext,
    work: (storeId: string) => Promise<T>,
  ): Promise<T> => {
    switch (locator.kind) {
      case "store": return await work(locator.storeId);
      case "active-user-store": return await activeUserStore.run(context, work);
    }
  };

  const getCanvasPayload = async (
    args: { readonly locator: CanvasLocator; readonly groupChatId?: string },
    context: LibraryRequestContext,
  ): Promise<CanvasPayload> => {
    context.signal.throwIfAborted();
    const locator = canvasLocatorSchema.parse(args.locator);
    if (args.groupChatId !== undefined && (typeof args.groupChatId !== "string" || args.groupChatId.length === 0)) {
      throw new LibraryContractError("invalid-argument", "Canvas group chat id must be a non-empty string.");
    }
    switch (locator.kind) {
      case "store": return await readStoreCanvas(locator, args.groupChatId, context);
      case "active-user-store":
        return await retry.runWithRetry(
          (_attempt, signal) => activeUserStore.run(
            { ...context, signal },
            storeId => readDirect(storeId, locator.canvasId, { ...context, signal }),
          ),
          context.signal,
        );
    }
  };

  return {
    getCanvasPayload,
    async getCanvasShare(args: LibraryArgs<"getCanvasShare">, context: LibraryRequestContext): Promise<CanvasShare> {
      context.signal.throwIfAborted();
      const { locator } = libraryArgsSchemas.getCanvasShare.parse(args);
      return await withStore(locator, context, async storeId => {
        const response = await port.getCanvasMetadata({ storeId, canvasId: locator.canvasId }, context);
        if (response.metadata === null) return { storeId, canvasId: locator.canvasId, share: null };
        if (response.metadata.storeId !== storeId || response.metadata.canvasId !== locator.canvasId) {
          throw new CanvasShareIdentityError("Canvas metadata returned an invalid identity.");
        }
        return { storeId, canvasId: locator.canvasId, share: parseCanvasShareJson(response.metadata.share) };
      });
    },
    async setCanvasVisibility(
      args: LibraryArgs<"setCanvasVisibility">,
      context: LibraryRequestContext,
    ): Promise<LibraryWriteVisibility> {
      context.signal.throwIfAborted();
      const { locator, visibility } = libraryArgsSchemas.setCanvasVisibility.parse(args);
      return await withStore(locator, context, async storeId => {
        const response = await port.setCanvasVisibility({ storeId, canvasId: locator.canvasId, visibility }, context);
        const echo = parseCanvasVisibilityEcho(response.visibility);
        if (echo === null) throw new CanvasVisibilityEchoError("Canvas visibility echo was not recognized.");
        return echo;
      });
    },
    async readCanvasFrame(url: string, context: LibraryRequestContext): Promise<CanvasFrameRead> {
      if (!isEnabled()) return { status: 404 };
      const request = parseCanvasFrameUrl(url);
      if (request === null) return { status: 400 };
      try {
        const payload = await getCanvasPayload({
          locator: request.locator,
          ...(request.groupChatId === undefined ? {} : { groupChatId: request.groupChatId }),
        }, context);
        return await decodeCanvasContent(payload);
      } catch (error) {
        if (context.signal.aborted || (error instanceof Error && error.name === "AbortError")) return { status: 499 };
        return { status: 404 };
      }
    },
    async publishNativeArtifact(
      input: NativePublishInput,
      execution: LibraryExecutionContext,
    ): Promise<NativePublishResult> {
      execution.signal.throwIfAborted();
      if (input.kind !== "canvas" || typeof input.title !== "string" ||
          !(input.renderBundleGzip instanceof Uint8Array) || !(input.dataJson instanceof Uint8Array)) {
        throw new LibraryContractError("invalid-argument", "Canvas publication requires a title, render bundle, and data JSON.");
      }
      const prior = options.catalog.outbox.find(execution);
      if (prior !== null) {
        return {
          identity: prior.event.identity,
          url: prior.event.url,
          title: prior.event.title,
          eventId: prior.event.eventId,
        };
      }
      const canvasId = uuid();
      const manifest = {
        version: 1,
        renderBundleGzip: Buffer.from(input.renderBundleGzip).toString("base64"),
        dataJson: Buffer.from(input.dataJson).toString("base64"),
      };
      const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const relativePath = "library/canvases/" + canvasId + ".json";
      writeCanvasManifest(dataRoot, canvasId, bytes, uuid());
      const object: CatalogObject = {
        storeId: execution.storeId,
        kind: "canvas",
        objectId: canvasId,
        title: input.title,
        createdAtMs: null,
        updatedAtMs: null,
        visibility: "private",
        contentPath: relativePath,
        contentHash,
        revision: 1,
      };
      const identity = {
        providerOrigin: execution.providerOrigin,
        ref: { kind: "canvas" as const, storeId: execution.storeId, canvasId },
      };
      const url = buildLibraryLink(identity, { nodeOrigin: execution.providerOrigin });
      const event: NativePublishEvent = {
        eventId: uuid(),
        agentId: execution.agentId,
        toolCallId: execution.toolCallId,
        identity,
        url,
        title: input.title,
      };
      options.catalog.commitNative(execution, { object, event });
      execution.signal.throwIfAborted();
      return { identity, url, title: input.title, eventId: event.eventId };
    },
  };
}
