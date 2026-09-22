import { z } from "zod";
import { McpResult } from "../../../packages/proto/generated/agent/v1/mcp_exec_pb.js";
import { SandMcpConfigError } from "./mcp-config-error.js";

const toolSchema = z.object({ name: z.string(), providerIdentifier: z.string(), toolName: z.string(), clientKey: z.string(), description: z.string().optional(), inputSchema: z.record(z.unknown()).optional() });
const serverSchema = z.object({ serverIdentifier: z.string(), rowServerIdentifier: z.string(), accountLabel: z.string(), status: z.enum(["connected", "needsAuth", "error"]), statusDetail: z.string().optional(), tools: z.array(toolSchema) });
const authSchema = z.object({ isAvailable: z.boolean(), requiresAuth: z.boolean(), hasValidToken: z.boolean(), authUrl: z.string(), error: z.string() });
const tokenStatusSchema = z.array(z.object({ serverUrl: z.string(), accountKey: z.string(), hasValidToken: z.boolean() }));
export type LocalHttpRequest = (request: Readonly<Record<string, unknown>>) => Promise<unknown>;

export function createLocalHttpMcpProxy(call: LocalHttpRequest) {
  return {
    async configureClient(args: { readonly serverUrl: string; readonly clientId: string; readonly clientSecret: string }): Promise<void> { await call({ ...args, operation: "configure" }); },
    async listTools(identifiers: readonly string[]) { return z.array(serverSchema).parse(await call({ operation: "list", identifiers })); },
    async executeTool(args: { readonly serverIdentifier: string; readonly toolName: string; readonly args: unknown }) { return McpResult.fromJsonString(JSON.stringify(await call({ ...args, operation: "execute" }))); },
    async checkAuthStatus(args: { readonly serverId: string | number; readonly accountKey: string; readonly oauthRedirectUri: string; readonly forceReauth?: boolean }) { return authSchema.parse(await call({ ...args, serverId: String(args.serverId), operation: "authenticate" })); },
    async completeOAuth(args: { readonly stateId: string; readonly code: string }): Promise<void> { await call({ ...args, operation: "complete" }); },
    async validateTokens(targets: readonly { serverUrl: string; accountKey: string }[]) { return tokenStatusSchema.parse(await call({ operation: "validate", targets })); },
    async logoutAccount(args: { readonly serverUrl: string; readonly accountKey: string }): Promise<void> { await call({ ...args, operation: "logout" }); },
    async deleteAccount(args: { readonly serverId: string | number; readonly accountKey: string }): Promise<void> { await call({ ...args, serverId: String(args.serverId), operation: "delete-account" }); },
    async renameAccount(): Promise<never> { throw new SandMcpConfigError("Local connectors currently support one default account. Reconnect to switch accounts."); },
  };
}
