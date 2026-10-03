import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { classifyOpenRouterError, openRouterOkStatus, type OpenRouterChannelStatus } from "../openrouter-channel-status.js";

export const OPENROUTER_CLOUD_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENCODEX_MAC_FORWARDER_PORT = 11010;
export const OPENCODEX_CONTAINER_RELAY_PORT = 10100;

/**
 * Reasoning-effort ladder offered by Settings → Router → Model → Effort.
 * Wire values match the Codex ladder (`low`/`medium`/`high`/`xhigh`/`max`/`ultra`) so an
 * OpenAI-compatible upstream (including the local opencodex relay) reads them
 * without a mapping table. `undefined` (never set) means "omit the field" — the
 * endpoint then applies its own per-model default, which is the pre-existing
 * behavior and must stay the default so models that reject `reasoning_effort`
 * keep working.
 */
export const OPENROUTER_REASONING_EFFORTS = [
  // "none" 不在 opencodex 目录的能力表里（目录只有 low…ultra），它按模型分流处理：
  // 见 noneThinkingStrategy —— Flash 系发 low 即不思考、M3 系发 thinking:{type:"disabled"}、
  // 其余模型端点无法关闭思考，发送侧退化为不发（模型默认）。
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" }
] as const;

export type OpenRouterReasoningEffort = (typeof OPENROUTER_REASONING_EFFORTS)[number]["value"];

const OPENROUTER_REASONING_EFFORT_VALUES = new Set<string>(OPENROUTER_REASONING_EFFORTS.map((entry) => entry.value));

export function isOpenRouterReasoningEffort(value: unknown): value is OpenRouterReasoningEffort {
  return typeof value === "string" && OPENROUTER_REASONING_EFFORT_VALUES.has(value);
}

/** Accepts wire values only; blank/unknown degrades to `null` (omit the field). */
export function normalizeOpenRouterReasoningEffort(value: unknown): OpenRouterReasoningEffort | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return isOpenRouterReasoningEffort(trimmed) ? trimmed : null;
}
/** Healthy `/models` answers at ~5.1s p99 and ~8.1s p99.9 because `ocx` refreshes every enabled provider first. */
export const OPENCODEX_CHANNEL_PROBE_TIMEOUT_MS = 10_000;

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

export function readCodexConfigValue(key: string): string | null {
  try {
    const config = readFileSync(join(codexHome(), "config.toml"), "utf8");
    const value = new RegExp("^\\s*" + key + "\\s*=\\s*[\"']([^\"']+)[\"']", "m").exec(config)?.[1]?.trim();
    return value == null || value.length === 0 ? null : value;
  } catch { return null; }
}

export function resolveOpenRouterBaseUrl(persistedOverride?: string | null): string {
  const persisted = persistedOverride?.trim() || null;
  return persisted || process.env.OPENROUTER_BASE_URL?.trim() || readCodexConfigValue("openai_base_url") || OPENROUTER_CLOUD_BASE_URL;
}

export function isOpenRouterProxyMode(persistedOverride?: string | null): boolean {
  return resolveOpenRouterBaseUrl(persistedOverride) !== OPENROUTER_CLOUD_BASE_URL;
}

let _dockerCache: boolean | undefined;
export function isRunningInDocker(): boolean {
  if (_dockerCache !== undefined) return _dockerCache;
  try {
    _dockerCache = existsSync("/.dockerenv") || process.env.SAND_HOST_PORT !== undefined;
  } catch { _dockerCache = false; }
  return _dockerCache ?? false;
}

export function resolveOpenRouterTransport(persistedOverride?: string | null, inDockerOverride?: boolean): { baseUrl: string; hostHeader?: string } {
  const baseUrl = resolveOpenRouterBaseUrl(persistedOverride);
  const inDocker = inDockerOverride ?? isRunningInDocker();
  if (!inDocker) return { baseUrl };
  try {
    const url = new URL(baseUrl);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      if (url.port === String(OPENCODEX_MAC_FORWARDER_PORT)) {
        url.port = String(OPENCODEX_CONTAINER_RELAY_PORT);
        return { baseUrl: url.toString() };
      }
      const originalHost = url.host;
      url.hostname = "host.docker.internal";
      return { baseUrl: url.toString(), hostHeader: originalHost };
    }
  } catch {}
  return { baseUrl };
}

