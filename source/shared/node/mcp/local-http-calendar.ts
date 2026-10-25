import type { PluginVariableField } from "./mcp-plugin-variables.js";

export const CALENDAR_MCP_URL = "https://calendarmcp.googleapis.com/mcp/v1";
// Official connector scopes (0.75.8 electron-main main-app.cjs, hosted-Google map entry for
// calendarmcp.googleapis.com). Google's hosted MCP rejects any other scope combination.
export const CALENDAR_MCP_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];
export const CALENDAR_LOCAL_OAUTH_FIELDS: PluginVariableField[] = [
  { key: "GOOGLE_CLIENT_ID", label: "Google OAuth client ID", placeholder: "…apps.googleusercontent.com", isRequired: true, isSecret: false, hint: "Use your own Google OAuth Desktop app client. The same client you registered for Gmail works for Google Calendar." },
  { key: "GOOGLE_CLIENT_SECRET", label: "Google OAuth client secret", placeholder: "Client secret", isRequired: true, isSecret: true, hint: "Saved in the local VM credential store. You will authorize your Google account in your browser." },
];
