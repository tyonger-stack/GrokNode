import { randomBytes } from "node:crypto";

/** In-memory session tokens, each bound to one service-issued credential. */
export class LibraryHttpSessions {
  private readonly tokens = new Map<string, { readonly credential: string; readonly createdAtMs: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = 12 * 3600 * 1000,
  ) {}

  get size(): number {
    return this.tokens.size;
  }

  create(credential: string): string {
    this.prune();
    const token = randomBytes(32).toString("base64url");
    this.tokens.set(token, { credential, createdAtMs: this.now() });
    return token;
  }

  credentialFor(token: string): string | null {
    const session = this.tokens.get(token);
    if (session === undefined) return null;
    if (this.now() - session.createdAtMs > this.ttlMs) {
      this.tokens.delete(token);
      return null;
    }
    return session.credential;
  }

  destroy(token: string): void {
    this.tokens.delete(token);
  }

  clear(): void {
    this.tokens.clear();
  }

  private prune(): void {
    const now = this.now();
    for (const [token, session] of this.tokens) {
      if (now - session.createdAtMs > this.ttlMs) this.tokens.delete(token);
    }
  }
}
