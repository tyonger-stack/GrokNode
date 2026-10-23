import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import type { LibraryRequestContext } from "../../../shared/library-contracts.js";
import { assertNoSymlinkInPath, ensureSecureDirectoryChain } from "../../../packages/agent-store-sync/paths.js";
import { defineCommunicateTool } from "../../runner/tools/communicate-tool.js";
import { identifier } from "./identity.js";
import type { LibraryCatalog } from "./catalog.js";
import { openCatalog } from "./catalog/secure.js";
import { LibraryCatalogError, transaction } from "./migrations.js";

export type LibraryFileScope = "bot" | "private";
export interface LibraryFileBinding {
  readonly credential: string;
  readonly agentId: string;
  readonly storeId: string;
}
const fileName = z.string().trim().min(1).refine(
  value => value !== "." && value !== ".." && !/[\\/\x00-\x1f]/.test(value),
  "Library names must be flat file names",
);
const saveInput = z.object({
  sourcePath: z.string().min(1), scope: z.enum(["bot", "private"]),
  name: fileName.optional(), replace: z.boolean(),
});
export type SaveLibraryFileInput = z.infer<typeof saveInput>;
const fileRecord = z.object({
  id: z.string().uuid(), name: fileName, scope: z.enum(["bot", "private"]),
  sizeBytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAtMs: z.number().int().nonnegative(), updatedAtMs: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
});
export type LibraryFile = Readonly<z.infer<typeof fileRecord>>;
export type SaveLibraryFileResult =
  | { readonly kind: "saved"; readonly scope: LibraryFileScope; readonly name: string; readonly sizeBytes: number; readonly replaced: boolean }
  | { readonly kind: "refused"; readonly message: string };
export type PrivateFileApproval = (request: {
  readonly context: LibraryRequestContext; readonly agentId: string; readonly storeId: string;
  readonly sourcePath: string; readonly name: string; readonly sizeBytes: number;
  readonly sha256: string; readonly replace: boolean;
}) => Promise<{ readonly kind: "approved" } | { readonly kind: "refused"; readonly message: string }>;
export type LibraryFilePolicy = { readonly defaultScope: LibraryFileScope } & (
  | { readonly privateScopeOffered: false }
  | { readonly privateScopeOffered: true; readonly approvePrivate: PrivateFileApproval }
);
export interface LibraryFilesPort {
  readonly defaultScope: LibraryFileScope;
  readonly privateScopeOffered: boolean;
  save(context: { readonly signal: AbortSignal }, input: SaveLibraryFileInput): Promise<SaveLibraryFileResult>;
}

const selection = "id,name,scope,size AS sizeBytes,hash AS sha256,created AS createdAtMs,updated AS updatedAtMs,revision";
const privateUnavailable = "Not saved: no one's private files can be saved to from this chat. Save it bot-wide instead, or ask the user to message you directly.";

function readBytes(file: string, limit: number, privateFile: boolean): Buffer {
  assertNoSymlinkInPath(file);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() ||
        (privateFile && (stat.mode & 0o077) !== 0)) {
      throw new LibraryCatalogError("path", "Unsafe Library file");
    }
    if (stat.size > limit) throw new LibraryCatalogError("invalid", "File exceeds the configured Library byte limit");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit - total + 1));
      const count = readSync(fd, chunk);
      if (count === 0) break;
      total += count;
      if (total > limit) throw new LibraryCatalogError("invalid", "File exceeds the configured Library byte limit");
      chunks.push(chunk.subarray(0, count));
    }
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      throw new LibraryCatalogError("stale", "Source file changed while reading");
    }
    return Buffer.concat(chunks, total);
  } finally { closeSync(fd); }
}

function privateDirectory(directory: string): void {
  ensureSecureDirectoryChain(directory);
  assertNoSymlinkInPath(directory);
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new LibraryCatalogError("path", "Library file directory must be private and owned by this process user");
  }
}

