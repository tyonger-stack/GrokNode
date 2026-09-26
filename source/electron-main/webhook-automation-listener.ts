import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { getSandRootDir } from "../host/host-paths.js";
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
  }): Promise<WebhookWakeOutcome>;
}
export interface WebhookAutomationListenerDependencies {
  readonly forwarder: WebhookAutomationForwarder;
  readonly port?: number;
  onBindError(port: number, error: Error): void;
  readonly log?: (message: string) => void;
}

export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
const WEBHOOK_ROUTE_PATTERN = /^\/webhook\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/;

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
}

function bearerKey(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

/** Body → event payload: a JSON object is spread as-is (the wake renders it in a <webhook_event> block); anything else rides as { text }. */
function parseWebhookPayload(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" && parsed != null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { text: body };
  } catch {
    return { text: body };
  }
}

export function handleWebhookAutomationRequest(req: IncomingMessage, res: ServerResponse, deps: WebhookAutomationListenerDependencies): void {
  if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }).end(); return; }
  const route = WEBHOOK_ROUTE_PATTERN.exec(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  if (route == null) { json(res, 404, { ok: false, error: "not a webhook route: POST /webhook/<agentId>/<routineFolder>" }); return; }
  const key = bearerKey(req);
  if (key == null) { json(res, 401, { ok: false, error: "missing Authorization: Bearer <key> header" }); return; }
  const agentId = route[1] as string, automationId = route[2] as string;
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
    const payload = parseWebhookPayload(Buffer.concat(chunks).toString("utf8"));
    deps.log?.(`webhook-automation: wake ${agentId}/${automationId}`);
    void deps.forwarder.runAgentWebhookAutomation({ agentId, automationId, key, payload }).then(
      (outcome) => json(res, outcome.status, { ok: outcome.ok, ...(outcome.message == null ? {} : { message: outcome.message }) }),
      (error: unknown) => json(res, 502, { ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  });
  req.on("error", () => { if (!settled) { settled = true; res.destroy(); } });
}

export function startWebhookAutomationListener(deps: WebhookAutomationListenerDependencies): { dispose(): void; boundPort(): Promise<number>; whenReady(): Promise<void> } {
  const port = deps.port ?? new SandSettingsStore(`${getSandRootDir()}/settings.json`).getWebhookListenerPort() ?? DEFAULT_WEBHOOK_LISTENER_PORT;
  const server = http.createServer((req, res) => handleWebhookAutomationRequest(req, res, deps));
  server.on("error", (error) => deps.onBindError(port, error));
  const ready = new Promise<void>((resolve) => { server.once("listening", () => resolve()); });
  server.listen(port);
  return {
    dispose() { server.close(); },
    boundPort() { return ready.then(() => { const address = server.address(); return typeof address === "object" && address != null ? address.port : port; }); },
    whenReady() { return ready; },
  };
}
