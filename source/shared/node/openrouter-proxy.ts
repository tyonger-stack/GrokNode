import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { classifyOpenRouterError, openRouterOkStatus, type OpenRouterChannelStatus } from "../openrouter-channel-status.js";

export const OPENROUTER_CLOUD_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENCODEX_MAC_FORWARDER_PORT = 11010;
export const OPENCODEX_CONTAINER_RELAY_PORT = 10100;
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