export function createLibraryFilesService(options: {
  readonly dataRoot: string; readonly providerOrigin: string;
  readonly sourceRoot: string; readonly maxFileBytes: number;
  readonly catalog: Pick<LibraryCatalog, "identity" | "access">;
}) {
  const root = resolve(options.dataRoot);
  const sourceRoot = resolve(options.sourceRoot);
  const limit = z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1).parse(options.maxFileBytes);
  assertNoSymlinkInPath(sourceRoot);
  const db = openCatalog(root, options.providerOrigin);
  const { identity, access } = options.catalog;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS library_files_v1 (
      store TEXT NOT NULL REFERENCES stores(store), agent TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('bot','private')), principal TEXT NOT NULL,
      name TEXT NOT NULL, id TEXT NOT NULL UNIQUE, size INTEGER NOT NULL CHECK(size>=0), hash TEXT NOT NULL,
      created INTEGER NOT NULL, updated INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
      PRIMARY KEY(store,agent,scope,principal,name)
    ) STRICT`);
  } catch (error) { db.close(); throw error; }

  function authorize(binding: LibraryFileBinding, scope: LibraryFileScope, signal: AbortSignal, write = false) {
    identifier.parse(binding.agentId); identifier.parse(binding.storeId);
    z.enum(["bot", "private"]).parse(scope);
    const context = identity.resolveCredential(binding.credential, signal);
    identity.requireAgent(context, binding.agentId, write ? "use" : "view");
    const owner = identity.owner(binding.storeId);
    if (write || scope === "private") identity.requireOwner(context, binding.storeId);
    else if (owner.accountId !== context.principal.accountId &&
      !access.allows(context, { kind: "store", id: binding.storeId }, "view")) {
      throw new LibraryCatalogError("denied", "Store view access required");
    }
    return { context, key: [binding.storeId, scope === "bot" ? binding.agentId : "", scope,
      scope === "private" ? context.principal.principalId : ""] };
  }
  function lookup(key: readonly string[], name: string): LibraryFile | null {
    const row = db.prepare(`SELECT ${selection} FROM library_files_v1 WHERE store=? AND agent=? AND scope=? AND principal=? AND name=?`).get(...key, name);
    return row ? fileRecord.parse(row) : null;
  }
  function contentPath(file: Pick<LibraryFile, "id" | "sha256">): string {
    return join(root, "library", "files", file.id, file.sha256);
  }
  function persist(bytes: Buffer, file: LibraryFile): void {
    const path = contentPath(file);
    privateDirectory(dirname(dirname(path)));
    privateDirectory(dirname(path));
    assertNoSymlinkInPath(path);
    let fd: number;
    try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const existing = readBytes(path, limit, true);
      if (!existing.equals(bytes)) throw new LibraryCatalogError("invalid", "Content hash mismatch");
      return;
    }
    try {
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
      fsyncSync(fd);
    } catch (error) { unlinkSync(path); throw error; }
    finally { closeSync(fd); }
    const directoryFd = openSync(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
  }

  return {
    close(): void { db.close(); },
    list(binding: LibraryFileBinding, scope: LibraryFileScope, signal: AbortSignal): readonly LibraryFile[] {
      const { key } = authorize(binding, scope, signal);
      return db.prepare(`SELECT ${selection} FROM library_files_v1 WHERE store=? AND agent=? AND scope=? AND principal=? ORDER BY name`).all(...key).map(row => fileRecord.parse(row));
    },
    read(binding: LibraryFileBinding, scope: LibraryFileScope, name: string, signal: AbortSignal): { file: LibraryFile; bytes: Uint8Array } | null {
      const { key } = authorize(binding, scope, signal);
      const file = lookup(key, fileName.parse(name));
      if (!file) return null;
      const bytes = readBytes(contentPath(file), limit, true);
      if (bytes.length !== file.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
        throw new LibraryCatalogError("invalid", "Content hash mismatch");
      }
      signal.throwIfAborted();
      return { file, bytes };
    },
    remove(binding: LibraryFileBinding, scope: LibraryFileScope, name: string, signal: AbortSignal): boolean {
      return transaction(db, () => {
        const { key } = authorize(binding, scope, signal, true);
        // Immutable blobs may still be used by an in-flight read; deletion removes the catalog reference.
        return db.prepare("DELETE FROM library_files_v1 WHERE store=? AND agent=? AND scope=? AND principal=? AND name=?").run(...key, fileName.parse(name)).changes === 1;
      });
    },
    forExecution(binding: LibraryFileBinding, policy: LibraryFilePolicy): LibraryFilesPort {
      return {
        defaultScope: policy.defaultScope, privateScopeOffered: policy.privateScopeOffered,
        async save({ signal }, rawInput) {
          const input = saveInput.parse(rawInput);
          const { context } = authorize(binding, input.scope, signal, true);
          if (input.scope === "private" && !policy.privateScopeOffered) {
            return { kind: "refused", message: privateUnavailable.slice("Not saved: ".length) };
          }
          if (!isAbsolute(input.sourcePath) || input.sourcePath.includes("\0") || input.sourcePath.split(/[\\/]/).includes("..")) {
            throw new LibraryCatalogError("path", "Expected an absolute source file path without traversal");
          }
          const source = resolve(input.sourcePath);
          if (!source.startsWith(sourceRoot.endsWith(sep) ? sourceRoot : sourceRoot + sep)) throw new LibraryCatalogError("path", "Source file is outside the trusted box root");
          const name = fileName.parse(input.name ?? basename(source));
          const bytes = readBytes(source, limit, false);
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          if (input.scope === "private" && policy.privateScopeOffered) {
            const approval = await policy.approvePrivate({ context, agentId: binding.agentId, storeId: binding.storeId,
              sourcePath: source, name, sizeBytes: bytes.length, sha256, replace: input.replace });
            if (approval.kind !== "approved") return approval;
          }
          return transaction(db, () => {
            const { key } = authorize(binding, input.scope, signal, true);
            let chosen = name;
            let previous = lookup(key, chosen);
            const extension = extname(name), stem = name.slice(0, name.length - extension.length);
            for (let suffix = 2; previous && !input.replace; suffix++) {
              chosen = `${stem} (${suffix})${extension}`;
              previous = lookup(key, chosen);
            }
            const now = Date.now();
            const file: LibraryFile = { id: previous?.id ?? randomUUID(), name: chosen, scope: input.scope,
              sizeBytes: bytes.length, sha256, createdAtMs: previous?.createdAtMs ?? now,
              updatedAtMs: now, revision: (previous?.revision ?? 0) + 1 };
            persist(bytes, file);
            signal.throwIfAborted();
            db.prepare(`INSERT INTO library_files_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(store,agent,scope,principal,name) DO UPDATE SET
              size=excluded.size,hash=excluded.hash,updated=excluded.updated,revision=excluded.revision`).run(
              ...key, chosen, file.id, bytes.length, sha256, file.createdAtMs, now, file.revision);
            return { kind: "saved", scope: input.scope, name: chosen, sizeBytes: bytes.length, replaced: previous !== null };
          });
        },
      };
    },
  };
}
export type LibraryFilesService = ReturnType<typeof createLibraryFilesService>;

// Contract and strings from 0.72.1 host-main.cjs:790837-790895; adapted only to the existing Zod 3 tool wrapper.
function describeScope({ privateScopeOffered, defaultScope }: Pick<LibraryFilesPort, "privateScopeOffered" | "defaultScope">): string {
  if (defaultScope === "private") {
    return privateScopeOffered ? "Omit to save to the user's private files, the default in this direct message; the user is asked to approve. `bot`: the bot's shared Library, seen by everyone who can use this bot; use it only when the user explicitly asked to share the file with the team or the bot." : "`bot`: the bot's shared Library, seen by everyone who can use this bot; use it only when the user explicitly asked to share the file with the team or the bot.";
  }
  return privateScopeOffered ? "`bot` (the default): the bot's shared Library, seen by everyone who can use this bot. `private`: only the person who asked; they are asked to approve, and everyone in this chat sees the request." : "`bot` (the default): the bot's shared Library, seen by everyone who can use this bot.";
}
export function saveToLibraryParameters(options: Pick<LibraryFilesPort, "privateScopeOffered" | "defaultScope">) {
  return z.object({
    path: z.string().trim().min(1).describe("Absolute path of the file on your box."),
    scope: (options.privateScopeOffered ? z.enum(["bot", "private"]) : z.literal("bot")).optional().describe(describeScope(options)),
    name: z.string().trim().min(1).optional().describe("File name in the Library. Defaults to the source file's name."),
    replace: z.boolean().optional().describe("true to overwrite the Library file with exactly this name. Otherwise a clashing name is saved as `name (2).ext`."),
  });
}
export function createSaveToLibraryTool(libraryFiles: LibraryFilesPort) {
  const { privateScopeOffered, defaultScope } = libraryFiles;
  const scopes = defaultScope === "private" ? "In this direct message, files go to the user's private files by default, and saving one asks the user to approve. Save bot-wide, visible to everyone who can use this bot, only when the user explicitly asked to share the file with the team or the bot. " : "Files go to the bot's shared Library by default, visible to everyone who can use this bot. " + (privateScopeOffered ? "Private files are visible only to the person who asked, and saving one asks that person to approve. " : "");
  const tool = defineCommunicateTool({ libraryFiles }, {
    id: "SAVE_TO_LIBRARY", name: "SaveToLibrary",
    description: "Save a file you created on your box into the Library so the user can find it later. " + scopes + "Library names are flat file names. Pass replace to update a file you saved before.",
    parameters: saveToLibraryParameters(libraryFiles),
    describeActivity: (args: z.infer<ReturnType<typeof saveToLibraryParameters>>) => ({ target: args.name ?? args.path }),
    async execute(ctx, args: z.infer<ReturnType<typeof saveToLibraryParameters>>, deps) {
      const scope = args.scope ?? defaultScope;
      if (scope === "private" && !privateScopeOffered) return privateUnavailable;
      const result = await deps.libraryFiles.save(ctx, { sourcePath: args.path, scope,
        ...(args.name === undefined ? {} : { name: args.name }), replace: args.replace === true });
      if (result.kind === "refused") return `Not saved: ${result.message}`;
      const where = result.scope === "bot" ? "the bot's shared Library" : "the user's private Library";
      return `${result.replaced ? "Replaced" : "Saved"} "${result.name}" (${result.sizeBytes} bytes) in ${where}.`;
    },
  });
  return { ...tool, contextType: { type: "dynamic" as const,
    conciseStaticContext: "Save a file you made on your box to the Library, bot-wide or the user's private folder." } };
}
