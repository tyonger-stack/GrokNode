import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const directory = await mkdtemp(join(tmpdir(), "gmail-local-mcp-"));
const credentialsPath = join(directory, "credentials.json");
const token = "test-token";
await writeFile(credentialsPath, JSON.stringify({
  client: { client_id: "test-client", client_secret: "test-secret" },
  tokens: { refresh_token: "test-refresh" },
}));

const calls = [];
const mock = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  calls.push({ method: request.method, path: url.pathname });
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/token") return send(200, { access_token: "test-access", expires_in: 3600 });
  if (url.pathname.endsWith("/profile")) return send(200, { emailAddress: "test@example.com", messagesTotal: 3, threadsTotal: 2 });
  if (url.pathname.endsWith("/labels")) return send(200, { labels: [{ id: "INBOX", name: "INBOX" }] });
  if (url.pathname.endsWith("/drafts") && request.method === "POST") return send(200, { id: "draft-1", message: { id: "message-1" } });
  return send(404, { error: { message: "not found" } });
});
await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
const mockUrl = "http://127.0.0.1:" + mock.address().port;

const port = 19000 + Math.floor(Math.random() * 1000);
const serverPath = new URL("./server.mjs", import.meta.url).pathname;
const child = spawn(process.execPath, [serverPath], {
  env: {
    ...process.env,
    GMAIL_MCP_TOKEN: token,
    GMAIL_MCP_CREDENTIALS: credentialsPath,
    GMAIL_API_BASE: mockUrl + "/gmail/v1/users/me",
    GMAIL_OAUTH_TOKEN_URL: mockUrl + "/token",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

test.after(async () => {
  child.kill("SIGTERM");
  mock.close();
  await rm(directory, { recursive: true, force: true });
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not start: " + stderr);
}

async function rpc(method, params = {}) {
  const response = await fetch("http://127.0.0.1:" + port + "/mcp", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(response.status, 200);
  return await response.json();
}

test("initialize and tools/list expose read and draft tools only", async () => {
  await waitForHealth();
  const init = await rpc("initialize", { protocolVersion: "2025-03-26" });
  assert.equal(init.result.serverInfo.name, "gmail-local");
  const list = await rpc("tools/list");
  const names = list.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("gmail_search_threads"));
  assert.ok(names.includes("gmail_create_draft"));
  assert.ok(!names.some((name) => /send|delete|trash|spam/.test(name)));
});

test("profile uses the standard Gmail API and stored refresh token", async () => {
  const result = await rpc("tools/call", { name: "gmail_get_profile", arguments: {} });
  assert.equal(result.result.isError, false);
  assert.equal(JSON.parse(result.result.content[0].text).messagesTotal, 3);
  assert.ok(calls.some((call) => call.path === "/token"));
  assert.ok(calls.some((call) => call.path.endsWith("/profile")));
});

test("create draft never calls a send endpoint", async () => {
  const result = await rpc("tools/call", { name: "gmail_create_draft", arguments: { to: "a@example.com", subject: "Hi", body: "Body" } });
  assert.equal(result.result.isError, false);
  assert.equal(JSON.parse(result.result.content[0].text).id, "draft-1");
  assert.ok(calls.some((call) => call.method === "POST" && call.path.endsWith("/drafts")));
  assert.ok(!calls.some((call) => call.path.endsWith("/send")));
});

test("unknown tools fail closed", async () => {
  const result = await rpc("tools/call", { name: "gmail_send_email", arguments: {} });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /Unknown tool/);
});
