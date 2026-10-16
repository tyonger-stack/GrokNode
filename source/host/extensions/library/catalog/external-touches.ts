import type { DatabaseSync } from "node:sqlite";
import type { LibraryExternalDoc, LibraryExecutionContext, LibraryRequestContext } from "../../../../shared/library-contracts.js";
import { z } from "zod";
import { CatalogIdentity, identifier } from "../identity.js";
import { LibraryCatalogError } from "../migrations.js";

const docSchema = z.object({ key: identifier, externalId: identifier,
  provider: z.enum(["notion", "google-docs", "google-sheets", "google-slides", "google-drive", "onedrive", "sharepoint", "figma", "figjam", "figma-slides", "linear-issue", "linear-document", "confluence-page", "jira-issue", "github-file", "github-gist", "github-issue", "slack-canvas", "box", "dropbox", "airtable", "coda", "miro", "canva", "hex", "gmail-draft", "google-calendar-event", "slack-message", "github-pull-request", "web", "other"]),
  url: z.string().url().refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }),
  title: z.string().nullable(), createdByBot: z.boolean(), lastAction: z.enum(["created", "edited"]),
  firstTouchedAtMs: z.number().int().positive(), lastTouchedAtMs: z.number().int().positive() });

export class CatalogExternalTouches {
  constructor(private readonly db: DatabaseSync, private readonly identity: CatalogIdentity) {}
  upsert(context: LibraryExecutionContext, input: LibraryExternalDoc): LibraryExternalDoc {
    this.identity.requireExecution(context);
    const next = docSchema.parse(input);
    if (next.firstTouchedAtMs > next.lastTouchedAtMs) throw new LibraryCatalogError("invalid", "Invalid touch timestamps");
    const scope = [context.principal.accountId, context.principal.principalId, context.agentId, next.key];
    const row = this.db.prepare("SELECT doc_json FROM external_touches WHERE account=? AND principal=? AND agent=? AND key=?").get(...scope);
    const old = row && typeof row.doc_json === "string" ? docSchema.parse(JSON.parse(row.doc_json)) : null;
    if (old && (old.provider !== next.provider || old.externalId !== next.externalId)) throw new LibraryCatalogError("invalid", "External identity conflict");
    if (old && old.lastTouchedAtMs >= next.lastTouchedAtMs) return old;
    const result = { ...next, firstTouchedAtMs: old ? Math.min(old.firstTouchedAtMs, next.firstTouchedAtMs) : next.firstTouchedAtMs, createdByBot: next.createdByBot || old?.createdByBot === true };
    this.db.prepare("INSERT INTO external_touches VALUES (?,?,?,?,?) ON CONFLICT(account,principal,agent,key) DO UPDATE SET doc_json=excluded.doc_json").run(...scope, JSON.stringify(result));
    return result;
  }
  list(context: LibraryRequestContext, agentId: string): readonly LibraryExternalDoc[] {
    this.identity.requireAgent(context, agentId);
    return this.db.prepare("SELECT doc_json FROM external_touches WHERE account=? AND principal=? AND agent=?")
      .all(context.principal.accountId, context.principal.principalId, agentId).map(row => docSchema.parse(JSON.parse(z.string().parse(row.doc_json))))
      .sort((a, b) => b.lastTouchedAtMs - a.lastTouchedAtMs || a.key.localeCompare(b.key));
  }
}
