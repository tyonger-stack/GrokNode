import type { DatabaseSync } from "node:sqlite";

export class LibraryCatalogError extends Error {
  constructor(readonly code: "denied" | "invalid" | "stale" | "schema" | "path", message: string) {
    super(message); this.name = "LibraryCatalogError";
  }
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function migrateCatalog(db: DatabaseSync, root: string, origin: string): void {
  transaction(db, () => {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 0 && version !== 1) throw new LibraryCatalogError("schema", "Unsupported library schema");
    if (version === 0) {
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get()) {
        throw new LibraryCatalogError("schema", "Unversioned nonempty library database");
      }
      db.exec(`
        CREATE TABLE catalog_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), root TEXT NOT NULL, origin TEXT NOT NULL) STRICT;
        CREATE TABLE principals (account TEXT NOT NULL, principal TEXT NOT NULL, PRIMARY KEY(account,principal)) STRICT;
        CREATE TABLE credentials (digest TEXT PRIMARY KEY, account TEXT NOT NULL, principal TEXT NOT NULL,
          FOREIGN KEY(account,principal) REFERENCES principals) STRICT;
        CREATE TABLE teams (account TEXT NOT NULL, team TEXT NOT NULL, principal TEXT NOT NULL,
          PRIMARY KEY(account,team,principal), FOREIGN KEY(account,principal) REFERENCES principals) STRICT;
        CREATE TABLE stores (store TEXT PRIMARY KEY, account TEXT NOT NULL, principal TEXT NOT NULL, team TEXT,
          FOREIGN KEY(account,principal) REFERENCES principals) STRICT;
        CREATE TABLE agents (account TEXT NOT NULL, agent TEXT NOT NULL, principal TEXT NOT NULL,
          PRIMARY KEY(account,agent,principal), FOREIGN KEY(account,principal) REFERENCES principals) STRICT;
        CREATE TABLE objects (store TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('document','canvas')), id TEXT NOT NULL,
          title TEXT NOT NULL, created INTEGER, updated INTEGER, visibility TEXT NOT NULL CHECK(visibility IN ('private','team-view')),
          content_path TEXT NOT NULL, content_hash TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
          PRIMARY KEY(store,kind,id), FOREIGN KEY(store) REFERENCES stores) STRICT;
        CREATE TABLE outbox (event_id TEXT PRIMARY KEY, account TEXT NOT NULL, principal TEXT NOT NULL, agent TEXT NOT NULL,
          tool_call TEXT NOT NULL, idempotency_key TEXT NOT NULL, store TEXT NOT NULL, kind TEXT NOT NULL, object_id TEXT NOT NULL,
          event_json TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, message_id TEXT, published_at INTEGER,
          UNIQUE(account,principal,agent,idempotency_key), FOREIGN KEY(store,kind,object_id) REFERENCES objects(store,kind,id)) STRICT;
        CREATE TABLE external_touches (account TEXT NOT NULL, principal TEXT NOT NULL, agent TEXT NOT NULL,
          key TEXT NOT NULL, doc_json TEXT NOT NULL, PRIMARY KEY(account,principal,agent,key),
          FOREIGN KEY(account,principal) REFERENCES principals) STRICT;
        PRAGMA user_version=1;
      `);
      db.prepare("INSERT INTO catalog_identity VALUES (1,?,?)").run(root, origin);
    }
    const identity = db.prepare("SELECT root,origin FROM catalog_identity WHERE singleton=1").get();
    if (identity?.root !== root || identity.origin !== origin) throw new LibraryCatalogError("path", "Catalog root or provider mismatch");
  });
}
