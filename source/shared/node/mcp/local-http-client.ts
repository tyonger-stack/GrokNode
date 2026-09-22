import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Struct } from "@bufbuild/protobuf";
import { McpImageContent, McpResult, McpSuccess, McpToolResultContentItem } from "../../../packages/proto/generated/agent/v1/mcp_exec_pb.js";
import { generatedMcpResultFactory } from "./mcp-result-factory.js";
import type { McpServerConfig } from "./mcp-display-runtime.js";
import type { LocalHttpOAuth } from "./local-http-oauth.js";
import { SandMcpConfigError } from "./mcp-config-error.js";

export type HttpMcpConfig = Extract<McpServerConfig, { url: string }>;
export const LOCAL_HTTP_TIMEOUT_MS = 30_000;

// No retries here: a timed-out tool call may already have changed external data.
export const localMcpFetch: FetchLike = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new SandMcpConfigError("MCP connections require HTTPS (HTTP is allowed for localhost).");
  }
  return fetch(input, { ...init, redirect: "error", signal: AbortSignal.any([
    AbortSignal.timeout(LOCAL_HTTP_TIMEOUT_MS), ...(init?.signal == null ? [] : [init.signal]),
  ]) });
};

export function createLocalHttpClient(config: HttpMcpConfig, provider: LocalHttpOAuth) {
  const client = new Client({ name: "grok-node", version: "0.18.0" });
  const options = { authProvider: provider, fetch: localMcpFetch, requestInit: { headers: config.headers ?? {} } };
  const transport = config.type === "sse"
    ? new SSEClientTransport(new URL(config.url), options)
    : new StreamableHTTPClientTransport(new URL(config.url), options);
  const wire: Transport = {
    start: () => transport.start(), send: (message, options) => transport instanceof StreamableHTTPClientTransport ? transport.send(message, options) : transport.send(message), close: () => transport.close(),
    setProtocolVersion: version => { if (transport instanceof StreamableHTTPClientTransport) transport.setProtocolVersion(version); },
  };
  transport.onclose = () => wire.onclose?.();
  transport.onerror = error => wire.onerror?.(error);
  transport.onmessage = message => wire.onmessage?.(message);
  return {
    client, transport, provider,
    connect: () => client.connect(wire, { timeout: LOCAL_HTTP_TIMEOUT_MS }),
    close: () => transport.close(),
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
