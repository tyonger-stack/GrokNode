import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { LibraryRequestContext, LibraryOwner } from "../../../../shared/library-contracts.js";
import { CatalogIdentity, identifier } from "../identity.js";
import { LibraryCatalogError, transaction } from "../migrations.js";

const resource = z.object({ kind: z.enum(["agent", "store"]), id: identifier });
const recipient = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), accountId: identifier, principalId: identifier }).strict(),
  z.object({ kind: z.literal("team"), teamId: identifier }).strict(),
]);
export const grantSchema = resource.extend({ recipient, expiresAtMs: z.number().int().positive().safe().nullable(),
  actions: z.array(z.enum(["view", "use", "create-automation"])).min(1).max(3) }).strict();
type Resource = z.infer<typeof resource>;
type Grant = z.infer<typeof grantSchema>;

export class CatalogAccess {
  constructor(private readonly db: DatabaseSync, private readonly identity: CatalogIdentity) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS local_teams (id TEXT PRIMARY KEY,account TEXT NOT NULL,principal TEXT NOT NULL,name TEXT NOT NULL,
        FOREIGN KEY(account,principal) REFERENCES principals) STRICT;
      CREATE TABLE IF NOT EXISTS local_team_members (team TEXT NOT NULL,account TEXT NOT NULL,principal TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),PRIMARY KEY(team,account,principal),
        FOREIGN KEY(team) REFERENCES local_teams, FOREIGN KEY(account,principal) REFERENCES principals) STRICT;
      CREATE TABLE IF NOT EXISTS local_resource_owners (kind TEXT NOT NULL,id TEXT NOT NULL,account TEXT NOT NULL,principal TEXT NOT NULL,
        PRIMARY KEY(kind,id),FOREIGN KEY(account,principal) REFERENCES principals) STRICT;
      CREATE TABLE IF NOT EXISTS local_access_grants (kind TEXT NOT NULL,id TEXT NOT NULL,target TEXT NOT NULL,
        grant_json TEXT NOT NULL,PRIMARY KEY(kind,id,target),FOREIGN KEY(kind,id) REFERENCES local_resource_owners) STRICT;
      INSERT OR IGNORE INTO local_resource_owners SELECT 'store',store,account,principal FROM stores;
    `);
    identity.installAgentAccessAuthorizer((context, agentId, action) => this.allows(context, { kind: "agent", id: agentId }, action));
  }
  registerOwner(value: Resource, owner: Pick<LibraryOwner, "accountId" | "principalId">): void {
    resource.parse(value); identifier.parse(owner.accountId); identifier.parse(owner.principalId);
    const prior = this.db.prepare("SELECT account,principal FROM local_resource_owners WHERE kind=? AND id=?").get(value.kind, value.id);
    if (prior && (prior.account !== owner.accountId || prior.principal !== owner.principalId)) {
      throw new LibraryCatalogError("denied", "Resource ownership is immutable");
    }
    this.db.prepare("INSERT OR IGNORE INTO local_resource_owners VALUES (?,?,?,?)")
      .run(value.kind, value.id, owner.accountId, owner.principalId);
  }
  private owner(context: LibraryRequestContext, value: Resource): void {
    this.identity.authenticate(context); resource.parse(value);
    if (value.kind === "store") this.registerOwner(value, this.identity.owner(value.id));
    const row = this.db.prepare("SELECT account,principal FROM local_resource_owners WHERE kind=? AND id=?").get(value.kind, value.id);
    if (!row || row.account !== context.principal.accountId || row.principal !== context.principal.principalId) {
      throw new LibraryCatalogError("denied", "Resource owner required");
    }
  }
  private teamAdmin(context: LibraryRequestContext, teamId: string): void {
    this.identity.authenticate(context); identifier.parse(teamId);
    const row = this.db.prepare("SELECT role FROM local_team_members WHERE team=? AND account=? AND principal=?")
      .get(teamId, context.principal.accountId, context.principal.principalId);
    if (row?.role !== "owner" && row?.role !== "admin") throw new LibraryCatalogError("denied", "Team administrator required");
  }
  requireTeam(context: LibraryRequestContext, teamId: string, action: "view" | "manage"): void {
    if (action === "manage") return this.teamAdmin(context, teamId);
    this.identity.authenticate(context); identifier.parse(teamId);
    if (!this.db.prepare("SELECT 1 FROM local_team_members WHERE team=? AND account=? AND principal=?")
      .get(teamId, context.principal.accountId, context.principal.principalId)) {
      throw new LibraryCatalogError("denied", "Team membership required");
    }
  }
  private knownPerson(accountId: string, principalId: string): void {
    if (!this.db.prepare("SELECT 1 FROM principals WHERE account=? AND principal=?").get(accountId, principalId)) {
      throw new LibraryCatalogError("denied", "Recipient must be an enrolled local principal");
    }
  }
  createTeam(context: LibraryRequestContext, name: string) {
    this.identity.authenticate(context);
    const label = z.string().trim().min(1).max(120).parse(name), teamId = `node-team:${randomUUID()}`;
    transaction(this.db, () => {
      this.db.prepare("INSERT INTO local_teams VALUES (?,?,?,?)").run(teamId, context.principal.accountId, context.principal.principalId, label);
      this.db.prepare("INSERT INTO local_team_members VALUES (?,?,?,'owner')").run(teamId, context.principal.accountId, context.principal.principalId);
      this.identity.assignTeam({ ...context.principal, teamId }, true);
    });
    return { teamId, name: label, role: "owner" as const };
  }
  listTeams(context: LibraryRequestContext) {
    this.identity.authenticate(context);
    return this.db.prepare("SELECT t.id AS teamId,t.name,m.role FROM local_teams t JOIN local_team_members m ON m.team=t.id WHERE m.account=? AND m.principal=? ORDER BY t.name,t.id")
      .all(context.principal.accountId, context.principal.principalId)
      .map((row) => z.object({ teamId: identifier, name: z.string(), role: z.enum(["owner", "admin", "member"]) }).parse(row));
  }
  setMember(context: LibraryRequestContext, input: { teamId: string; accountId: string; principalId: string; role: "admin" | "member" | null }) {
    const args = z.object({ teamId: identifier, accountId: identifier, principalId: identifier, role: z.enum(["admin", "member"]).nullable() }).strict().parse(input);
    this.teamAdmin(context, args.teamId); this.knownPerson(args.accountId, args.principalId);
    const prior = this.db.prepare("SELECT role FROM local_team_members WHERE team=? AND account=? AND principal=?")
      .get(args.teamId, args.accountId, args.principalId);
    if (prior?.role === "owner") throw new LibraryCatalogError("denied", "The team owner cannot be removed or demoted");
    transaction(this.db, () => {
      if (args.role === null) this.db.prepare("DELETE FROM local_team_members WHERE team=? AND account=? AND principal=?")
        .run(args.teamId, args.accountId, args.principalId);
      else this.db.prepare("INSERT INTO local_team_members VALUES (?,?,?,?) ON CONFLICT(team,account,principal) DO UPDATE SET role=excluded.role")
        .run(args.teamId, args.accountId, args.principalId, args.role);
      this.identity.assignTeam(args, args.role !== null);
    });
  }
  listMembers(context: LibraryRequestContext, teamId: string) {
    this.teamAdmin(context, teamId);
    return this.db.prepare("SELECT account AS accountId,principal AS principalId,role FROM local_team_members WHERE team=? ORDER BY account,principal")
      .all(teamId).map((row) => z.object({ accountId: identifier, principalId: identifier, role: z.enum(["owner", "admin", "member"]) }).parse(row));
  }
  setGrant(context: LibraryRequestContext, input: unknown, enabled: boolean) {
    const grant = grantSchema.parse(input); this.owner(context, grant);
    if (grant.recipient.kind === "person") this.knownPerson(grant.recipient.accountId, grant.recipient.principalId);
    else this.teamAdmin(context, grant.recipient.teamId);
    const target = JSON.stringify(grant.recipient);
    if (!enabled) this.db.prepare("DELETE FROM local_access_grants WHERE kind=? AND id=? AND target=?").run(grant.kind, grant.id, target);
    else this.db.prepare("INSERT INTO local_access_grants VALUES (?,?,?,?) ON CONFLICT(kind,id,target) DO UPDATE SET grant_json=excluded.grant_json")
      .run(grant.kind, grant.id, target, JSON.stringify(grant));
    this.identity.notifyAuthorizationChanged();
    return this.listGrants(context, grant);
  }
  listGrants(context: LibraryRequestContext, value: Resource): Grant[] {
    this.owner(context, value);
    return this.db.prepare("SELECT grant_json FROM local_access_grants WHERE kind=? AND id=? ORDER BY target")
      .all(value.kind, value.id).map((row) => grantSchema.parse(JSON.parse(z.string().parse(row.grant_json))));
  }
  allows(context: LibraryRequestContext, value: Resource, action: Grant["actions"][number]): boolean {
    this.identity.authenticate(context); resource.parse(value);
    const owner = this.db.prepare("SELECT account,principal FROM local_resource_owners WHERE kind=? AND id=?").get(value.kind, value.id);
    if (!owner) return false;
    if (owner.account === context.principal.accountId && owner.principal === context.principal.principalId) return true;
    for (const row of this.db.prepare("SELECT grant_json FROM local_access_grants WHERE kind=? AND id=?").all(value.kind, value.id)) {
      const grant = grantSchema.parse(JSON.parse(z.string().parse(row.grant_json)));
      if ((grant.expiresAtMs !== null && grant.expiresAtMs <= Date.now()) || !grant.actions.includes(action)) continue;
      if (grant.recipient.kind === "person" && grant.recipient.accountId === context.principal.accountId &&
          grant.recipient.principalId === context.principal.principalId) return true;
      if (grant.recipient.kind === "team" && this.db.prepare("SELECT 1 FROM local_team_members WHERE team=? AND account=? AND principal=?")
        .get(grant.recipient.teamId, context.principal.accountId, context.principal.principalId)) return true;
    }
    return false;
  }
}
