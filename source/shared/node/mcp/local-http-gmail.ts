import type { PluginVariableField } from "./mcp-plugin-variables.js";

export const GMAIL_MCP_URL = "https://gmailmcp.googleapis.com/mcp/v1";
export const GMAIL_MCP_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const GMAIL_LOCAL_OAUTH_FIELDS: PluginVariableField[] = [
  { key: "GOOGLE_CLIENT_ID", label: "Google OAuth client ID", placeholder: "…apps.googleusercontent.com", isRequired: true, isSecret: false, hint: "Use your own Google OAuth Desktop app client with the Gmail API enabled." },
  { key: "GOOGLE_CLIENT_SECRET", label: "Google OAuth client secret", placeholder: "Client secret", isRequired: true, isSecret: true, hint: "Saved in the local VM credential store. You will authorize your Google account in your browser." },
];
