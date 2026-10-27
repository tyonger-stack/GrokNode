import type { JsonValue, MessageType } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { PollingPolicy } from "../../../internal/scheduling.js";
import type { EmailTrigger, EventTrigger } from "../../../shared/automations.js";
import {
  GrokBotEmailDirection,
  GrokBotEmailSearchMode,
  ListGrokBotEmailInboxesRequest,
  ListGrokBotEmailInboxesResponse,
  SearchGrokBotEmailThreadsRequest,
  SearchGrokBotEmailThreadsResponse,
} from "../../../packages/proto/generated/aiserver/v1/grok_bot_email_pb.js";
import type { EmailInboxValidation } from "../../runner/tools/sand-state-tool.js";

/**
 * Email-trigger wakeup for local automations, mirroring how the backend relay
 * keeps Slack/GitHub listeners alive: the official cloud runs email-triggered
 * routines itself, so Grok Node wakes them by polling the read-only
 * SearchGrokBotEmailThreads RPC over the same Connect-JSON wire the relay uses.
 */
export const DEFAULT_EMAIL_POLL_INTERVAL_MS = 60_000, EMAIL_ERROR_BACKOFF_MS = 30_000, EMAIL_SEARCH_LIMIT = 20, EMAIL_SEEN_MESSAGE_CAP = 2_048;

export class SandEmailInboxError extends Error {}

export interface EmailSourceStatus { readonly state: string; readonly detail?: string }

type EmailSink = (event: Record<string, unknown>) => boolean;

