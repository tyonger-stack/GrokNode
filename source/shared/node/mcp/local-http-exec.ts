import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { McpResult } from "../../../packages/proto/generated/agent/v1/mcp_exec_pb.js";
import { LocalHttpCredentials } from "./local-http-credentials.js";
import { LocalHttpOAuth } from "./local-http-oauth.js";
import { createLocalHttpClient, localMcpFetch, localMcpToolResult, type HttpMcpConfig, LOCAL_HTTP_TIMEOUT_MS } from "./local-http-client.js";
import { GMAIL_MCP_URL, GMAIL_MCP_SCOPE } from "./local-http-gmail.js";
import { CALENDAR_MCP_URL, CALENDAR_MCP_SCOPES } from "./local-http-calendar.js";
import type { McpServerConfig } from "./mcp-display-runtime.js";
import { SandMcpConfigError } from "./mcp-config-error.js";
import { generatedMcpResultFactory } from "./mcp-result-factory.js";
import { MCP_OAUTH_LOOPBACK_CALLBACK_URL } from "./mcp-oauth-loopback.js";

// Google's hosted MCP servers (gmail/calendar/…) have no public dynamic client registration and
// need a preconfigured OAuth client plus an explicit scope before connect. Keyed by server URL.
const GOOGLE_HOSTED_AUTH = new Map<string, string>([
  [GMAIL_MCP_URL, GMAIL_MCP_SCOPE],
  [CALENDAR_MCP_URL, CALENDAR_MCP_SCOPES.join(" ")],
]);
// Local connectors keep a single credential slot stored under "default"; any other account key is
// a display-only label persisted alongside the credentials (see LocalHttpCredentials.label).
const STORAGE_ACCOUNT_KEY = "default";
const accountKey = z.string().min(1).max(64);
export const localHttpRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("configure"), serverUrl: z.enum([GMAIL_MCP_URL, CALENDAR_MCP_URL]), clientId: z.string().min(1).max(512), clientSecret: z.string().min(1).max(2048) }),
  z.object({ operation: z.literal("list"), identifiers: z.array(z.string()).max(100) }),
  z.object({ operation: z.literal("execute"), serverIdentifier: z.string(), toolName: z.string(), args: z.record(z.unknown()) }),
  z.object({ operation: z.literal("authenticate"), serverId: z.string(), accountKey, oauthRedirectUri: z.literal(MCP_OAUTH_LOOPBACK_CALLBACK_URL), forceReauth: z.boolean().optional() }),
  z.object({ operation: z.literal("complete"), stateId: z.string().min(1), code: z.string().min(1) }),
  z.object({ operation: z.literal("validate"), targets: z.array(z.object({ serverUrl: z.string(), accountKey })).max(100) }),
  z.object({ operation: z.literal("logout"), serverUrl: z.string(), accountKey }),
  z.object({ operation: z.literal("delete-account"), serverId: z.string(), accountKey }),
  z.object({ operation: z.literal("rename"), serverId: z.string(), accountKey, newAccountKey: accountKey }),
]);
type Connection = ReturnType<typeof createLocalHttpClient>;
type PendingAuth = { readonly connection: Connection; readonly serverIdentifier: string; readonly url: string; readonly expiresAt: number };
type Row = { readonly id: string; readonly name: string; readonly config: HttpMcpConfig };

function localHttpFailure(error: unknown): string {
  if (error instanceof SandMcpConfigError) return error.message;
  if (error instanceof UnauthorizedError) return "Authentication required";
  if (error instanceof Error && /registration|client information/i.test(error.message)) return "This server requires a registered OAuth client. Configure your own client before connecting.";
  if (error instanceof Error && /timeout|aborted/i.test(error.message)) return "The MCP request timed out. Check the connection before retrying any action.";
  return "Unable to connect to this MCP server. Check its address and authentication settings.";
}

