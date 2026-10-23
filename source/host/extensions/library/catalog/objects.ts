import type { DatabaseSync } from "node:sqlite";
import type { LibraryPage, LibraryRequestContext, LibraryWriteVisibility } from "../../../../shared/library-contracts.js";
import { z } from "zod";
import { CatalogIdentity, identifier } from "../identity.js";
import { LibraryCatalogError } from "../migrations.js";
import { verifyContent } from "./secure.js";
import type { CatalogAccess } from "./access.js";

export const objectKeySchema = z.object({ storeId: identifier, kind: z.enum(["document", "canvas"]), objectId: z.string().uuid() });
export type CatalogObjectKey = z.infer<typeof objectKeySchema>;
const time = z.number().int().nonnegative().nullable();
export const objectSchema = objectKeySchema.extend({ title: z.string().max(16384), createdAtMs: time, updatedAtMs: time,
  visibility: z.enum(["private", "team-view"]), contentPath: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/), revision: z.number().int().positive() });
export type CatalogObject = Readonly<z.infer<typeof objectSchema>>;
const selection = "store AS storeId,kind,id AS objectId,title,created AS createdAtMs,updated AS updatedAtMs,visibility,content_path AS contentPath,content_hash AS contentHash,revision";

export class CatalogObjects {
  constructor(private readonly db: DatabaseSync, private readonly identity: CatalogIdentity, private readonly root: string, private readonly access?: CatalogAccess) {}
  lookup(key: CatalogObjectKey): CatalogObject | null {
    const row = this.db.prepare(`SELECT ${selection} FROM objects WHERE store=? AND kind=? AND id=?`).get(key.storeId, key.kind, key.objectId);
    return row ? objectSchema.parse(row) : null;
  }
  read(context: LibraryRequestContext, key: CatalogObjectKey): CatalogObject | null {
    this.identity.authenticate(context); objectKeySchema.parse(key);
    const object = this.lookup(key);
    if (!object) return null;
    const owner = this.identity.owner(key.storeId);
    const sameAccount = owner.accountId === context.principal.accountId;
    if (sameAccount && (owner.principalId === context.principal.principalId ||
      (object.visibility === "team-view" && owner.teamId && this.identity.member(context.principal, owner.teamId) && this.identity.member(owner, owner.teamId)))) return object;
    return this.access?.allows(context, { kind: "store", id: key.storeId }, "view") === true ? object : null;
  }
  upsert(context: LibraryRequestContext, input: CatalogObject): CatalogObject {
    const value = objectSchema.parse(input);
    this.identity.requireOwner(context, value.storeId);
    const previous = this.lookup(value);
    if (previous) {
      if (JSON.stringify(previous) === JSON.stringify(value)) return previous;
      if (value.revision !== previous.revision + 1 || value.createdAtMs !== previous.createdAtMs ||
        (previous.updatedAtMs !== null && (value.updatedAtMs === null || value.updatedAtMs < previous.updatedAtMs))) throw new LibraryCatalogError("stale", "Stale object revision or original timestamp mismatch");
    } else if (value.revision !== 1) throw new LibraryCatalogError("stale", "New object must start at revision 1");
    if (value.visibility === "team-view" && !this.canShare(context, value.storeId)) throw new LibraryCatalogError("denied", "Persisted team authority required");
    verifyContent(this.root, value.contentPath, value.contentHash);
    context.signal.throwIfAborted();
    this.db.prepare(`INSERT INTO objects VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(store,kind,id) DO UPDATE SET
      title=excluded.title,updated=excluded.updated,visibility=excluded.visibility,content_path=excluded.content_path,
      content_hash=excluded.content_hash,revision=excluded.revision`).run(value.storeId, value.kind, value.objectId, value.title,
        value.createdAtMs, value.updatedAtMs, value.visibility, value.contentPath, value.contentHash, value.revision);
    return value;
  }
  canShare(context: LibraryRequestContext, storeId: string): boolean {
    const owner = this.identity.owner(storeId);
    return owner.accountId === context.principal.accountId && owner.principalId === context.principal.principalId &&
      owner.teamId !== null && this.identity.member(owner, owner.teamId);
  }
  setVisibility(context: LibraryRequestContext, key: CatalogObjectKey, visibility: LibraryWriteVisibility): CatalogObject {
    this.identity.requireOwner(context, key.storeId);
    const previous = this.lookup(key);
    if (!previous) throw new LibraryCatalogError("invalid", "Unknown object");
    return this.upsert(context, { ...previous, visibility, revision: previous.revision + 1 });
  }
  list(context: LibraryRequestContext, includeDocuments: boolean): readonly LibraryPage[] {
    this.identity.authenticate(context);
    const rows = this.db.prepare(`SELECT ${selection} FROM objects ORDER BY updated DESC,store,kind,id`).all();
    return rows.flatMap(row => {
      const value = objectSchema.parse(row);
      if ((!includeDocuments && value.kind === "document") || !this.read(context, value)) return [];
      const common = { storeId: value.storeId, title: value.title, createdAtMs: value.createdAtMs, updatedAtMs: value.updatedAtMs,
        visibility: value.visibility === "team-view" ? "team" as const : "private" as const, canShareToTeam: this.canShare(context, value.storeId) };
      return [value.kind === "document" ? { ...common, kind: "document" as const, documentId: value.objectId } : { ...common, kind: "canvas" as const, canvasId: value.objectId }];
    });
  }
}
