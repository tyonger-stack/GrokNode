import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { getSandRootDir } from "../host/host-paths.js";
import { githubWebhookToListenerEvent, isSlackEventsApiEnvelope, slackEventToListenerEvent, slackUrlVerificationChallenge } from "../shared/listener-events.js";
import { DEFAULT_WEBHOOK_LISTENER_PORT, SandSettingsStore } from "../shared/node/settings/sand-settings-store.js";

export interface WebhookWakeOutcome {
  readonly ok: boolean;
  readonly status: number;
  readonly message?: string;
}
export interface WebhookAutomationForwarder {
  runAgentWebhookAutomation(args: {
    readonly agentId: string;
    readonly automationId: string;
    readonly key: string;
    readonly payload?: Record<string, unknown>;
    readonly deliveryId?: string;
    readonly eventName?: string;
    readonly contentType?: string;
    readonly userAgent?: string;
  }): Promise<WebhookWakeOutcome>;
  /** Local listener-event ingestion (Grok Node): a platform delivery (GitHub webhook, Slack Events API) mapped to the canonical listener event shape; fed to the host's trigger-matching hub, SCOPED to the agent whose routine key authenticated the delivery. Absent on stacks without the coordinator leg. */
  ingestListenerEvent?(args: {
    readonly agentId: string;
    readonly event: Record<string, unknown>;
    readonly deliveryId?: string;
  }): Promise<{ readonly accepted: boolean }>;
}
export interface WebhookAutomationListenerDependencies {
  readonly forwarder: WebhookAutomationForwarder;
  readonly port?: number;
  onBindError(port: number, error: Error): void;
  readonly log?: (message: string) => void;
}

export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
export const WEBHOOK_RATE_LIMIT = 30;
export const WEBHOOK_RATE_WINDOW_MS = 60_000;
const WEBHOOK_ROUTE_PATTERN = /^\/webhook\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})(?:\/([A-Za-z0-9_-]{1,256}))?$/;
const WEBHOOK_HEADER_TOKEN_LIMIT = 200, WEBHOOK_USER_AGENT_LIMIT = 300;

export interface WebhookRateLimiter {
  consume(routeKey: string): { allowed: boolean; retryAfterSeconds: number };
  reset(): void;
}

export function createWebhookRateLimiter(now: () => number = Date.now): WebhookRateLimiter {
  const windows = new Map<string, number[]>();
  return {
    consume(routeKey: string) {
      const at = now();
      const window = (windows.get(routeKey) ?? []).filter((stamp) => at - stamp < WEBHOOK_RATE_WINDOW_MS);
      windows.set(routeKey, window);
      if (window.length >= WEBHOOK_RATE_LIMIT)
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window[0]! + WEBHOOK_RATE_WINDOW_MS - at) / 1000)) };
      window.push(at);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    reset(): void { windows.clear(); },
  };
}

/**
 * Best-effort delivery dedupe for listener-event ingestion. Platforms retry a
 * delivery until 2xx, and the webhook-fire path has its own durable receipts
 * host-side; the ingestion fan-out (SandTriggerHub) has none, so the same
 * delivery id must not wake matching routines twice. Mirrors the host's
 * WEBHOOK_IDEMPOTENCY_TTL_MS window. Absent ids always admit (nothing to
 * dedupe on).
 */
const LISTENER_DELIVERY_TTL_MS = 7 * 24 * 60 * 60_000;
const LISTENER_DELIVERY_CAP = 2_048;
const listenerDeliveries = new Map<string, number>();
export function markListenerDeliverySeen(deliveryId: string | undefined, now: () => number = Date.now): boolean {
  if (deliveryId == null || deliveryId.length === 0) return true;
  const at = now();
  if (listenerDeliveries.has(deliveryId)) return false;
  if (listenerDeliveries.size >= LISTENER_DELIVERY_CAP) {
    for (const [id, stamp] of listenerDeliveries) {
      if (at - stamp >= LISTENER_DELIVERY_TTL_MS || listenerDeliveries.size < LISTENER_DELIVERY_CAP) listenerDeliveries.delete(id);
      if (listenerDeliveries.size < LISTENER_DELIVERY_CAP) break;
    }
  }
  listenerDeliveries.set(deliveryId, at);
  return true;
}
export function resetListenerDeliveryDedupe(): void { listenerDeliveries.clear(); }

