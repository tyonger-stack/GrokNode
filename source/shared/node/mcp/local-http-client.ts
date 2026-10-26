import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ElicitRequestSchema, type CallToolResult, type ElicitRequest, type ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { Struct } from "@bufbuild/protobuf";
import { McpImageContent, McpResult, McpSuccess, McpToolResultContentItem } from "../../../packages/proto/generated/agent/v1/mcp_exec_pb.js";
import { generatedMcpResultFactory } from "./mcp-result-factory.js";
import type { McpServerConfig } from "./mcp-display-runtime.js";
import type { LocalHttpOAuth } from "./local-http-oauth.js";
import { SandMcpConfigError } from "./mcp-config-error.js";

export type HttpMcpConfig = Extract<McpServerConfig, { url: string }>;
export const LOCAL_HTTP_TIMEOUT_MS = 30_000;
export const LOCAL_HTTP_ELICITATION_TIMEOUT_MS = 10 * 60_000;
export type LocalMcpElicitationHandler = (request: ElicitRequest["params"], signal: AbortSignal) => Promise<ElicitResult>;

// No retries here: a timed-out tool call may already have changed external data.
async function localMcpFetchWithin(input: Parameters<FetchLike>[0], init: Parameters<FetchLike>[1], timeoutMs: number) {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new SandMcpConfigError("MCP connections require HTTPS (HTTP is allowed for localhost).");
  }
  const response = await fetch(input, { ...init, redirect: "error", signal: AbortSignal.any([
    AbortSignal.timeout(timeoutMs), ...(init?.signal == null ? [] : [init.signal]),
  ]) });
  return repairGoogleHostedMcpStatus(url, response);
}
export const localMcpFetch: FetchLike = (input, init) => localMcpFetchWithin(input, init, LOCAL_HTTP_TIMEOUT_MS);

// Google's hosted MCP gateways (gmailmcp/calendarmcp/….googleapis.com, observed 2026-10-25 on
// calendarmcp) answer tools/list and tool calls with HTTP 403 while the body carries a VALID
// JSON-RPC result — the official client's own transport accepts it, the OSS SDK does not.
// Retry-free, scoped to those hosts: only a 403 whose body is a JSON-RPC result without an
// error member is surfaced as 200; everything else passes through untouched.
async function repairGoogleHostedMcpStatus(url: URL, response: Response): Promise<Response> {
  if (response.status !== 403 || !url.hostname.endsWith(".googleapis.com")) return response;
  const body = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return new Response(body, response); }
  const record = parsed != null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  if (record == null || record.jsonrpc !== "2.0" || !("result" in record) || "error" in record) return new Response(body, response);
  return new Response(body, { status: 200, statusText: "OK", headers: { "Content-Type": "application/json" } });
}

export function createLocalHttpClient(config: HttpMcpConfig, provider: LocalHttpOAuth, elicitation?: LocalMcpElicitationHandler) {
  const closed = new AbortController();
  const client = new Client({ name: "grok-node", version: "0.18.0" }, { capabilities: elicitation === undefined ? {} : { elicitation: { form: {} } } });
  if (elicitation !== undefined) client.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
    const params = request.params;
    if (params.mode === "url" || Object.keys(params.requestedSchema.properties).length !== 0 || (params.requestedSchema.required?.length ?? 0) !== 0 || params.message.length > 16000) return { action: "decline" };
    const signal = AbortSignal.any([extra.signal, closed.signal]);
    if (signal.aborted) return { action: "cancel" };
    return elicitation(params, signal);
  });
  const options = { authProvider: provider, fetch: elicitation === undefined ? localMcpFetch : (input: Parameters<FetchLike>[0], init: Parameters<FetchLike>[1]) => localMcpFetchWithin(input, init, LOCAL_HTTP_ELICITATION_TIMEOUT_MS), requestInit: { headers: config.headers ?? {} } };
  const transport = config.type === "sse"
    ? new SSEClientTransport(new URL(config.url), options)
    : new StreamableHTTPClientTransport(new URL(config.url), options);
  const wire: Transport = {
    start: () => transport.start(), send: (message, options) => transport instanceof StreamableHTTPClientTransport ? transport.send(message, options) : transport.send(message), close: () => transport.close(),
    setProtocolVersion: version => { if (transport instanceof StreamableHTTPClientTransport) transport.setProtocolVersion(version); },
  };
  transport.onclose = () => { closed.abort(); wire.onclose?.(); };
  transport.onerror = error => wire.onerror?.(error);
  transport.onmessage = message => wire.onmessage?.(message);
  return {
    client, transport, provider,
    connect: () => { if (closed.signal.aborted) throw new SandMcpConfigError("The MCP client has stopped."); return client.connect(wire, { timeout: LOCAL_HTTP_TIMEOUT_MS }); },
    close: () => { closed.abort(); return client.close(); },
  };
}

export function localMcpToolResult(result: CallToolResult): McpResult {
  const content = result.content.map(item => {
    switch (item.type) {
      case "text": return generatedMcpResultFactory.textItem(item.text);
      case "image": return new McpToolResultContentItem({ content: { case: "image", value: new McpImageContent({ data: Buffer.from(item.data, "base64"), mimeType: item.mimeType }) } });
      default: return generatedMcpResultFactory.textItem(JSON.stringify(item));
    }
  });
  return new McpResult({ result: { case: "success", value: new McpSuccess({
    content, isError: result.isError === true,
    ...(result.structuredContent == null ? {} : { structuredContent: Struct.fromJsonString(JSON.stringify(result.structuredContent)) }),
  }) } });
}
