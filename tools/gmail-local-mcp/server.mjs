import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

const TOKEN_FILE = process.env.GMAIL_MCP_TOKEN_FILE?.trim();
const TOKEN = (process.env.GMAIL_MCP_TOKEN ?? (TOKEN_FILE ? readFileSync(TOKEN_FILE, "utf8") : "")).trim();
const CREDENTIALS = process.env.GMAIL_MCP_CREDENTIALS ?? "/home/box/sand-data/gmail-local-mcp/credentials.json";
const PORT = Number(process.env.PORT ?? 8788);
const MAX_BODY = 1_000_000;
const GMAIL_BASE = (process.env.GMAIL_API_BASE ?? "https://gmail.googleapis.com/gmail/v1/users/me").replace(/\/$/, "");
const OAUTH_TOKEN_URL = process.env.GMAIL_OAUTH_TOKEN_URL ?? "https://oauth2.googleapis.com/token";

if (TOKEN.length === 0) {
  console.error("[gmail-local-mcp] GMAIL_MCP_TOKEN is required");
  process.exit(1);
}

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: false });
const fail = (message) => ({ content: [{ type: "text", text: message }], isError: true });
const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description) => ({ type: "string", description });
const int = (description, minimum, maximum) => ({ type: "integer", description, minimum, maximum });

const tools = [
  {
    name: "gmail_get_profile",
    description: "Return the connected Gmail account profile, including the address and message/thread totals.",
    inputSchema: object({}),
  },
  {
    name: "gmail_search_threads",
    description: "Search Gmail threads with a Gmail search query, for example from:boss@example.com newer_than:2d.",
    inputSchema: object({ q: str("Gmail search query"), maxResults: int("Maximum threads to return", 1, 50) }, ["q"]),
  },
  {
    name: "gmail_get_thread",
    description: "Read one Gmail thread by id. Use format metadata when only headers and labels are needed.",
    inputSchema: object({
      id: str("Gmail thread id"),
      format: { type: "string", enum: ["full", "metadata", "minimal"], description: "Response format, default full" },
    }, ["id"]),
  },
  {
    name: "gmail_get_message",
    description: "Read one Gmail message by id.",
    inputSchema: object({
      id: str("Gmail message id"),
      format: { type: "string", enum: ["full", "metadata", "minimal"], description: "Response format, default full" },
    }, ["id"]),
  },
  {
    name: "gmail_list_labels",
    description: "List Gmail labels and their ids.",
    inputSchema: object({}),
  },
  {
    name: "gmail_list_drafts",
    description: "List Gmail drafts without sending them.",
    inputSchema: object({ maxResults: int("Maximum drafts to return", 1, 50) }),
  },
  {
    name: "gmail_get_draft",
    description: "Read one Gmail draft by id.",
    inputSchema: object({
      id: str("Gmail draft id"),
      format: { type: "string", enum: ["full", "metadata", "minimal"], description: "Response format, default full" },
    }, ["id"]),
  },
  {
    name: "gmail_create_draft",
    description: "Create a Gmail draft. This never sends mail. Provide threadId to keep a reply in its thread.",
    inputSchema: object({
      to: str("Recipient address"),
      subject: str("Subject line"),
      body: str("Plain-text body"),
      cc: str("Optional Cc addresses"),
      bcc: str("Optional Bcc addresses"),
      threadId: str("Optional Gmail thread id for a reply"),
      inReplyTo: str("Optional Message-ID of the message being replied to"),
      references: str("Optional References header"),
    }, ["to", "subject", "body"]),
  },
];
const byName = new Map(tools.map((tool) => [tool.name, tool]));

let credentialsCache;
let accessToken;
let accessExpiresAt = 0;

async function credentials() {
  if (credentialsCache === undefined) {
    credentialsCache = JSON.parse(await readFile(CREDENTIALS, "utf8"));
  }
  return credentialsCache;
}

async function gmailToken() {
  if (accessToken !== undefined && Date.now() < accessExpiresAt) return accessToken;
  const value = await credentials();
  const body = new URLSearchParams({
    client_id: value.client.client_id,
    client_secret: value.client.client_secret,
    refresh_token: value.tokens.refresh_token,
    grant_type: "refresh_token",
  });
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json();
  if (!response.ok || typeof data.access_token !== "string") {
    throw new Error("OAuth refresh failed: " + (data.error_description ?? data.error ?? String(response.status)));
  }
  accessToken = data.access_token;
  accessExpiresAt = Date.now() + Math.max(60, Number(data.expires_in ?? 3600) - 60) * 1000;
  return accessToken;
}

