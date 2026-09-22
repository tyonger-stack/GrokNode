import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const OPENROUTER_CLOUD_BASE_URL = "https://openrouter.ai/api/v1";

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
    _dockerCache = require("node:fs").existsSync("/.dockerenv") || process.env.SAND_HOST_PORT !== undefined;
  } catch { _dockerCache = false; }
  return _dockerCache ?? false;
}

/** When running inside the local Docker box, 127.0.0.1 points at the container, not the Mac.
 *  Rewrite to host.docker.internal and restore the original Host header so the opencodex proxy accepts it. */
export function resolveOpenRouterTransport(persistedOverride?: string | null): { baseUrl: string; hostHeader?: string } {
  const baseUrl = resolveOpenRouterBaseUrl(persistedOverride);
  if (!isRunningInDocker()) return { baseUrl };
  try {
    const url = new URL(baseUrl);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
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

export async function listOpenRouterProxyModels(timeoutMs = 2500, persistedOverride?: string | null): Promise<string[]> {
  const base = resolveOpenRouterBaseUrl(persistedOverride).replace(/\/+$/, "");
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
