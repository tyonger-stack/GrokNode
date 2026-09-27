import {
  MAX_EVENTS_IN_AUTOMATION_WAKE,
  type AutomationRecord,
} from "../../automations/automation.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { errorMessage } from "../../../shared/errors.js";
import type { TranscriptManagerLike } from "./transcript-hub.js";

export const EVENT_FIRE_DEBOUNCE_MS = 750;
export const MAX_QUEUED_EVENT_FIRES_PER_AUTOMATION = 500;
export const MAX_REPORTED_DROPPED_FIRES = 256;
export const WEBHOOK_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60_000;
export const MAX_REMEMBERED_WEBHOOK_IDEMPOTENCY_KEYS = 2048;
export const WEBHOOK_RECEIPT_FILENAME = "webhook-receipts.json";
export const MAX_PERSISTED_WEBHOOK_RECEIPTS = 1000;

type FireOutcome = "ok" | "error" | "interrupted" | undefined;
interface FireItem {
  event: Record<string, unknown>;
  runUuid?: string;
  resolve(outcome: FireOutcome): void;
}
interface FireBatch {
  agentId: string;
  automation: AutomationRecord;
  items: FireItem[];
  debounce: AbortController | null;
  /** Compatibility handle used by manager teardown while debounce is armed. */
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  flushImmediately: boolean;
}
interface WebhookReceiptStore {
  readonly file: string;
  readonly keys: Map<string, number>;
  loaded: Promise<void>;
  writes: Promise<void>;
}
export interface DroppedFire {
  agentId: string;
  trigger: "schedule" | "manual" | "event";
  reason: string;
  scheduledForMs?: number;
  runUuid?: string;
}

export class AutomationEventFires {
  readonly pendingEventFireBatches = new Map<string, FireBatch>();
  readonly reportedDroppedFireUuids = new Set<string>();
  readonly deliveredWebhookIdempotencyKeys = new Map<string, number>();
  private readonly webhookReceiptStores = new Map<string, WebhookReceiptStore>();

  constructor(readonly tm: TranscriptManagerLike) {}

  async enqueueEventAutomationFire(args: {
    agentId: string;
    automation: AutomationRecord;
    event: Record<string, unknown>;
    runUuid?: string;
  }): Promise<FireOutcome> {
    if (!this.tm.execution.canExecute || this.tm.disposed)
      return Promise.resolve(undefined);
    if (args.automation.isEnabled !== true) {
      this.reportFireDropped({
        agentId: args.agentId,
        trigger: "event",
        reason: "routine_paused",
        ...(args.runUuid === undefined ? {} : { runUuid: args.runUuid }),
      });
      return Promise.resolve(undefined);
    }
    const runKey = `${args.agentId}:${args.automation.id}`;
    const idempotencyKey = webhookIdempotencyKeyOf(args.event);
    if (idempotencyKey != null) {
      const key = `${runKey}:${idempotencyKey}`;
      const store = this.webhookReceiptStore(runKey, args.automation);
      await store.loaded;
      if (this.hasDeliveredWebhookIdempotencyKey(key) || this.livePersistedWebhookReceipt(store, idempotencyKey)) {
        return Promise.resolve("ok");
      }
      this.rememberWebhookIdempotencyKey(key);
      this.persistWebhookReceipt(store, idempotencyKey);
    }
    return new Promise((resolve) => {
      let batch = this.pendingEventFireBatches.get(runKey);
      if (batch == null) {
        batch = {
          agentId: args.agentId,
          automation: args.automation,
          items: [],
          debounce: null,
          timer: null,
          flushing: false,
          flushImmediately: false,
        };
        this.pendingEventFireBatches.set(runKey, batch);
      }
      batch.automation = args.automation;
      batch.items.push({
        event: args.event,
        ...(args.runUuid === undefined ? {} : { runUuid: args.runUuid }),
        resolve,
      });
      this.shedOverflowingEventFires(runKey);
      this.scheduleEventBatchFlush(runKey);
    });
  }

  shedOverflowingEventFires(runKey: string): void {
    const batch = this.pendingEventFireBatches.get(runKey);
    if (batch == null) return;
    const excess = batch.items.length - MAX_QUEUED_EVENT_FIRES_PER_AUTOMATION;
    if (excess <= 0) return;
    for (const item of batch.items.splice(0, excess)) {
      this.reportFireDropped({
        agentId: batch.agentId,
        trigger: "event",
        reason: "event_batch_overflow",
        ...(item.runUuid === undefined ? {} : { runUuid: item.runUuid }),
      });
      item.resolve("error");
    }
  }

  scheduleEventBatchFlush(runKey: string): void {
    const batch = this.pendingEventFireBatches.get(runKey);
    if (
      batch == null ||
      batch.items.length === 0 ||
      batch.flushing ||
      batch.debounce != null
    )
      return;
    const debounce = new AbortController();
    batch.debounce = debounce;
    const waitMs = batch.flushImmediately ? 0 : EVENT_FIRE_DEBOUNCE_MS;
    batch.flushImmediately = false;
    batch.timer = setTimeout(() => {
      batch.timer = null;
      batch.debounce = null;
      if (!debounce.signal.aborted) void this.flushEventBatch(runKey);
    }, waitMs);
  }