async function gmail(path, init = {}) {
  const request = async (token) => fetch(GMAIL_BASE + path, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: "Bearer " + token },
    signal: AbortSignal.timeout(25_000),
  });
  let response = await request(await gmailToken());
  if (response.status === 401) {
    accessToken = undefined;
    accessExpiresAt = 0;
    response = await request(await gmailToken());
  }
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  if (!response.ok) {
    const detail = data?.error?.message ?? raw.slice(0, 500);
    throw new Error("Gmail " + response.status + ": " + detail);
  }
  return data;
}

function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function clamp(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function format(value) {
  return value === "metadata" || value === "minimal" ? value : "full";
}

function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function mime(input) {
  const lines = [
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "To: " + clean(input.to, 1000),
    "Subject: " + clean(input.subject, 500),
  ];
  if (input.cc) lines.push("Cc: " + clean(input.cc, 1000));
  if (input.bcc) lines.push("Bcc: " + clean(input.bcc, 1000));
  if (input.inReplyTo) lines.push("In-Reply-To: " + clean(input.inReplyTo, 1000));
  if (input.references) lines.push("References: " + clean(input.references, 4000));
  return lines.join("\r\n") + "\r\n\r\n" + String(input.body ?? "");
}

async function callTool(name, args) {
  switch (name) {
    case "gmail_get_profile":
      return text(await gmail("/profile"));
    case "gmail_search_threads": {
      const query = clean(args.q, 1000);
      if (query.length === 0) throw new Error("q is required");
      const max = clamp(args.maxResults, 10, 1, 50);
      return text(await gmail("/threads?q=" + encodeURIComponent(query) + "&maxResults=" + max));
    }
    case "gmail_get_thread":
      return text(await gmail("/threads/" + encodeURIComponent(clean(args.id, 128)) + "?format=" + format(args.format)));
    case "gmail_get_message":
      return text(await gmail("/messages/" + encodeURIComponent(clean(args.id, 128)) + "?format=" + format(args.format)));
    case "gmail_list_labels":
      return text(await gmail("/labels"));
    case "gmail_list_drafts": {
      const max = clamp(args.maxResults, 10, 1, 50);
      return text(await gmail("/drafts?maxResults=" + max));
    }
    case "gmail_get_draft":
      return text(await gmail("/drafts/" + encodeURIComponent(clean(args.id, 128)) + "?format=" + format(args.format)));
    case "gmail_create_draft": {
      const message = { raw: base64url(mime(args)) };
      if (typeof args.threadId === "string" && args.threadId.trim().length > 0) message.threadId = clean(args.threadId, 128);
      return text(await gmail("/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      }));
    }
    default:
      throw new Error("Unknown tool: " + name);
  }
}

async function dispatch(message) {
  const method = message?.method;
  const params = message?.params ?? {};
  if (method === "initialize") {
    return {
      protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "gmail-local", version: "1.0.0" },
    };
  }
  if (method === "tools/list") return { tools };
  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    if (!byName.has(name)) return fail("Unknown tool: " + name);
    try {
      return await callTool(name, params.arguments ?? {});
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
  if (method === "ping") return {};
  throw new Error("Unknown method: " + String(method));
}

function respond(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    respond(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/mcp") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": gmail-local-mcp\n\n");
    const timer = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => clearInterval(timer));
    return;
  }
  if (req.method === "DELETE" && url.pathname === "/mcp") {
    respond(res, 200, { ok: true });
    return;
  }
  if (req.method !== "POST" || url.pathname !== "/mcp") {
    respond(res, 404, { error: "not found" });
    return;
  }
  if (req.headers.authorization !== "Bearer " + TOKEN) {
    respond(res, 401, { error: "unauthorized" });
    return;
  }
  let body = "";
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > MAX_BODY) {
      respond(res, 413, { error: "request body too large" });
      return;
    }
  }
  let message;
  try {
    message = JSON.parse(body);
  } catch {
    respond(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (message?.method === "notifications/initialized") {
    res.writeHead(202).end();
    return;
  }
  if (message?.method === "initialize") res.setHeader("mcp-session-id", "gmail-local");
  try {
    respond(res, 200, { jsonrpc: "2.0", id: message?.id ?? null, result: await dispatch(message) });
  } catch (error) {
    respond(res, 200, {
      jsonrpc: "2.0",
      id: message?.id ?? null,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log("[gmail-local-mcp] listening on 127.0.0.1:" + PORT));
