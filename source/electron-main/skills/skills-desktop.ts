import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getSandRootDir } from "../../host/host-paths.js";
import { LOCAL_EXEC_DAEMON_CONNECTION_FILENAME } from "../../shared/local-exec-daemon.js";
import { redactSandAutoReviewInlineSecrets } from "../../shared/sand-auto-review-redact.js";

/** The box may still be booting, so a call is bounded rather than hung. */
export const SKILLS_GATEWAY_TIMEOUT_MS = 15_000;

/** Longest gateway detail echoed back to the renderer, after redaction. */
const SKILLS_DETAIL_MAX_CHARS = 400;

/** Below this length a value is not a credential, so it is never substring-scrubbed. */
const SKILLS_TOKEN_SCRUB_MIN_CHARS = 8;

export type SkillsErrorCode = "gateway-unreachable" | "gateway-command-failed" | "bad-request";

/** The `WorkflowTrigger` the gateway accepts, restated so no host type crosses into electron-main. */
export interface SkillsWorkflowTrigger { readonly schedule: string; readonly isEnabled: boolean }

/** The `WorkflowSpec` fields the private-skill edit form owns. */
export interface SkillsSpec {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly trigger: SkillsWorkflowTrigger | null;
}

/**
 * Every operation answers this union and never rejects.  An unreachable host has
 * to stay distinguishable from "this account has no skills", so the failure arm
 * carries an explicit code instead of a transport error.
 */
export type SkillsResult =
  | { readonly ok: true; readonly records: unknown[] }
  | { readonly ok: false; readonly error: { readonly code: SkillsErrorCode; readonly message: string } };

export interface SkillsGatewayConnection { readonly baseUrl: string; readonly token: string }

type SkillsIpcHandler = (event: unknown, request?: any) => Promise<SkillsResult>;

export interface SkillsDesktopDeps {
  ipc: { handle(channel: string, handler: SkillsIpcHandler): void };
  /** Null (or a throw) means the connection cannot be resolved at all. */
  resolveConnection(): Promise<SkillsGatewayConnection | null>;
  /** Injected by tests; defaults to the platform fetch. */
  fetch?: typeof globalThis.fetch;
  /** Injected by tests; defaults to 15s. */
  timeoutMs?: number;
}

function failure(code: SkillsErrorCode, message: string): SkillsResult { return { ok: false, error: { code, message } } }

function nonBlank(value: unknown): string | null { return typeof value === "string" && value.trim().length > 0 ? value : null }

function isTrigger(value: unknown): value is SkillsWorkflowTrigger {
  if (typeof value !== "object" || value == null) return false;
  const trigger = value as { schedule?: unknown; isEnabled?: unknown };
  return typeof trigger.schedule === "string" && typeof trigger.isEnabled === "boolean";
}

function isSpec(value: unknown): value is SkillsSpec {
  if (typeof value !== "object" || value == null) return false;
  const spec = value as { name?: unknown; description?: unknown; body?: unknown; trigger?: unknown };
  return typeof spec.name === "string" && typeof spec.description === "string" && typeof spec.body === "string"
    && (spec.trigger === null || isTrigger(spec.trigger));
}

/**
 * Connection resolution seam.
 *
 * `coordinator-executors.ts` owns `resolveGatewayConnection`, but it is published
 * only across the coordinator's own command channel, which an `ipcMain` registrar
 * cannot reach without adding a coordinator leg this area does not own.  The same
 * supervisor already publishes the resolved connection to disk, so the bridge
 * reads that file rather than inventing a third mechanism.  Only the shape is
 * inspected; the bearer token is never logged, echoed or returned.
 */
export function parseSkillsGatewayConnection(raw: string): SkillsGatewayConnection | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== "object" || parsed == null) return null;
  const { baseUrl, token } = parsed as { baseUrl?: unknown; token?: unknown };
  if (typeof baseUrl !== "string" || !/^https?:\/\/[^/]+/i.test(baseUrl)) return null;
  if (typeof token !== "string" || token.length === 0) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

