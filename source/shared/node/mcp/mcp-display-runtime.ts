import { normalizeMcpAccountLabel } from "../../mcp.js"; import { SandMcpConfigError } from "./mcp-config-error.js";
export type McpServerConfig = { url: string; type?: "sse" | "http"; headers?: Record<string, string> } | { command: string; args?: string[]; env?: Record<string, string> };
export interface DisplayServer { id: string; name: string; serverIdentifier?: string; config: McpServerConfig; isTeamServer: boolean; disabledByTeamAdminPolicy?: boolean; pluginId?: string; isRequired?: boolean; managedByTeamPluginPolicy?: boolean; accounts?: Array<{ accountKey: string; hasToken: boolean; serverIdentifier?: string }> }
export interface AccountDisplayConfig { servers: DisplayServer[]; cacheScope?: string; unavailable?: boolean; unresolvedServerIds?: string[] }
export function parseMcpServerConfig(value: unknown): McpServerConfig | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.command === "string" && record.command.trim().length > 0) {
    const args = record.args === undefined ? undefined : Array.isArray(record.args) && record.args.every((item) => typeof item === "string") ? record.args : null;
    const env = record.env === undefined ? undefined : typeof record.env === "object" && record.env != null && !Array.isArray(record.env) && Object.values(record.env).every((item) => typeof item === "string") ? record.env as Record<string, string> : null;
    if (args === null || env === null) return null;
    return { command: record.command.trim(), ...(args === undefined || args.length === 0 ? {} : { args }), ...(env === undefined || Object.keys(env).length === 0 ? {} : { env }) };
  }
  if (typeof record.url === "string" && /^https?:\/\//.test(record.url)) {
    const type = record.type === undefined ? undefined : record.type === "sse" || record.type === "http" ? record.type : null;
    const headers = record.headers === undefined ? undefined : typeof record.headers === "object" && record.headers != null && !Array.isArray(record.headers) && Object.values(record.headers).every((item) => typeof item === "string") ? record.headers as Record<string, string> : null;
    if (type === null || headers === null) return null;
    return { url: record.url, ...(type === undefined ? {} : { type }), ...(headers === undefined || Object.keys(headers).length === 0 ? {} : { headers }) };
  }
  return null;
}
export function normalizeAccountKey(raw: string): string { const key = normalizeMcpAccountLabel(raw); if (key.length === 0) throw new SandMcpConfigError("MCP account label is required."); return key; }
export function runtimeConfigFromDisplay(display: AccountDisplayConfig | null): { mcpServers: Record<string, McpServerConfig> } | null { if (display == null) return null; return { mcpServers: Object.fromEntries(display.servers.flatMap((server) => server.serverIdentifier != null && !server.disabledByTeamAdminPolicy ? [[server.serverIdentifier, server.config]] : [])) }; }
export function validateMarketplacePluginId(raw: string): string { const value = raw.trim(); if (!/^\d+$/.test(value)) throw new SandMcpConfigError(`Invalid marketplace plugin id "${raw}".`); return value; }
export function pluginAttributionFromDisplayServer(server: DisplayServer): Record<string, unknown> { return { ...(server.pluginId == null ? {} : { pluginId: server.pluginId }), ...(server.isRequired === true ? { isRequired: true } : {}), ...(server.managedByTeamPluginPolicy === true ? { managedByTeamPluginPolicy: true } : {}) }; }
export function statusFromBackendListStatus(status: string | undefined) { switch (status) { case "connected": return { status: "connected" }; case "needsAuth": return { status: "needsAuth", statusDetail: "Authentication required" }; case "loading": return { status: "initializing" }; case "error": return { status: "error", statusDetail: "Failed to load MCP server" }; default: return { status: "error", statusDetail: "Not reported by backend" }; } }
export function statusFromBoxListStatus(status: string | undefined, unavailable = false, detail?: string) { switch (status) { case "connected": return { status: "connected" }; case "needsAuth": return { status: "needsAuth", statusDetail: "Authentication required" }; case "loading": return { status: "initializing" }; case "error": return { status: "error", statusDetail: detail != null && detail.length > 0 ? detail : "Failed to load MCP server" }; default: return unavailable ? { status: "error", statusDetail: "Grok Bot's computer unreachable" } : { status: "error", statusDetail: "Not reported by Grok Bot's computer" }; } }
