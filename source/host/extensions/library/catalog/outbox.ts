import type { DatabaseSync } from "node:sqlite";
import type { LibraryExecutionContext, NativePublishEvent, NativePublishOutbox } from "../../../../shared/library-contracts.js";
import { z } from "zod";
import { CatalogIdentity, identifier } from "../identity.js";
import { LibraryCatalogError } from "../migrations.js";
import type { CatalogObject } from "./objects.js";

const ref = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document"), storeId: identifier, documentId: z.string().uuid() }),
  z.object({ kind: z.literal("canvas"), storeId: identifier, canvasId: z.string().uuid() }),
]);
const eventSchema = z.object({ eventId: identifier, agentId: identifier, toolCallId: identifier,
  identity: z.object({ providerOrigin: z.string().url(), ref }), url: z.string().url(), title: z.string() });

export class CatalogOutbox {
  constructor(private readonly db: DatabaseSync, private readonly identity: CatalogIdentity) {}
  find(context: LibraryExecutionContext): NativePublishOutbox | null {
    this.identity.requireExecution(context);
    const row = this.db.prepare("SELECT event_id FROM outbox WHERE account=? AND principal=? AND agent=? AND idempotency_key=?")
      .get(context.principal.accountId, context.principal.principalId, context.agentId, context.idempotencyKey);
    if (!row) return null;
    const record = this.get(identifier.parse(row.event_id));
    if (record.event.toolCallId !== context.toolCallId || record.owner.storeId !== context.storeId) throw new LibraryCatalogError("denied", "Publication execution identity mismatch");
    return record;
  }
  insert(context: LibraryExecutionContext, object: CatalogObject, input: NativePublishEvent): NativePublishOutbox {
    const event = eventSchema.parse(input);
    const key = event.identity.ref;
    const objectId = key.kind === "document" ? key.documentId : key.canvasId;
    const segment = key.kind === "document" ? "documents" : "canvas";
    const expectedUrl = `${context.providerOrigin}/${segment}/${encodeURIComponent(object.storeId)}/${object.objectId}`;
    if (event.identity.providerOrigin !== context.providerOrigin || event.agentId !== context.agentId || event.toolCallId !== context.toolCallId ||
      key.storeId !== object.storeId || key.kind !== object.kind || objectId !== object.objectId || event.url !== expectedUrl || event.title !== object.title) {
      throw new LibraryCatalogError("invalid", "Publication event does not match committed object");
    }
    this.db.prepare("INSERT INTO outbox(event_id,account,principal,agent,tool_call,idempotency_key,store,kind,object_id,event_json) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(event.eventId, context.principal.accountId, context.principal.principalId, context.agentId, context.toolCallId,
        context.idempotencyKey, object.storeId, object.kind, object.objectId, JSON.stringify(event));
    return this.get(event.eventId);
  }
  private get(eventId: string): NativePublishOutbox {
    const row = this.db.prepare("SELECT * FROM outbox WHERE event_id=?").get(eventId);
    if (!row || typeof row.event_json !== "string") throw new LibraryCatalogError("invalid", "Unknown outbox event");
    const base = { idempotencyKey: identifier.parse(row.idempotency_key), owner: this.identity.owner(identifier.parse(row.store)), event: eventSchema.parse(JSON.parse(row.event_json)) };
    if (row.message_id === null) return { ...base, status: "pending", attempts: z.number().int().nonnegative().parse(row.attempts) };
    return { ...base, status: "published", messageId: identifier.parse(row.message_id), publishedAtMs: z.number().int().nonnegative().parse(row.published_at) };
  }
  pending(context: LibraryExecutionContext): readonly NativePublishOutbox[] {
    this.identity.requireExecution(context);
    return this.db.prepare("SELECT event_id FROM outbox WHERE account=? AND principal=? AND agent=? AND store=? AND message_id IS NULL ORDER BY rowid")
      .all(context.principal.accountId, context.principal.principalId, context.agentId, context.storeId).map(row => this.get(identifier.parse(row.event_id)));
  }
  attempt(context: LibraryExecutionContext, eventId: string): void {
    this.authorize(context, eventId);
    this.db.prepare("UPDATE outbox SET attempts=attempts+1 WHERE event_id=? AND message_id IS NULL").run(eventId);
  }
  ack(context: LibraryExecutionContext, receipt: { readonly eventId: string; readonly messageId: string; readonly publishedAtMs: number }): void {
    const previous = this.authorize(context, receipt.eventId);
    identifier.parse(receipt.messageId); z.number().int().nonnegative().parse(receipt.publishedAtMs);
    if (previous.status === "published" && previous.messageId !== receipt.messageId) throw new LibraryCatalogError("stale", "Publication already confirmed with another message");
    this.db.prepare("UPDATE outbox SET message_id=?,published_at=? WHERE event_id=? AND message_id IS NULL").run(receipt.messageId, receipt.publishedAtMs, receipt.eventId);
  }
  private authorize(context: LibraryExecutionContext, eventId: string): NativePublishOutbox {
    this.identity.requireExecution(context);
    const value = this.get(eventId);
    if (value.owner.accountId !== context.principal.accountId || value.owner.principalId !== context.principal.principalId ||
      value.owner.storeId !== context.storeId || value.event.agentId !== context.agentId) throw new LibraryCatalogError("denied", "Outbox execution mismatch");
    return value;
  }
}
