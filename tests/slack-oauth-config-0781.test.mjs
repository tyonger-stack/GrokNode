import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));

async function load() {
  const output = path.join(root, "node_modules/.cache/slack-oauth-0781.cjs");
  await build({
    stdin: {
      contents: [
        'export { localHttpRequestSchema } from "./source/shared/node/mcp/local-http-exec.ts";',
        'export { SLACK_MCP_URL, SLACK_MCP_SCOPES, SLACK_LOCAL_OAUTH_FIELDS } from "./source/shared/node/mcp/local-http-slack.ts";',
        'export { GMAIL_MCP_URL } from "./source/shared/node/mcp/local-http-gmail.ts";',
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    logLevel: "error",
  });
  return createRequire(import.meta.url)(output);
}

test("configure operation accepts the Slack MCP URL with client credentials", async () => {
  const mod = await load();
  const parsed = mod.localHttpRequestSchema.safeParse({
    operation: "configure", serverUrl: mod.SLACK_MCP_URL, clientId: "1234.app-slack", clientSecret: "synthetic-secret",
  });
  assert.equal(parsed.success, true, "slack URL must pass the configure whitelist");
});

test("configure operation still rejects URLs outside the whitelist", async () => {
  const mod = await load();
  const parsed = mod.localHttpRequestSchema.safeParse({
    operation: "configure", serverUrl: "https://mcp.evil.example/mcp", clientId: "x", clientSecret: "y",
  });
  assert.equal(parsed.success, false);
});

test("slack scopes equal the mcp.slack.com metadata scopes_supported", async () => {
  const mod = await load();
  assert.equal(mod.SLACK_MCP_SCOPES[0], "canvases:read");
  assert.equal(mod.SLACK_MCP_SCOPES.at(-1), "users:read.email");
  assert.ok(mod.SLACK_MCP_SCOPES.includes("chat:write"));
  assert.ok(mod.SLACK_MCP_SCOPES.includes("channels:history"));
});

test("slack oauth fields mirror the Gmail variable-field contract", async () => {
  const mod = await load();
  assert.equal(mod.SLACK_LOCAL_OAUTH_FIELDS.length, 2);
  const [id, secret] = mod.SLACK_LOCAL_OAUTH_FIELDS;
  assert.equal(id.key, "SLACK_CLIENT_ID");
  assert.equal(id.isRequired, true);
  assert.equal(id.isSecret, false);
  assert.equal(secret.key, "SLACK_CLIENT_SECRET");
  assert.equal(secret.isRequired, true);
  assert.equal(secret.isSecret, true);
  // The user-facing setup hint names the loopback callback the local OAuth server serves.
  assert.match(id.hint, /localhost:8787\/callback/);
});