function json(res: ServerResponse, status: number, value: unknown, extraHeaders: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extraHeaders }).end(JSON.stringify(value));
}

function bearerKey(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

class WebhookRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function contentTypeOf(req: IncomingMessage): string {
  const raw = req.headers["content-type"];
  return (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? undefined;
}

function headerToken(req: IncomingMessage, name: string, limit: number = WEBHOOK_HEADER_TOKEN_LIMIT): string | undefined {
  const value = firstHeader(req, name);
  if (typeof value !== "string") return undefined;
  const token = value.trim().slice(0, limit);
  return token || undefined;
}

function webhookDeliveryId(req: IncomingMessage): string | undefined {
  return headerToken(req, "idempotency-key") ?? headerToken(req, "x-webhook-id") ?? headerToken(req, "x-github-delivery") ?? headerToken(req, "webhook-id");
}

function webhookEventName(req: IncomingMessage): string | undefined {
  return headerToken(req, "x-github-event") ?? headerToken(req, "x-webhook-event") ?? headerToken(req, "x-event-type") ?? headerToken(req, "ce-type");
}

function jsonLikeContentType(contentType: string): boolean {
  return contentType === "application/json" || contentType === "text/json" || contentType.endsWith("+json");
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" && parsed != null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch { return null; }
}

function parseWebhookPayload(body: string, contentType: string): Record<string, unknown> {
  if (body.length === 0) return {};
  if (contentType === "application/x-www-form-urlencoded") return Object.fromEntries(new URLSearchParams(body));
  if (jsonLikeContentType(contentType)) {
    const parsed = parseJsonObject(body);
    if (parsed == null) throw new WebhookRequestError(400, `invalid JSON body for content-type ${contentType || "application/json"}`);
    return parsed;
  }
  return parseJsonObject(body) ?? { text: body };
}

export function handleWebhookAutomationRequest(req: IncomingMessage, res: ServerResponse, deps: WebhookAutomationListenerDependencies, rateLimiter: WebhookRateLimiter): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") { json(res, 200, { ok: true, service: "grok-node-webhook-automation" }); return; }
  const route = WEBHOOK_ROUTE_PATTERN.exec(url.pathname);
  if (route == null) { json(res, 404, { ok: false, error: "not a webhook route: POST /webhook/<agentId>/<routineFolder>[/<key>]" }); return; }
  if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }).end(); return; }
  const agentId = route[1] as string, automationId = route[2] as string;
  // Path-segment key is the fallback for senders that cannot set headers; prefer the Bearer header so the secret stays out of URLs and logs.
  const key = route[3] ?? bearerKey(req);
  if (key == null) { json(res, 401, { ok: false, error: "missing webhook key: send Authorization: Bearer <key> or append /<key> to the URL" }); return; }
  const rate = rateLimiter.consume(`${agentId}/${automationId}`);
  if (!rate.allowed) { json(res, 429, { ok: false, error: "webhook rate limit exceeded" }, { "retry-after": String(rate.retryAfterSeconds) }); return; }
  const chunks: Buffer[] = [];
  let size = 0, settled = false;
  req.on("data", (chunk: Buffer) => {
    if (settled) return;
    size += chunk.byteLength;
    if (size > WEBHOOK_MAX_BODY_BYTES) {
      settled = true;
      json(res, 413, { ok: false, error: "payload too large" });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (settled) return;
    settled = true;
    const contentType = contentTypeOf(req);
    let payload: Record<string, unknown>;
    try { payload = parseWebhookPayload(Buffer.concat(chunks).toString("utf8"), contentType); }
    catch (error) {
      if (error instanceof WebhookRequestError) { json(res, error.status, { ok: false, error: error.message }); return; }
      res.destroy();
      return;
    }
    const deliveryId = webhookDeliveryId(req), eventName = webhookEventName(req), userAgent = headerToken(req, "user-agent", WEBHOOK_USER_AGENT_LIMIT);
    // Slack Events API URL verification handshake: answer the challenge and
    // stop — nothing to wake and nothing to ingest.
    const challenge = slackUrlVerificationChallenge(payload);
    if (challenge != null) { json(res, 200, { ok: true, challenge }); return; }
    // Local listener-event ingestion (Grok Node): a GitHub webhook delivery
    // (x-github-event header) or a Slack Events API envelope that already
    // passed this route's key auth is additionally mapped to the canonical
    // listener event and offered to the host's trigger-matching hub, so
    // github/slack-type listener triggers work without the hosted backend
    // relay. Two gates, both load-bearing (tests/webhook-ingestion-gate.test.mjs):
    // (1) the addressed routine's forward outcome must be exactly 202 (fired)
    // or 409 (paused) — the only statuses automation-runtime.ts emits AFTER
    // verifying the presented key; 401/404 never verified it, so those
    // payloads must not reach the trigger hub. (2) the injection is scoped to
    // the authenticated route's agentId — one routine's key may never wake
    // another agent's routines. The addressed webhook routine still fires,
    // its outcome still drives the HTTP response, unchanged.
    const listenerEvent = eventName != null
      ? githubWebhookToListenerEvent(eventName, payload)
      : isSlackEventsApiEnvelope(payload)
        ? slackEventToListenerEvent(payload)
        : null;
    deps.log?.(`webhook-automation: wake ${agentId}/${automationId}`);
    void deps.forwarder.runAgentWebhookAutomation({
      agentId,
      automationId,
      key,
      payload,
      ...(deliveryId === undefined ? {} : { deliveryId }),
      ...(eventName === undefined ? {} : { eventName }),
      ...(contentType === "" ? {} : { contentType }),
      ...(userAgent === undefined ? {} : { userAgent }),
    }).then(
      (outcome) => {
        if (listenerEvent != null && deps.forwarder.ingestListenerEvent != null && (outcome.status === 202 || outcome.status === 409) && markListenerDeliverySeen(deliveryId)) {
          deps.log?.(`webhook-automation: listener ${String(listenerEvent.source)} event ingested for agent ${agentId} via ${automationId}`);
          void Promise.resolve(deps.forwarder.ingestListenerEvent({ agentId, event: listenerEvent, ...(deliveryId === undefined ? {} : { deliveryId }) }))
            .catch((error: unknown) => deps.log?.(`webhook-automation: listener ingestion failed: ${error instanceof Error ? error.message : String(error)}`));
        }
        json(res, outcome.status, { ok: outcome.ok, ...(outcome.message == null ? {} : { message: outcome.message }) });
      },
      (error: unknown) => json(res, 502, { ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  });
  req.on("error", () => { if (!settled) { settled = true; res.destroy(); } });
}

export function startWebhookAutomationListener(deps: WebhookAutomationListenerDependencies): { dispose(): void; boundPort(): Promise<number>; whenReady(): Promise<void> } {
  const port = deps.port ?? new SandSettingsStore(`${getSandRootDir()}/settings.json`).getWebhookListenerPort() ?? DEFAULT_WEBHOOK_LISTENER_PORT;
  const rateLimiter = createWebhookRateLimiter();
  const server = http.createServer((req, res) => handleWebhookAutomationRequest(req, res, deps, rateLimiter));
  server.on("error", (error) => deps.onBindError(port, error));
  const ready = new Promise<void>((resolve) => { server.once("listening", () => resolve()); });
  // Loopback-only bind: the listener authenticates deliveries with routine
  // webhook keys and (until platform signature verification lands) must never
  // be reachable off-host. An explicit 127.0.0.1 keeps `listen(port)` from
  // binding every interface (the IPv6 wildcard included).
  server.listen(port, "127.0.0.1");
  return {
    dispose() { rateLimiter.reset(); server.close(); },
    boundPort() { return ready.then(() => { const address = server.address(); return typeof address === "object" && address != null ? address.port : port; }); },
    whenReady() { return ready; },
  };
}
