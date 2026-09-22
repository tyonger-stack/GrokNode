import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

export async function startLocalHttpMcpFixture() {
  const codes = new Map(), accessTokens = new Set(), refreshTokens = new Set();
  const counts = { registrations: 0, exchanges: 0, refreshes: 0, calls: 0 };
  let origin;
  const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const tokens = () => { const access_token = randomUUID(), refresh_token = randomUUID(); accessTokens.add(access_token); refreshTokens.add(refresh_token); return { access_token, refresh_token, token_type: "Bearer", expires_in: 3600 }; };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      let body = ""; for await (const chunk of req) body += chunk;
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return json(res, 200, { resource: origin + "/mcp", authorization_servers: [origin], scopes_supported: ["test.read"] });
      if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) return json(res, 200, { issuer: origin, authorization_endpoint: origin + "/authorize", token_endpoint: origin + "/token", registration_endpoint: origin + "/register", response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"] });
      if (url.pathname === "/register") { counts.registrations++; return json(res, 201, { ...JSON.parse(body), client_id: "fixture-client" }); }
      if (url.pathname === "/authorize") {
        if (url.searchParams.get("code_challenge_method") !== "S256") return json(res, 400, { error: "PKCE required" });
        const code = randomUUID(); codes.set(code, url.searchParams.get("code_challenge"));
        const redirect = new URL(url.searchParams.get("redirect_uri"));
        redirect.searchParams.set("code", code); redirect.searchParams.set("state", url.searchParams.get("state"));
        res.writeHead(302, { location: redirect.toString() }); res.end(); return;
      }
      if (url.pathname === "/token") {
        const form = new URLSearchParams(body);
        if (form.get("grant_type") === "refresh_token") {
          const token = form.get("refresh_token");
          if (!refreshTokens.delete(token)) return json(res, 400, { error: "invalid_grant" });
          counts.refreshes++; return json(res, 200, tokens());
        }
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url"), code = form.get("code");
        if (!codes.has(code) || codes.get(code) !== challenge) return json(res, 400, { error: "invalid_grant" });
        codes.delete(code); counts.exchanges++; return json(res, 200, tokens());
      }
      if (url.pathname !== "/mcp") return json(res, 404, {});
      if (!accessTokens.has(req.headers.authorization?.replace(/^Bearer /, ""))) {
        res.setHeader("www-authenticate", 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource/mcp"');
        return json(res, 401, { error: "invalid_token" });
      }
      if (req.method !== "POST") return json(res, 405, {});
      const message = JSON.parse(body);
      if (message.id == null) { res.writeHead(202); res.end(); return; }
      const reply = result => json(res, 200, { jsonrpc: "2.0", id: message.id, result });
      if (message.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "local-oauth-fixture", version: "1.0" } });
      if (message.method === "tools/list") {
        const page = message.params?.cursor === "second";
        const result = { tools: [{ name: page ? "read_second" : "read_first", inputSchema: { type: "object", properties: {} } }], ...(page ? {} : { nextCursor: "second" }) };
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end("event: message\ndata: " + JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n\n"); return;
      }
      if (message.method === "tools/call") { counts.calls++; return reply({ content: [{ type: "text", text: "local HTTP executed " + message.params.name }], structuredContent: { ok: true } }); }
      return json(res, 400, { error: "unexpected method" });
    } catch (error) { json(res, 500, { error: error.message }); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  return { url: origin + "/mcp", counts, expire: () => accessTokens.clear(), close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
