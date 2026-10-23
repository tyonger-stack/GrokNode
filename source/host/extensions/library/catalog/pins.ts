import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { libraryPinKey, libraryPinSchema, type LibraryPin } from "../../../../shared/library-pins.js";
import type { LibraryRequestContext } from "../../../../shared/library-contracts.js";
import type { CatalogIdentity } from "../identity.js";
import { identifier } from "../identity.js";
import { transaction } from "../migrations.js";

export class CatalogPins {
  constructor(private readonly db: DatabaseSync, private readonly identity: CatalogIdentity) {
    db.exec(`CREATE TABLE IF NOT EXISTS library_pins (
      account TEXT NOT NULL, principal TEXT NOT NULL, agent TEXT NOT NULL,
      target TEXT NOT NULL, pin_json TEXT NOT NULL, pinned_at INTEGER NOT NULL,
      PRIMARY KEY(account,principal,agent,target),
      FOREIGN KEY(account,principal) REFERENCES principals) STRICT`);
  }
  list(context: LibraryRequestContext, agentId: string): LibraryPin[] {
    this.identity.requireAgent(context, identifier.parse(agentId));
    return this.db.prepare("SELECT pin_json FROM library_pins WHERE account=? AND principal=? AND agent=? ORDER BY pinned_at DESC,target")
      .all(context.principal.accountId, context.principal.principalId, agentId)
      .map((row) => libraryPinSchema.parse(JSON.parse(z.string().parse(row.pin_json))));
  }
  set(context: LibraryRequestContext, agentId: string, input: unknown, isPinned: boolean): LibraryPin[] {
    const pin = libraryPinSchema.parse(input);
    this.identity.requireAgent(context, identifier.parse(agentId));
    transaction(this.db, () => this.write(context, agentId, pin, isPinned));
    return this.list(context, agentId);
  }
  merge(context: LibraryRequestContext, agentId: string, input: unknown): LibraryPin[] {
    const pins = z.array(libraryPinSchema).max(1000).parse(input);
    this.identity.requireAgent(context, identifier.parse(agentId));
    transaction(this.db, () => { for (const pin of pins) this.write(context, agentId, pin, true); });
    return this.list(context, agentId);
  }
  private write(context: LibraryRequestContext, agentId: string, pin: LibraryPin, isPinned: boolean): void {
    const key = libraryPinKey(pin);
    const scope = [context.principal.accountId, context.principal.principalId, agentId, key];
    if (!isPinned) {
      this.db.prepare("DELETE FROM library_pins WHERE account=? AND principal=? AND agent=? AND target=?").run(...scope);
    } else {
      this.db.prepare("INSERT INTO library_pins VALUES (?,?,?,?,?,?) ON CONFLICT(account,principal,agent,target) DO UPDATE SET pin_json=excluded.pin_json")
        .run(...scope, JSON.stringify(pin), Date.now());
    }
  }
}