export class LocalHttpMcpExec {
  readonly credentials: LocalHttpCredentials;
  private readonly pending = new Map<string, PendingAuth>();
  private readonly work = new Map<string, Promise<unknown>>();
  constructor(private readonly options: { readonly getServers: () => Record<string, McpServerConfig>; readonly credentialDirectory: string }) {
    this.credentials = new LocalHttpCredentials(options.credentialDirectory);
  }
  private rows(): Row[] {
    return Object.entries(this.options.getServers()).sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([name, config], index) => "url" in config ? [{ id: String(index + 1), name, config }] : []);
  }
  private row(id: string | number): Row {
    const row = this.rows().find(item => item.id === String(id));
    if (row == null) throw new SandMcpConfigError("Local HTTP MCP server is not configured.");
    return row;
  }
  private connection(row: Row, interactive = false): Connection {
    return createLocalHttpClient(row.config, new LocalHttpOAuth({ serverUrl: row.config.url, credentials: this.credentials, interactive }));
  }
  private async serial<T>(url: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.work.get(url) ?? Promise.resolve()).catch(() => undefined).then(operation);
    this.work.set(url, next);
    try { return await next; } finally { if (this.work.get(url) === next) this.work.delete(url); }
  }
  async listTools(identifiers: readonly string[]) {
    return Promise.all(this.rows().filter(row => identifiers.includes(row.name)).map(row => this.serial(row.config.url, async () => {
      const connection = this.connection(row);
      const base = { serverIdentifier: row.name, rowServerIdentifier: row.name, accountLabel: (await this.credentials.read(row.config.url, STORAGE_ACCOUNT_KEY)).label ?? STORAGE_ACCOUNT_KEY };
      try {
        if (GOOGLE_HOSTED_AUTH.has(row.config.url) && await connection.provider.tokens() == null && !row.config.headers?.Authorization) throw new UnauthorizedError();
        await connection.connect();
        const tools = [];
        let cursor: string | undefined;
        const cursors = new Set<string>();
        do {
          const page = await connection.client.listTools(cursor == null ? {} : { cursor }, { timeout: LOCAL_HTTP_TIMEOUT_MS });
          const namespace = "mcp_local_" + createHash("sha256").update(row.name).digest("hex").slice(0, 12);
          tools.push(...page.tools.map(tool => ({ name: namespace + "_" + tool.name, toolName: tool.name, providerIdentifier: row.name, clientKey: row.name, description: tool.description ?? "", inputSchema: tool.inputSchema })));
          cursor = page.nextCursor;
          if (cursor != null && cursors.has(cursor)) throw new SandMcpConfigError("MCP returned a repeated tools cursor.");
          if (cursor != null) cursors.add(cursor);
        } while (cursor != null);
        return { ...base, status: "connected", tools };
      } catch (error) {
        return { ...base, status: error instanceof UnauthorizedError ? "needsAuth" : "error", statusDetail: localHttpFailure(error), tools: [] };
      } finally { await connection.close(); }
    })));
  }
  async executeTool(args: { readonly serverIdentifier: string; readonly toolName: string; readonly args: unknown }): Promise<McpResult> {
    const row = this.rows().find(item => item.name === args.serverIdentifier);
    if (row == null) return generatedMcpResultFactory.error("Local HTTP MCP server is not configured.");
    return this.serial(row.config.url, async () => {
      const connection = this.connection(row);
      try {
        const parameters = z.record(z.unknown()).parse(args.args ?? {});
        await connection.connect();
        const result = await connection.client.callTool({ name: args.toolName, arguments: parameters }, CallToolResultSchema, { timeout: LOCAL_HTTP_TIMEOUT_MS });
        return localMcpToolResult(CallToolResultSchema.parse(result));
      } catch (error) { return generatedMcpResultFactory.error(localHttpFailure(error)); }
      finally { await connection.close(); }
    });
  }
  async checkAuthStatus(args: { readonly serverId: string | number; readonly accountKey: string; readonly forceReauth?: boolean | undefined }) {
    const row = this.row(args.serverId);
    // "添加其他账户"/rename flow: the requested label becomes the display name of the single slot.
    if (args.accountKey !== STORAGE_ACCOUNT_KEY) await this.writeLabel(row.config.url, args.accountKey);
    return this.serial(row.config.url, async () => {
      for (const [state, pending] of this.pending) {
        if (pending.expiresAt <= Date.now() || args.forceReauth && pending.serverIdentifier === row.name) { this.pending.delete(state); await pending.connection.close(); }
        else if (pending.serverIdentifier === row.name && pending.url === row.config.url) return { isAvailable: true, requiresAuth: true, hasValidToken: false, authUrl: pending.connection.provider.authorizationUrl, error: "" };
      }
      const connection = this.connection(row, true);
      if (args.forceReauth) await connection.provider.invalidateCredentials("tokens");
      try {
        if (GOOGLE_HOSTED_AUTH.has(row.config.url) && await connection.provider.tokens() == null) {
          await auth(connection.provider, { serverUrl: row.config.url, scope: GOOGLE_HOSTED_AUTH.get(row.config.url)!, fetchFn: localMcpFetch });
          if (connection.provider.authorizationUrl != null) throw new UnauthorizedError();
        }
        await connection.connect();
        return { isAvailable: true, requiresAuth: false, hasValidToken: true, authUrl: "", error: "" };
      } catch (error) {
        const authUrl = connection.provider.authorizationUrl;
        if (error instanceof UnauthorizedError && authUrl != null) {
          this.pending.set(connection.provider.stateId, { connection, serverIdentifier: row.name, url: row.config.url, expiresAt: Date.now() + 15 * 60_000 });
          return { isAvailable: true, requiresAuth: true, hasValidToken: false, authUrl, error: "" };
        }
        return { isAvailable: false, requiresAuth: error instanceof UnauthorizedError, hasValidToken: false, authUrl: "", error: localHttpFailure(error) };
      } finally { if (!this.pending.has(connection.provider.stateId)) await connection.close(); }
    });
  }
  async completeOAuth(args: { readonly stateId: string; readonly code: string }): Promise<void> {
    const pending = this.pending.get(args.stateId);
    this.pending.delete(args.stateId);
    if (pending == null) throw new SandMcpConfigError("OAuth request is unknown or already completed. Connect again.");
    try {
      if (pending.expiresAt <= Date.now() || !this.rows().some(row => row.name === pending.serverIdentifier && row.config.url === pending.url)) throw new SandMcpConfigError("OAuth request expired or connector changed. Connect again.");
      await this.serial(pending.url, () => pending.connection.transport.finishAuth(args.code));
    } finally { await pending.connection.close(); }
  }
  async validateTokens(targets: readonly { serverUrl: string; accountKey: string }[]) {
    return Promise.all(targets.map(async target => ({ ...target, hasValidToken: (await this.credentials.read(target.serverUrl, STORAGE_ACCOUNT_KEY)).tokens != null })));
  }
  async logoutAccount(args: { readonly serverUrl: string; readonly accountKey: string }): Promise<void> {
    for (const [state, pending] of this.pending) if (pending.url === args.serverUrl) { this.pending.delete(state); await pending.connection.close(); }
    await this.serial(args.serverUrl, () => this.credentials.update(args.serverUrl, STORAGE_ACCOUNT_KEY, value => ({ client: value.client, ...(value.label == null ? {} : { label: value.label }) })));
  }
  // Removing the account also clears its display label: the row falls back to the plain default
  // slot, matching the marketplace "移除 <account> 账户" expectation.
  async deleteAccount(args: { readonly serverId: string | number; readonly accountKey: string }): Promise<void> {
    const serverUrl = this.row(args.serverId).config.url;
    for (const [state, pending] of this.pending) if (pending.url === serverUrl) { this.pending.delete(state); await pending.connection.close(); }
    await this.serial(serverUrl, () => this.credentials.update(serverUrl, STORAGE_ACCOUNT_KEY, value => ({ client: value.client })));
  }
  async renameAccount(args: { readonly serverId: string | number; readonly accountKey: string; readonly newAccountKey: string }): Promise<void> {
    await this.writeLabel(this.row(args.serverId).config.url, args.newAccountKey);
  }
  private async writeLabel(serverUrl: string, rawLabel: string): Promise<void> {
    const label = rawLabel.trim();
    if (label.length === 0 || label === STORAGE_ACCOUNT_KEY) throw new SandMcpConfigError("MCP account label is required.");
    await this.credentials.update(serverUrl, STORAGE_ACCOUNT_KEY, value => ({ ...value, label }));
  }
  async configureClient(args: { readonly serverUrl: string; readonly clientId: string; readonly clientSecret: string }): Promise<void> {
    if (!this.rows().some(row => row.config.url === args.serverUrl)) throw new SandMcpConfigError("Configure the connector before its OAuth client.");
    await this.logoutAccount({ serverUrl: args.serverUrl, accountKey: "default" });
    await this.credentials.update(args.serverUrl, "default", () => ({ client: { client_id: args.clientId.trim(), client_secret: args.clientSecret.trim() } }));
  }
  async control(raw: unknown): Promise<unknown> {
    const request = localHttpRequestSchema.parse(raw);
    switch (request.operation) {
      case "configure": return this.configureClient(request);
      case "list": return this.listTools(request.identifiers);
      case "execute": return (await this.executeTool(request)).toJson();
      case "authenticate": return this.checkAuthStatus(request);
      case "complete": return this.completeOAuth(request);
      case "validate": return this.validateTokens(request.targets);
      case "logout": return this.logoutAccount(request);
      case "delete-account": return this.deleteAccount(request);
      case "rename": return this.renameAccount(request);
    }
  }
  async dispose(): Promise<void> {
    const pending = [...this.pending.values()]; this.pending.clear();
    await Promise.all(pending.map(item => item.connection.close()));
    await Promise.allSettled(this.work.values());
  }
}