// The catalog is ~1.6 MB and the host consults it on every request; re-parse only when it changes.
let catalogCache: { path: string; mtimeMs: number; models: unknown[] | null } | null = null;
function readCatalogModels(): unknown[] | null {
  const path = join(codexHome(), "opencodex-catalog.json");
  const mtimeMs = statSync(path).mtimeMs;
  if (catalogCache?.path === path && catalogCache.mtimeMs === mtimeMs) return catalogCache.models;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { models?: unknown };
  catalogCache = { path, mtimeMs, models: Array.isArray(parsed.models) ? parsed.models : null };
  return catalogCache.models;
}

export interface OpenRouterModelReasoning {
  /** Supported efforts in ladder order; never empty. */
  readonly levels: readonly OpenRouterReasoningEffort[];
  readonly defaultLevel: OpenRouterReasoningEffort | null;
}

/**
 * Per-model effort ladder from the opencodex catalog (`supported_reasoning_levels` /
 * `default_reasoning_level`) — the same data the Codex app uses to offer only the efforts a
 * model accepts. `null` when the catalog is missing or does not know the model, in which case
 * callers keep the full ladder.
 */
export function readOpenRouterModelReasoning(model: string | null | undefined): OpenRouterModelReasoning | null {
  const wanted = model?.trim();
  if (!wanted) return null;
  try {
    const models = readCatalogModels();
    if (models == null) return null;
    const entry = models.find((candidate): candidate is Record<string, unknown> =>
      typeof candidate === "object" && candidate != null && typeof (candidate as { slug?: unknown }).slug === "string" && (candidate as { slug: string }).slug.trim() === wanted);
    if (entry == null || !Array.isArray(entry.supported_reasoning_levels)) return null;
    const supported = new Set(entry.supported_reasoning_levels
      .map((level) => normalizeOpenRouterReasoningEffort((level as { effort?: unknown } | null)?.effort))
      .filter((level): level is OpenRouterReasoningEffort => level != null));
    const levels = OPENROUTER_REASONING_EFFORTS.map((ladder) => ladder.value).filter((value) => supported.has(value));
    if (levels.length === 0) return null;
    const defaultLevel = normalizeOpenRouterReasoningEffort(entry.default_reasoning_level);
    return { levels, defaultLevel: defaultLevel != null && supported.has(defaultLevel) ? defaultLevel : null };
  } catch { return null; }
}

/** The efforts to offer for `model`: its catalog ladder, or the full ladder when unknown. */
export function openRouterEffortOptionsFor(model: string | null | undefined): Array<{ value: OpenRouterReasoningEffort; label: string }> {
  const reasoning = readOpenRouterModelReasoning(model);
  return OPENROUTER_REASONING_EFFORTS
    .filter((entry) => entry.value === "none" || reasoning == null || reasoning.levels.includes(entry.value))
    .map((entry) => ({ value: entry.value, label: entry.label }));
}

/** Drops an effort the catalog says `model` does not accept, so the endpoint default applies instead of a rejection. */
export function effortSupportedByModel(effort: OpenRouterReasoningEffort | null, model: string | null | undefined): OpenRouterReasoningEffort | null {
  if (effort == null) return null;
  if (effort === "none") return "none"; // 目录无从校验"无"；由 noneThinkingStrategy 分流
  const reasoning = readOpenRouterModelReasoning(model);
  return reasoning == null || reasoning.levels.includes(effort) ? effort : null;
}

/**
 * "无(不思考)" 的按模型分流（2026-10-03 对 api.minimax.cn 实测）：
 * - Flash 系（id 含 flash）：`reasoning_effort:"low"` 即不思考（low 以下无思考输出）；
 * - M3 系（MiniMax-M3* 且非 flash）：Anthropic 风格 `thinking:{type:"disabled"}` 真正关闭
 *   内联 <think>，工具调用不受影响；flash 系发这个参数会被端点 400；
 * - 其余（M2.x 等）：端点不支持关闭思考，退化为不发任何参数（模型默认）。
 */
export type NoneThinkingStrategy = "effort-low" | "thinking-disabled" | "unsupported";

export function noneThinkingStrategy(model: string | null | undefined): NoneThinkingStrategy {
  const id = (model ?? "").trim();
  if (id.length === 0) return "unsupported";
  if (/flash/i.test(id)) return "effort-low";
  if (/^minimax[-_]?m3(?!.*flash)/i.test(id)) return "thinking-disabled";
  return "unsupported";
}

