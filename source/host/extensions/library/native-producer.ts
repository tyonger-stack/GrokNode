import { randomUUID } from "node:crypto";
import type {
  LibraryExecutionContext,
  NativePublishEvent,
  NativePublishResult,
  NativePublishInput,
} from "../../../shared/library-contracts.js";
import { buildLibraryLink } from "../../../shared/library/links.js";
import { LibraryCatalogError } from "./migrations.js";
import type { LibraryCatalog } from "./catalog.js";
import type { CatalogObject } from "./catalog/objects.js";

/**
 * Task 13b: the single trusted native-production boundary (Node design).
 * The tool layer supplies content only; owner, store, object ids and the
 * idempotency key always come from the injected execution context.
 * Content is written before the catalog/outbox commit; a repeated
 * idempotency key returns the earlier event without creating again.
 * Transcript publication is confirmed separately; a crash replays only
 * unconfirmed events, never recreating objects or remote mutations.
 */
export interface NativeContentStore {
  writeDocumentContent(execution: LibraryExecutionContext, input: { source: string; assets: readonly { name: string; bytes: Uint8Array }[] }): Promise<{ object: CatalogObject; title: string }>;
  writeCanvasPayload(execution: LibraryExecutionContext, input: { title: string; renderBundleGzip: Uint8Array; dataJson: Uint8Array }): Promise<{ object: CatalogObject }>;
}
export interface NativeProducerPorts {
  readonly catalog: Pick<LibraryCatalog, "outbox" | "commitNative">;
  readonly content: NativeContentStore;
  readonly nodeOrigin: string;
  readonly randomUUID?: () => string;
}
export function createNativeProducer(ports: NativeProducerPorts) {
  const uuid = ports.randomUUID ?? randomUUID;
  return {
    async publishNativeArtifact(input: NativePublishInput, execution: LibraryExecutionContext): Promise<NativePublishResult> {
      execution.signal.throwIfAborted();
      const replay = ports.catalog.outbox.find(execution);
      if (replay !== null) {
        return { identity: replay.event.identity, url: replay.event.url, title: replay.event.title, eventId: replay.event.eventId };
      }
      const written = input.kind === "document"
        ? await ports.content.writeDocumentContent(execution, input)
        : await ports.content.writeCanvasPayload(execution, input);
      const identity = { providerOrigin: ports.nodeOrigin, ref: written.object.kind === "document"
        ? { kind: "document" as const, storeId: written.object.storeId, documentId: written.object.objectId }
        : { kind: "canvas" as const, storeId: written.object.storeId, canvasId: written.object.objectId } };
      const event: NativePublishEvent = {
        eventId: uuid(),
        agentId: execution.agentId,
        toolCallId: execution.toolCallId,
        identity,
        url: buildLibraryLink(identity, { nodeOrigin: ports.nodeOrigin }),
        title: written.object.title,
      };
      const committed = ports.catalog.commitNative(execution, { object: written.object, event });
      return { identity: committed.event.identity, url: committed.event.url, title: committed.event.title, eventId: committed.event.eventId };
    },
    confirmPublished(execution: LibraryExecutionContext, receipt: { eventId: string; messageId: string; publishedAtMs: number }): void {
      ports.catalog.outbox.ack(execution, receipt);
    },
    pendingPublications(execution: LibraryExecutionContext) {
      return ports.catalog.outbox.pending(execution);
    },
  };
}
export type NativeProducer = ReturnType<typeof createNativeProducer>;
