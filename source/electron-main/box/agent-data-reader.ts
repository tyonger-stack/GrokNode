import { LOCAL_DOCKER_BOX_CONTAINER, runDocker } from "./local-docker-host-connector.js";

/**
 * Read-only viewer for the per-bot data files the reconstructed box keeps under
 * /home/box/sand-data (soul/persona memory, memory journal, user-level memory,
 * audit log, workflows). Everything here is whitelist-only: ids/slugs/months are
 * validated before they ever touch a shell command, the file set is fixed, and
 * every read is byte-capped. No secrets files (box-secrets.json, connector-secrets,
 * local-mcp-credentials, …) are reachable through this module.
 */

const BOX_DATA_ROOT = "/home/box/sand-data";
const AGENT_DATA_ROOT = `${BOX_DATA_ROOT}/agents`;
const USER_MEMORY_ROOT = `${BOX_DATA_ROOT}/user-memory/agents`;
const WORKFLOW_ROOT = `${BOX_DATA_ROOT}/workflows`;
const PROFILE_FILE = "memory/profile.md";
const LOG_DIR = "memory/log";
const AUDIT_FILE = "audit.jsonl";
const USER_PROFILE_FILE = "profile.md";
const SKILL_FILE = "SKILL.md";

export const AGENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MEMORY_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;
export const WORKFLOW_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Keep every cap below runDocker's own 200 KB output window so nothing is silently trimmed head-first. */
export const TEXT_READ_CAP_BYTES = 128 * 1024;
export const AUDIT_TAIL_BYTES = 96 * 1024;
export const AUDIT_MAX_ENTRIES = 60;

export interface AgentDataAuditEntry { readonly ts: string | null; readonly type: string; readonly summary: string }
export interface AgentDataOverview {
  readonly soul: string | null;
  readonly soulTruncated: boolean;
  readonly userProfile: string | null;
  readonly userProfileTruncated: boolean;
  readonly memoryLogMonths: readonly string[];
  readonly audit: { readonly entries: readonly AgentDataAuditEntry[]; readonly truncated: boolean };
  readonly workflows: readonly string[];
}
export type AgentDataRead<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly reason: string; readonly detail?: string };
type TextRead = { readonly ok: true; readonly content: string | null; readonly truncated: boolean };

export function normalizeAgentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return AGENT_ID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function normalizeMemoryMonth(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return MEMORY_MONTH_PATTERN.test(trimmed) ? trimmed : null;
}

export function normalizeWorkflowSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return WORKFLOW_SLUG_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Pure parser for a `tail -c` slice of audit.jsonl. `tail -c` keeps the END of the
 * file, so only the first line can be torn; a line that does not start with "{" is
 * dropped rather than guessed at. Newest entries come out first for display.
 */
export function parseAuditTail(raw: string, byteCap: number): { entries: AgentDataAuditEntry[]; truncated: boolean } {
  const truncated = Buffer.byteLength(raw, "utf8") >= byteCap;
  let lines = raw.split("\n");
  const first = lines[0];
  if (first != null && !first.trimStart().startsWith("{")) lines = lines.slice(1);
  const entries: AgentDataAuditEntry[] = [];
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      entries.push({
        ts: typeof parsed.ts === "string" ? parsed.ts : null,
        type: typeof parsed.type === "string" ? parsed.type : "unknown",
        summary: auditSummary(parsed),
      });
    } catch {}
  }
  return { entries: entries.slice(-AUDIT_MAX_ENTRIES).reverse(), truncated: truncated || entries.length > AUDIT_MAX_ENTRIES };
}

function auditSummary(parsed: Record<string, unknown>): string {
  for (const key of ["command", "url", "path", "action", "name", "title"] as const) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim().length > 0) return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  }
  const raw = JSON.stringify(parsed);
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
}

function classifyDockerFailure(output: string): { ok: false; reason: string; detail?: string } {
  if (/No such container/i.test(output)) return { ok: false, reason: "container-missing", detail: output };
  if (/is not running/i.test(output)) return { ok: false, reason: "container-stopped", detail: output };
  if (/is paused/i.test(output)) return { ok: false, reason: "container-paused", detail: output };
  if (/Cannot connect to the Docker daemon|docker: command not found|ENOENT|error during connect/i.test(output)) return { ok: false, reason: "docker-unavailable", detail: output };
  return { ok: false, reason: "read-failed", detail: output };
}