/** Wraps `fetch` so JSON chat bodies gain `thinking:{type:"disabled"}` (M3 line's off switch). */
export function withDisabledThinkingFetch(fetchImpl: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      if (init?.body != null && typeof init.body === "string") {
        const body = JSON.parse(init.body) as { model?: unknown; thinking?: unknown };
        if (body != null && typeof body === "object" && body.model != null && body.thinking === undefined) {
          body.thinking = { type: "disabled" };
          init = { ...init, body: JSON.stringify(body) };
        }
      }
    } catch { /* 非 JSON body：原样透传 */ }
    return fetchImpl(input, init);
  }) as typeof fetch;
}

function readCatalogModelSlugs(): string[] {
  try {
    const catalogPath = join(codexHome(), "opencodex-catalog.json");
    const parsed = JSON.parse(readFileSync(catalogPath, "utf8")) as { models?: Array<{ slug?: unknown }> };
    if (!Array.isArray(parsed.models)) return [];
    return [...new Set(parsed.models.map((model) => (typeof model.slug === "string" ? model.slug.trim() : "")).filter((slug) => slug.length > 0))].sort();
  } catch { return []; }
}

export async function listOpenRouterProxyModels(timeoutMs = OPENCODEX_CHANNEL_PROBE_TIMEOUT_MS, persistedOverride?: string | null): Promise<string[]> {
  const base = resolveOpenRouterTransport(persistedOverride).baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(`${base}/models`, {
      signal: controller.signal,
      headers: { authorization: "Bearer local-proxy" },
    });
    if (!response.ok) throw new Error(`OpenRouter model list returned HTTP ${response.status}.`);
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(body.data)) throw new Error("OpenRouter model list is malformed.");
    const ids = [...new Set(body.data.map((model) => (typeof model.id === "string" ? model.id.trim() : "")).filter((id) => id.length > 0))].sort();
    return ids.length > 0 ? ids : readCatalogModelSlugs();
  } catch {
    return readCatalogModelSlugs();
  } finally {
    clearTimeout(timer);
  }
}

export async function probeOpenRouterChannel(timeoutMs = OPENCODEX_CHANNEL_PROBE_TIMEOUT_MS, persistedOverride?: string | null): Promise<OpenRouterChannelStatus> {
  const startedAt = Date.now();
  const transport = resolveOpenRouterTransport(persistedOverride);
  const base = transport.baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const headers: Record<string, string> = { authorization: "Bearer local-proxy" };
    if (transport.hostHeader) headers.Host = transport.hostHeader;
    const response = await fetch(`${base}/models`, { signal: controller.signal, headers });
    if (!response.ok) {
      const responseBody = await response.text();
      return classifyOpenRouterError({ name: "OpenRouterChannelError", message: `OpenRouter model list returned HTTP ${response.status}.`, statusCode: response.status, responseHeaders: response.headers, responseBody }, "model_list", startedAt) ?? openRouterOkStatus("model_list", startedAt, response.status);
    }
    const body = await response.json() as { data?: unknown };
    if (!Array.isArray(body.data) || body.data.length === 0) {
      return classifyOpenRouterError({ name: "OpenRouterChannelError", message: "OpenRouter model list is malformed.", statusCode: response.status, responseHeaders: response.headers, responseBody: JSON.stringify(body) }, "model_list", startedAt) ?? openRouterOkStatus("model_list", startedAt, response.status);
    }
    const valid = body.data.some((model) => typeof model === "object" && model != null && typeof (model as { id?: unknown }).id === "string" && (model as { id: string }).id.trim().length > 0);
    if (!valid) {
      return classifyOpenRouterError({ name: "OpenRouterChannelError", message: "OpenRouter model list has no valid model ids.", statusCode: response.status, responseHeaders: response.headers, responseBody: JSON.stringify(body) }, "model_list", startedAt) ?? openRouterOkStatus("model_list", startedAt, response.status);
    }
    return openRouterOkStatus("model_list", startedAt, response.status);
  } catch (error) {
    return classifyOpenRouterError(error, "model_list", startedAt, { timedOut }) ?? openRouterOkStatus("model_list", startedAt);
  } finally {
    clearTimeout(timer);
  }
}