  async flushEventBatch(runKey: string): Promise<void> {
    const batch = this.pendingEventFireBatches.get(runKey);
    if (
      batch == null ||
      batch.items.length === 0 ||
      batch.flushing ||
      this.tm.disposed
    )
      return;
    batch.flushing = true;
    const items = batch.items.splice(0, MAX_EVENTS_IN_AUTOMATION_WAKE);
    const fireUuids = items.flatMap((item) =>
      item.runUuid === undefined ? [] : [item.runUuid],
    );
    let outcome: FireOutcome;
    try {
      outcome = (await this.tm.automationRuntime.fireAutomation({
        agentId: batch.agentId,
        automation: batch.automation,
        trigger: "event",
        events: items.map((item) => item.event),
        ...(fireUuids[0] === undefined ? {} : { runUuid: fireUuids[0] }),
        coalescedRunUuids: fireUuids.slice(1),
      })) as FireOutcome;
    } catch (error) {
      console.error(
        `[sand:automation] event wake dispatch failed for "${batch.automation.name}" (${batch.automation.id}): ${errorMessage(error)}`,
      );
    } finally {
      for (const item of items) item.resolve(outcome);
      batch.flushing = false;
      if (batch.items.length > 0) {
        batch.flushImmediately = true;
        this.scheduleEventBatchFlush(runKey);
      } else {
        this.pendingEventFireBatches.delete(runKey);
      }
    }
  }

  reportFireDropped(args: DroppedFire): void {
    if (args.runUuid !== undefined) {
      if (this.reportedDroppedFireUuids.has(args.runUuid)) return;
      this.reportedDroppedFireUuids.add(args.runUuid);
      while (this.reportedDroppedFireUuids.size > MAX_REPORTED_DROPPED_FIRES) {
        const oldest = this.reportedDroppedFireUuids.values().next().value as
          string | undefined;
        if (oldest === undefined) break;
        this.reportedDroppedFireUuids.delete(oldest);
      }
    }
    this.tm.telemetry.reportAutomationFireDropped({
      conversationId: args.agentId,
      trigger: args.trigger,
      reason: args.reason,
      ...(args.scheduledForMs == null
        ? {}
        : {
            scheduledForMs: args.scheduledForMs,
            latenessMs: Math.max(0, Date.now() - args.scheduledForMs),
          }),
    });
  }

  private hasDeliveredWebhookIdempotencyKey(key: string): boolean {
    const expiresAt = this.deliveredWebhookIdempotencyKeys.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt > Date.now()) return true;
    this.deliveredWebhookIdempotencyKeys.delete(key);
    return false;
  }

  private rememberWebhookIdempotencyKey(key: string): void {
    const now = Date.now();
    for (const [remembered, expiresAt] of this.deliveredWebhookIdempotencyKeys)
      if (expiresAt <= now) this.deliveredWebhookIdempotencyKeys.delete(remembered);
    this.deliveredWebhookIdempotencyKeys.set(key, now + WEBHOOK_IDEMPOTENCY_TTL_MS);
    while (this.deliveredWebhookIdempotencyKeys.size > MAX_REMEMBERED_WEBHOOK_IDEMPOTENCY_KEYS) {
      const oldest = this.deliveredWebhookIdempotencyKeys.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.deliveredWebhookIdempotencyKeys.delete(oldest);
    }
  }

  private webhookReceiptStore(runKey: string, automation: AutomationRecord): WebhookReceiptStore {
    let store = this.webhookReceiptStores.get(runKey);
    if (store == null) {
      store = {
        file: join(dirname(automation.filePath), WEBHOOK_RECEIPT_FILENAME),
        keys: new Map(),
        loaded: Promise.resolve(),
        writes: Promise.resolve(),
      };
      store.loaded = this.loadWebhookReceipts(store);
      this.webhookReceiptStores.set(runKey, store);
    }
    return store;
  }

  private async loadWebhookReceipts(store: WebhookReceiptStore): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(store.file, "utf8")) as unknown;
      if (typeof parsed !== "object" || parsed == null || !Array.isArray((parsed as { receipts?: unknown }).receipts)) return;
      const horizon = Date.now() - WEBHOOK_IDEMPOTENCY_TTL_MS;
      for (const entry of (parsed as { receipts: readonly unknown[] }).receipts) {
        if (typeof entry !== "object" || entry == null) continue;
        const { key, at } = entry as { key?: unknown; at?: unknown };
        if (typeof key !== "string" || key.length === 0 || typeof at !== "number" || at <= horizon) continue;
        store.keys.set(key, at);
      }
    } catch {
      return;
    }
  }

  private livePersistedWebhookReceipt(store: WebhookReceiptStore, idempotencyKey: string): boolean {
    const at = store.keys.get(idempotencyKey);
    return at !== undefined && at > Date.now() - WEBHOOK_IDEMPOTENCY_TTL_MS;
  }

  private persistWebhookReceipt(store: WebhookReceiptStore, idempotencyKey: string): void {
    store.keys.set(idempotencyKey, Date.now());
    while (store.keys.size > MAX_PERSISTED_WEBHOOK_RECEIPTS) {
      const oldest = store.keys.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      store.keys.delete(oldest);
    }
    store.writes = store.writes.then(() => this.writeWebhookReceipts(store)).catch(() => undefined);
  }

  private async writeWebhookReceipts(store: WebhookReceiptStore): Promise<void> {
    const horizon = Date.now() - WEBHOOK_IDEMPOTENCY_TTL_MS;
    const receipts = [...store.keys.entries()].filter(([, at]) => at > horizon).map(([key, at]) => ({ key, at }));
    await mkdir(dirname(store.file), { recursive: true });
    const tmp = `${store.file}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ version: 1, receipts }, null, 2)}\n`, "utf8");
    await rename(tmp, store.file);
  }
}

function webhookIdempotencyKeyOf(event: Record<string, unknown>): string | null {
  if (event.source !== "webhook") return null;
  const key = event.idempotencyKey;
  return typeof key === "string" && key.length > 0 ? key : null;
}