export interface EmailInboxSourceDeps {
  readonly getAccessToken: (args: { backendUrl: string }) => Promise<string>;
  readonly getBackendUrl: () => string;
  readonly polling: PollingPolicy;
  readonly fetchImpl?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

const isEmailTrigger = (listener: EventTrigger): listener is EmailTrigger => listener.type === "email";

export function createEmailInboxSources(deps: EmailInboxSourceDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch, now = deps.now ?? Date.now, log = deps.log ?? (() => {});
  let emailSink: EmailSink | null = null, emailListeners: EmailTrigger[] = [], emailStatus: EmailSourceStatus = { state: "idle" };
  let timer: { dispose(): void } | null = null, ticking = false, backoffUntil = 0, startedAtMs = 0;
  // Monotonic per-inbox watermark: the largest occurredAtMs of the last successful
  // response, never moving backwards. A fresh start seeds from the wall clock so a
  // first poll never replays history that predates this source.
  const watermarks = new Map<string, number>();
  const seenMessageIds = new Map<string, number>();
  const rememberMessage = (messageId: string) => {
    seenMessageIds.set(messageId, now());
    if (seenMessageIds.size <= EMAIL_SEEN_MESSAGE_CAP) return;
    for (const id of seenMessageIds.keys()) {
      seenMessageIds.delete(id);
      if (seenMessageIds.size < EMAIL_SEEN_MESSAGE_CAP) break;
    }
  };
  const call = async <Req extends Message<Req>, Res extends Message<Res>>(method: string, request: Req, response: MessageType<Res>): Promise<Res> => {
    const backendUrl = deps.getBackendUrl(), token = await deps.getAccessToken({ backendUrl });
    const wire = await fetchImpl(new URL(`/aiserver.v1.GrokBotService/${method}`, backendUrl), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(request.toJson()),
    });
    if (!wire.ok) throw new SandEmailInboxError(`email ${method} returned ${wire.status}`);
    return response.fromJson(await wire.json() as JsonValue);
  };
  /** Save-time inbox validation: an address the account doesn't own blocks the save; an unreachable RPC saves with a warning (the webhook-offline convention). */
  const validateEmailInboxes = async (inboxes: readonly string[]): Promise<EmailInboxValidation> => {
    try {
      const response = await call("ListGrokBotEmailInboxes", new ListGrokBotEmailInboxesRequest({ showsAssigned: true }), ListGrokBotEmailInboxesResponse);
      const owned = new Set(response.inboxes.map((inbox) => inbox.email.toLowerCase()).filter((email) => email.length > 0));
      const missing = inboxes.filter((inbox) => !owned.has(inbox.toLowerCase()));
      if (missing.length > 0) {
        const available = [...owned].join(", ");
        return { ok: false, reason: `"${missing.join('", "')}" is not one of this account's Bot email addresses.${available.length > 0 ? ` The account's Bot email ${owned.size === 1 ? "address is" : "addresses are"}: ${available}.` : ""} Ask the user to enable a Bot email address in the official Grok Bot app's settings first, then retry.` };
      }
      return { ok: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "email inbox lookup failed";
      log(`[sand:email-inbox] inbox validation degraded to a warning: ${detail}`);
      return { ok: true, warning: `Saved, but the account's Bot email addresses could not be confirmed (${detail}). If "${inboxes.join('", "')}" isn't a Bot email address of this account, the routine will never fire; ask the user to check it in the official Grok Bot app's settings.` };
    }
  };
  const subscribedInboxes = (): string[] => {
    const inboxes: string[] = [];
    for (const listener of emailListeners) {
      if (listener.inbox.length === 0) continue;
      const key = listener.inbox.toLowerCase();
      if (!inboxes.some((existing) => existing.toLowerCase() === key)) inboxes.push(listener.inbox);
    }
    return inboxes;
  };
  const tick = async () => {
    if (ticking || now() < backoffUntil) return;
    ticking = true;
    try {
      const inboxes = subscribedInboxes();
      if (inboxes.length === 0) return;
      for (const inbox of inboxes) {
        const key = inbox.toLowerCase(), watermark = watermarks.get(key);
        const request = new SearchGrokBotEmailThreadsRequest({
          query: "",
          inboxEmail: inbox,
          limit: EMAIL_SEARCH_LIMIT,
          mode: GrokBotEmailSearchMode.HYBRID,
          ...(watermark == null ? {} : { afterMs: BigInt(watermark) }),
        });
        const response = await call("SearchGrokBotEmailThreads", request, SearchGrokBotEmailThreadsResponse);
        let highest = watermark ?? Number.NEGATIVE_INFINITY;
        for (const thread of response.threads) {
          for (const message of thread.matchingMessages) {
            const occurredAtMs = Number(message.occurredAtMs);
            if (Number.isFinite(occurredAtMs) && occurredAtMs > highest) highest = occurredAtMs;
            // Only inbound mail wakes a routine; the Bot's own replies are OUTBOUND.
            if (message.direction !== GrokBotEmailDirection.INBOUND) continue;
            if (message.messageId.length === 0 || seenMessageIds.has(message.messageId)) continue;
            if (!Number.isFinite(occurredAtMs) || occurredAtMs < (watermark ?? startedAtMs)) continue;
            rememberMessage(message.messageId);
            emailSink?.({
              source: "email",
              inbox,
              messageId: message.messageId,
              threadId: thread.threadId,
              subject: thread.subject,
              from: { name: message.from?.name ?? "", email: message.from?.email ?? "" },
              ...(message.snippet == null ? {} : { snippet: message.snippet }),
              occurredAtMs,
            });
          }
        }
        // The watermark advances to the newest message of the response (inbound or
        // outbound) and never regresses; an old messageId is still deduped by id.
        if (Number.isFinite(highest) && highest > (watermark ?? Number.NEGATIVE_INFINITY)) watermarks.set(key, highest);
      }
      emailStatus = { state: "listening" };
    } catch (error) {
      backoffUntil = now() + EMAIL_ERROR_BACKOFF_MS;
      const detail = error instanceof Error ? error.message : "email poll failed";
      log(`[sand:email-inbox] poll failed: ${detail}`);
      if (emailListeners.length > 0 && emailSink != null) emailStatus = { state: "error", detail };
    } finally {
      ticking = false;
    }
  };
  const ensureLoop = () => { timer ??= deps.polling.start(async () => { await tick(); }); };
  const email = {
    kind: "email",
    async start(sink: EmailSink) { emailSink = sink; startedAtMs = now(); emailStatus = { state: "connecting" }; ensureLoop(); },
    setListeners(listeners: readonly EventTrigger[]) { emailListeners = listeners.filter(isEmailTrigger); },
    async stop() { emailSink = null; emailListeners = []; emailStatus = { state: "idle" }; watermarks.clear(); seenMessageIds.clear(); timer?.dispose(); timer = null; backoffUntil = 0; },
    getStatus: () => emailStatus,
  };
  return { email, validateEmailInboxes, requestPoll: () => { void tick(); } };
}
