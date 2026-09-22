# Local HTTP MCP connectors

Implemented on September 22, 2026. HTTP/SSE MCP clients run in the local VM.
Cursor authentication is not used for connector execution or OAuth.
The marketplace catalog remains the existing public catalog.

## Connecting after rebuilding the app

- Notion: Add the plugin, open its installed connector, then Authenticate.
  Choose the workspace and approve access in the browser.
- Gmail: Add Gmail in Marketplace and enter your own Google OAuth Desktop
  application client ID and client secret in the setup form. Then open the
  installed connector and Authenticate. Existing entries can be configured
  through Marketplace Add. Do not paste the secret into a conversation.

The Gmail endpoint advertises Google as its authorization server. Google does
not advertise dynamic client registration. The implementation uses a client
owned by the user, PKCE S256, the Gmail modify scope and offline access. The
desktop callback is `http://localhost:8787/callback`.

## Runtime and storage

Desktop settings synchronize local connector definitions to the VM on startup,
reconnection and connector operations. Connections, discovery, tool calls,
token exchange and refresh run in the host. The desktop owns the loopback
callback and forwards code/state over the existing authenticated gateway.

Credentials live in `local-mcp-credentials/` under the VM data root, separate
from settings. Files are keyed by a hash of endpoint/account, written atomically
with mode 0600 in a mode 0700 directory. This is filesystem permission protection,
not macOS Keychain encryption. Secrets are not returned by the control API.
PKCE verifiers and pending states remain in memory and expire after 15 minutes;
restarting during authorization requires a new attempt. Removing a connector
clears its account tokens.

Each connector supports one default account. Additional account labels are
rejected explicitly. HTTP timeouts do not replay tool operations. The MCP SDK
may refresh rejected OAuth credentials as part of authentication.

## Verification

- `tests/local-http-mcp-routing.test.mjs`: status routing, host settings, Gmail
  setup and separation of client secrets from settings.
- `tests/local-http-mcp-oauth.test.mjs`: real HTTP fixture and desktop callback;
  PKCE, discovery pagination/SSE replies, tool execution, persistence/refresh,
  wrong/replayed state, endpoint changes, disabled tools and token removal.
- Live endpoints: Gmail and Notion report needsAuth without credentials.
  Notion dynamically registers and returns its real authorization URL. Gmail
  returns the explicit client-setup requirement.
- Host and Electron production bundles compile using the regular production
  validation to `.cache/local-http-mcp-validation`.

Real account access still requires browser authorization. The tests do not
claim a user account is connected. This side task does not replace the installed
app or overwrite the main task's package output.