export async function readLocalExecDaemonGatewayConnection(): Promise<SkillsGatewayConnection | null> {
  const connectionPath = join(getSandRootDir(), LOCAL_EXEC_DAEMON_CONNECTION_FILENAME);
  let raw: string;
  try { raw = await readFile(connectionPath, "utf8"); } catch { return null; }
  return parseSkillsGatewayConnection(raw);
}

/**
 * The pattern redactor alone is not enough here: a gateway that echoes the request
 * headers answers `authorization: Bearer <token>`, and the key/value pattern
 * consumes the `Bearer` word as the value and leaves the secret standing.  So the
 * pattern runs first and the exact credential is then scrubbed by value, which is
 * fail-closed for any spelling the gateway picks.
 */
function redactGatewayDetail(detail: string, token: string): string {
  const redacted = redactSandAutoReviewInlineSecrets(detail);
  return token.length < SKILLS_TOKEN_SCRUB_MIN_CHARS ? redacted : redacted.split(token).join("…");
}

async function send(deps: SkillsDesktopDeps, path: string, args: Record<string, unknown>, timeoutMs: number): Promise<SkillsResult> {
  let connection: SkillsGatewayConnection | null = null;
  try { connection = await deps.resolveConnection(); } catch { connection = null; }
  if (connection == null) return failure("gateway-unreachable", "The local host gateway is not running.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const request = deps.fetch ?? globalThis.fetch;
  try {
    const response = await request(`${connection.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${connection.token}` },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    if (!response.ok) {
      // A 4xx is the command being refused, a 5xx is the host being unreachable,
      // matching the gateway client's own split.  The body is redacted because a
      // gateway error can echo the request headers back at us.
      const body = await response.text().catch(() => response.statusText);
      const detail = redactGatewayDetail(body, connection.token);
      const code: SkillsErrorCode = response.status < 500 ? "gateway-command-failed" : "gateway-unreachable";
      return failure(code, `The local host gateway refused ${path} with HTTP ${response.status}: ${detail}`.slice(0, SKILLS_DETAIL_MAX_CHARS));
    }
    const payload = await response.json() as unknown;
    // A non-array payload is a broken command, not an empty skill list.
    if (!Array.isArray(payload)) return failure("gateway-command-failed", `The local host gateway returned an unexpected payload for ${path}.`);
    return { ok: true, records: payload };
  } catch {
    return failure("gateway-unreachable", controller.signal.aborted
      ? `The local host gateway did not answer ${path} within ${Math.round(timeoutMs / 1000)}s.`
      : `The local host gateway is unreachable while handling ${path}.`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Three private-skill operations on the direct `ipc.invoke` / `ipc.handle` family
 * the MCP desktop bridge uses, not the main-edge method table.  Records are
 * returned raw: the `source` filter belongs to the renderer, so nothing here
 * drops a record kind, and nothing is cached between calls.
 */
export function registerSkillsDesktopIpc(deps: SkillsDesktopDeps): void {
  const timeoutMs = deps.timeoutMs ?? SKILLS_GATEWAY_TIMEOUT_MS;
  deps.ipc.handle("sand:skills-list", async (_event, request) => {
    const agentId = nonBlank(request?.agentId);
    if (agentId == null) return failure("bad-request", "skills.list requires a non-empty agentId.");
    return await send(deps, "/api/getAgentWorkflows", { id: agentId }, timeoutMs);
  });
  deps.ipc.handle("sand:skills-update", async (_event, request) => {
    const agentId = nonBlank(request?.agentId);
    const workflowId = nonBlank(request?.workflowId);
    const spec = request?.spec;
    if (agentId == null || workflowId == null) return failure("bad-request", "skills.update requires a non-empty agentId and workflowId.");
    if (!isSpec(spec)) return failure("bad-request", "skills.update requires a spec with name, description, body and an optional trigger.");
    return await send(deps, "/api/updateAgentWorkflow", { id: agentId, workflowId, spec }, timeoutMs);
  });
  deps.ipc.handle("sand:skills-remove", async (_event, request) => {
    const agentId = nonBlank(request?.agentId);
    const workflowId = nonBlank(request?.workflowId);
    if (agentId == null || workflowId == null) return failure("bad-request", "skills.remove requires a non-empty agentId and workflowId.");
    return await send(deps, "/api/deleteAgentWorkflow", { id: agentId, workflowId }, timeoutMs);
  });
}
