import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { LibraryExecutionContext, LibraryRequestContext, LibraryWriteVisibility, NativePublishEvent, NativePublishOutbox } from "../../../shared/library-contracts.js";
import { CatalogIdentity } from "./identity.js";
import { LibraryCatalogError, transaction } from "./migrations.js";
import { openCatalog } from "./catalog/secure.js";
import { CatalogObjects, type CatalogObject, type CatalogObjectKey } from "./catalog/objects.js";
import { CatalogOutbox } from "./catalog/outbox.js";
import { CatalogExternalTouches } from "./catalog/external-touches.js";
export type { CatalogObject, CatalogObjectKey } from "./catalog/objects.js";
export { LibraryCatalogError } from "./migrations.js";

export class LibraryCatalog {
  readonly identity: CatalogIdentity;
  readonly outbox: CatalogOutbox;
  readonly external: CatalogExternalTouches;
  private readonly db: DatabaseSync;
  private readonly objects: CatalogObjects;
  constructor(options: { readonly dataRoot: string; readonly providerOrigin: string }) {
    const root = resolve(options.dataRoot);
    this.db = openCatalog(root, options.providerOrigin);
    this.identity = new CatalogIdentity(this.db, options.providerOrigin);
    this.objects = new CatalogObjects(this.db, this.identity, root);
    this.outbox = new CatalogOutbox(this.db, this.identity);
    this.external = new CatalogExternalTouches(this.db, this.identity);
  }
  close(): void { this.db.close(); }
  readObject(context: LibraryRequestContext, key: CatalogObjectKey): CatalogObject | null { return this.objects.read(context, key); }
  listPages(context: LibraryRequestContext, includeDocuments = true) { return this.objects.list(context, includeDocuments); }
  canShareToTeam(context: LibraryRequestContext, storeId: string): boolean { this.identity.authenticate(context); return this.objects.canShare(context, storeId); }
  upsertObject(context: LibraryRequestContext, object: CatalogObject): CatalogObject {
    return transaction(this.db, () => this.objects.upsert(context, object));
  }
  setVisibility(context: LibraryRequestContext, key: CatalogObjectKey, visibility: LibraryWriteVisibility): CatalogObject {
    return transaction(this.db, () => this.objects.setVisibility(context, key, visibility));
  }
  commitNative(context: LibraryExecutionContext, publication: { readonly object: CatalogObject; readonly event: NativePublishEvent }): NativePublishOutbox {
    return transaction(this.db, () => {
      this.identity.requireExecution(context);
      if (publication.object.storeId !== context.storeId) throw new LibraryCatalogError("denied", "Execution store mismatch");
      const prior = this.outbox.find(context);
      if (prior) return prior;
      const object = this.objects.upsert(context, publication.object);
      return this.outbox.insert(context, object, publication.event);
    });
  }
}
