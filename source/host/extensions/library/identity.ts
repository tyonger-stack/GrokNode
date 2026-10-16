import type { DatabaseSync } from "node:sqlite";
import type { LibraryExecutionContext, LibraryOwner, LibraryPrincipal, LibraryRequestContext } from "../../../shared/library-contracts.js";
import { LibraryCatalogError } from "./migrations.js";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { transaction } from "./migrations.js";

export const identifier = z.string().min(1).max(512).refine(value => !/[\x00-\x1f]/.test(value));
const ownerSchema = z.object({ accountId: identifier, principalId: identifier, storeId: identifier, teamId: identifier.nullable() });

/** Host authority provisioning only. Never expose these methods through renderer RPC. */
export class CatalogIdentity {
  private readonly listeners = new Set<() => void>();
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(): void { for (const listener of this.listeners) listener(); }
  constructor(private readonly db: DatabaseSync, private readonly origin: string) {}
  dataVersion(): number { return z.number().parse(this.db.prepare("PRAGMA data_version").get()?.data_version); }
  createLocalPrincipal(accountId = `node-account:${randomUUID()}`): { readonly accountId: string; readonly principalId: string; readonly credential: string } {
    const principalId = `node-principal:${randomUUID()}`;
    const credential = randomBytes(32).toString("base64url");
    transaction(this.db, () => {
      this.registerPrincipal({ accountId, principalId });
      this.db.prepare("INSERT INTO credentials VALUES (?,?,?)").run(createHash("sha256").update(credential).digest("hex"), accountId, principalId);
    });
    return { accountId, principalId, credential };
  }
  resolveCredential(credential: string, signal: AbortSignal): LibraryRequestContext {
    signal.throwIfAborted();
    const row = this.db.prepare("SELECT account,principal FROM credentials WHERE digest=?").get(createHash("sha256").update(credential).digest("hex"));
    if (!row) throw new LibraryCatalogError("denied", "Invalid Node Library credential");
    const accountId = identifier.parse(row.account), principalId = identifier.parse(row.principal);
    const teamIds = this.db.prepare("SELECT team FROM teams WHERE account=? AND principal=? ORDER BY team").all(accountId, principalId).map(value => identifier.parse(value.team));
    return { principal: { accountId, principalId, teamIds }, providerOrigin: this.origin, signal };
  }
  registerPrincipal(principal: Pick<LibraryPrincipal, "accountId" | "principalId">): void {
    this.db.prepare("INSERT OR IGNORE INTO principals VALUES (?,?)").run(identifier.parse(principal.accountId), identifier.parse(principal.principalId));
  }
  assignTeam(member: { readonly accountId: string; readonly principalId: string; readonly teamId: string }, enabled: boolean): void {
    const values = [identifier.parse(member.accountId), identifier.parse(member.teamId), identifier.parse(member.principalId)];
    this.db.prepare(enabled ? "INSERT OR IGNORE INTO teams VALUES (?,?,?)" : "DELETE FROM teams WHERE account=? AND team=? AND principal=?").run(...values);
    this.changed();
  }
  assignAgent(member: { readonly accountId: string; readonly principalId: string; readonly agentId: string }, enabled: boolean): void {
    const values = [identifier.parse(member.accountId), identifier.parse(member.agentId), identifier.parse(member.principalId)];
    this.db.prepare(enabled ? "INSERT OR IGNORE INTO agents VALUES (?,?,?)" : "DELETE FROM agents WHERE account=? AND agent=? AND principal=?").run(...values);
    this.changed();
  }
  registerStore(input: LibraryOwner): void {
    const owner = ownerSchema.parse(input);
    const existing = this.db.prepare("SELECT * FROM stores WHERE store=?").get(owner.storeId);
    if (existing) {
      if (existing.account !== owner.accountId || existing.principal !== owner.principalId || existing.team !== owner.teamId) throw new LibraryCatalogError("denied", "Store identity is immutable");
      return;
    }
    if (owner.teamId && !this.member(owner, owner.teamId)) throw new LibraryCatalogError("denied", "Owner is not a persisted team member");
    this.db.prepare("INSERT INTO stores VALUES (?,?,?,?)").run(owner.storeId, owner.accountId, owner.principalId, owner.teamId);
  }
  ownedStores(context: LibraryRequestContext): readonly string[] {
    this.authenticate(context);
    return this.db.prepare("SELECT store FROM stores WHERE account=? AND principal=? ORDER BY store")
      .all(context.principal.accountId, context.principal.principalId).map(row => identifier.parse(row.store));
  }
  setStoreTeam(context: LibraryRequestContext, storeId: string, teamId: string | null): void {
    this.requireOwner(context, storeId);
    if (teamId !== null && !this.member(context.principal, identifier.parse(teamId))) throw new LibraryCatalogError("denied", "Owner is not a persisted team member");
    this.db.prepare("UPDATE stores SET team=? WHERE store=?").run(teamId, storeId);
    this.changed();
  }
  member(principal: Pick<LibraryPrincipal, "accountId" | "principalId">, team: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM teams WHERE account=? AND principal=? AND team=?").get(principal.accountId, principal.principalId, team);
  }
  authenticate(context: LibraryRequestContext): void {
    context.signal.throwIfAborted();
    if (context.providerOrigin !== this.origin || !this.db.prepare("SELECT 1 FROM principals WHERE account=? AND principal=?").get(context.principal.accountId, context.principal.principalId)) throw new LibraryCatalogError("denied", "Unknown principal or provider");
  }
  requireAgent(context: LibraryRequestContext, agentId: string): void {
    this.authenticate(context);
    if (!this.db.prepare("SELECT 1 FROM agents WHERE account=? AND principal=? AND agent=?").get(context.principal.accountId, context.principal.principalId, agentId)) throw new LibraryCatalogError("denied", "Agent membership required");
  }
  owner(storeId: string): LibraryOwner {
    const row = this.db.prepare("SELECT account AS accountId,principal AS principalId,store AS storeId,team AS teamId FROM stores WHERE store=?").get(storeId);
    if (!row) throw new LibraryCatalogError("denied", "Unknown store");
    return ownerSchema.parse(row);
  }
  requireOwner(context: LibraryRequestContext, storeId: string): LibraryOwner {
    this.authenticate(context);
    const owner = this.owner(storeId);
    if (owner.accountId !== context.principal.accountId || owner.principalId !== context.principal.principalId) throw new LibraryCatalogError("denied", "Store owner required");
    return owner;
  }
  requireExecution(context: LibraryExecutionContext): LibraryOwner {
    this.requireAgent(context, context.agentId);
    identifier.parse(context.idempotencyKey); identifier.parse(context.toolCallId);
    return this.requireOwner(context, context.storeId);
  }
}