/** Heal the leaked-pause state before probing (same heuristic as the snapshot store). */
async function execInBox(shellCommand: string): Promise<{ ok: true; output: string } | { ok: false; reason: string; detail?: string }> {
  const paused = await runDocker(["inspect", "--format", "{{.State.Paused}}", LOCAL_DOCKER_BOX_CONTAINER]);
  if (paused.ok && paused.output.trim() === "true") {
    const unpaused = await runDocker(["unpause", LOCAL_DOCKER_BOX_CONTAINER]);
    if (!unpaused.ok) return { ok: false, reason: "container-paused", detail: unpaused.output };
  }
  const result = await runDocker(["exec", LOCAL_DOCKER_BOX_CONTAINER, "sh", "-c", shellCommand]);
  if (result.ok) return { ok: true, output: result.output };
  return classifyDockerFailure(result.output);
}

/**
 * `head -c cap+1` capped read. The trailing `; true` makes a missing file an empty
 * success (an empty state, not an error); only container-level failures propagate.
 * Output longer than cap after the runDocker trim means the file was bigger than cap.
 */
async function capRead(shellCommand: string): Promise<TextRead | { ok: false; reason: string; detail?: string }> {
  const outcome = await execInBox(shellCommand);
  if (!outcome.ok) return outcome;
  const trimmed = outcome.output.trim();
  if (trimmed.length === 0) return { ok: true, content: null, truncated: false };
  const truncated = trimmed.length >= TEXT_READ_CAP_BYTES;
  return { ok: true, content: truncated ? trimmed.slice(0, TEXT_READ_CAP_BYTES) : trimmed, truncated };
}

export async function readAgentDataOverview(rawAgentId: unknown): Promise<AgentDataRead<AgentDataOverview>> {
  const agentId = normalizeAgentId(rawAgentId);
  if (agentId == null) return { ok: false, reason: "invalid-agent-id" };
  const agentDir = `${AGENT_DATA_ROOT}/${agentId}`;
  const [soul, user, months, audit, workflows] = await Promise.all([
    capRead(`head -c ${TEXT_READ_CAP_BYTES + 1} ${agentDir}/${PROFILE_FILE} 2>/dev/null; true`),
    capRead(`head -c ${TEXT_READ_CAP_BYTES + 1} ${USER_MEMORY_ROOT}/${agentId}/${USER_PROFILE_FILE} 2>/dev/null; true`),
    execInBox(`ls -1 ${agentDir}/${LOG_DIR} 2>/dev/null; true`),
    execInBox(`tail -c ${AUDIT_TAIL_BYTES + 1} ${agentDir}/${AUDIT_FILE} 2>/dev/null; true`),
    execInBox(`ls -1 ${WORKFLOW_ROOT} 2>/dev/null; true`),
  ]);
  if (!soul.ok) return soul;
  if (!user.ok) return user;
  if (!months.ok) return months;
  if (!audit.ok) return audit;
  if (!workflows.ok) return workflows;
  const monthList = months.output.split("\n").map((name) => name.trim()).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3)).filter((name) => MEMORY_MONTH_PATTERN.test(name)).sort().reverse();
  return {
    ok: true,
    data: {
      soul: soul.content,
      soulTruncated: soul.truncated,
      userProfile: user.content,
      userProfileTruncated: user.truncated,
      memoryLogMonths: monthList,
      audit: parseAuditTail(audit.output, AUDIT_TAIL_BYTES),
      workflows: workflows.output.split("\n").map((name) => name.trim()).filter((name) => WORKFLOW_SLUG_PATTERN.test(name)).sort(),
    },
  };
}

export async function readAgentMemoryLog(rawAgentId: unknown, rawMonth: unknown): Promise<AgentDataRead<{ content: string | null; truncated: boolean }>> {
  const agentId = normalizeAgentId(rawAgentId);
  const month = normalizeMemoryMonth(rawMonth);
  if (agentId == null) return { ok: false, reason: "invalid-agent-id" };
  if (month == null) return { ok: false, reason: "invalid-month" };
  const outcome = await capRead(`head -c ${TEXT_READ_CAP_BYTES + 1} ${AGENT_DATA_ROOT}/${agentId}/${LOG_DIR}/${month}.md 2>/dev/null; true`);
  if (!outcome.ok) return outcome;
  return { ok: true, data: { content: outcome.content, truncated: outcome.truncated } };
}

export async function readAgentWorkflowContent(rawSlug: unknown): Promise<AgentDataRead<{ content: string | null; truncated: boolean }>> {
  const slug = normalizeWorkflowSlug(rawSlug);
  if (slug == null) return { ok: false, reason: "invalid-slug" };
  const outcome = await capRead(`head -c ${TEXT_READ_CAP_BYTES + 1} ${WORKFLOW_ROOT}/${slug}/${SKILL_FILE} 2>/dev/null; true`);
  if (!outcome.ok) return outcome;
  return { ok: true, data: { content: outcome.content, truncated: outcome.truncated } };
}
