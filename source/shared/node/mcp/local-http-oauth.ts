import { randomBytes } from "node:crypto";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { MCP_OAUTH_LOOPBACK_CALLBACK_URL } from "./mcp-oauth-loopback.js";
import { LocalHttpCredentials } from "./local-http-credentials.js";
import { SandMcpConfigError } from "./mcp-config-error.js";
import { GMAIL_MCP_URL } from "./local-http-gmail.js";

export class LocalHttpOAuth implements OAuthClientProvider {
  readonly redirectUrl = MCP_OAUTH_LOOPBACK_CALLBACK_URL;
  readonly clientMetadata: OAuthClientMetadata = {
    client_name: "Grok Node",
    redirect_uris: [MCP_OAUTH_LOOPBACK_CALLBACK_URL],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  readonly stateId = randomBytes(32).toString("base64url");
  authorizationUrl: string | undefined;
  private verifier: string | undefined;
  constructor(private readonly options: {
    readonly serverUrl: string;
    readonly credentials: LocalHttpCredentials;
    readonly interactive: boolean;
  }) {}

  state(): string { return this.stateId; }
  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const { client } = await this.options.credentials.read(this.options.serverUrl, "default");
    if (client == null && !this.options.interactive) throw new UnauthorizedError();
    if (client == null && this.options.serverUrl === GMAIL_MCP_URL) throw new SandMcpConfigError("Gmail requires your registered Google OAuth client. Add Gmail again in Marketplace and enter its client ID and secret.");
    return client;
  }
  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
    await this.options.credentials.update(this.options.serverUrl, "default", value => ({ ...value, client }));
  }
  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.options.credentials.read(this.options.serverUrl, "default")).tokens;
  }
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.options.credentials.update(this.options.serverUrl, "default", value => ({ ...value, tokens: {
      ...tokens,
      ...(tokens.refresh_token == null && value.tokens?.refresh_token != null ? { refresh_token: value.tokens.refresh_token } : {}),
    } }));
  }
  redirectToAuthorization(url: URL): void {
    if (!this.options.interactive) throw new UnauthorizedError();
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) {
      throw new SandMcpConfigError("OAuth requires HTTPS or a local test server.");
    }
    if (this.options.serverUrl === GMAIL_MCP_URL) { url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent"); }
    this.authorizationUrl = url.toString();
  }
  saveCodeVerifier(verifier: string): void { this.verifier = verifier; }
  codeVerifier(): string {
    if (this.verifier == null) throw new SandMcpConfigError("OAuth request expired. Connect again.");
    return this.verifier;
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    switch (scope) {
      case "verifier": this.verifier = undefined; return;
      case "discovery": return;
      case "all": this.verifier = undefined; await this.options.credentials.update(this.options.serverUrl, "default", () => ({})); return;
      case "client": await this.options.credentials.update(this.options.serverUrl, "default", value => ({ tokens: value.tokens })); return;
      case "tokens": await this.options.credentials.update(this.options.serverUrl, "default", value => ({ client: value.client })); return;
    }
  }
}
