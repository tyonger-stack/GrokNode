import type { PluginVariableField } from "./mcp-plugin-variables.js";

export const SLACK_MCP_URL = "https://mcp.slack.com/mcp";
// Authoritative scope set: mcp.slack.com authorization-server metadata scopes_supported
// (fetched 2026-10-31). The user's Slack app needs these enabled to authorize.
export const SLACK_MCP_SCOPES = [
  "canvases:read", "canvases:write", "channels:history", "channels:read", "channels:write",
  "chat:write", "emoji:read", "files:read", "files:write", "groups:history", "groups:read",
  "groups:write", "im:history", "im:read", "im:write", "lists:read", "lists:write",
  "mpim:history", "mpim:read", "mpim:write", "reactions:read", "reactions:write",
  "search:read.files", "search:read.im", "search:read.mpim", "search:read.private",
  "search:read.public", "search:read.users", "users:read", "users:read.email",
] as const;
// mcp.slack.com's authorization-server metadata carries no registration_endpoint
// (fetched 2026-10-31), so DCR is refused — the client must be pre-registered with Slack.
export const SLACK_LOCAL_OAUTH_FIELDS: PluginVariableField[] = [
  { key: "SLACK_CLIENT_ID", label: "Slack OAuth client ID", placeholder: "Slack app client ID", isRequired: true, isSecret: false, hint: "Use your own Slack app with redirect URL http://localhost:8787/callback and the MCP scopes you need." },
  { key: "SLACK_CLIENT_SECRET", label: "Slack OAuth client secret", placeholder: "Client secret", isRequired: true, isSecret: true, hint: "Saved in the local VM credential store. You will authorize your Slack workspace in your browser (token exchange uses client_secret_post)." },
];
