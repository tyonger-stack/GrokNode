import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assertNoSymlinkInPath, ensureSecureDirectoryChain } from "../../../../packages/agent-store-sync/paths.js";
import { openSecureSqlitePath } from "../../../../packages/agent-store-sync/secure-open.js";
import { LibraryCatalogError, migrateCatalog } from "../migrations.js";

function guard(path: string, directory: boolean): void {
  assertNoSymlinkInPath(path);
  const stat = lstatSync(path);
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0 || (!directory && stat.nlink !== 1)) {
    throw new LibraryCatalogError("path", "Library path must be private and owned by this process user");
  }
}

export function openCatalog(root: string, origin: string): DatabaseSync {
  if (new URL(origin).origin !== origin || !origin.startsWith("https://")) throw new LibraryCatalogError("invalid", "Expected HTTPS provider origin");
  assertNoSymlinkInPath(root);
  ensureSecureDirectoryChain(root);
  guard(root, true);
  const directory = join(root, "library");
  ensureSecureDirectoryChain(directory);
  guard(directory, true);
  const file = join(directory, "catalog.db");
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    try { guard(file + suffix, false); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  }
  const secure = openSecureSqlitePath(file, 0o600);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(secure.sqlitePath);
    secure.verifyOpenedInode(); guard(file, false);
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
    migrateCatalog(db, root, origin);
    return db;
  } catch (error) { db?.close(); throw error; }
  finally { secure.close(); }
}

export function verifyContent(root: string, relativePath: string, expectedHash: string): void {
  const file = resolve(root, relativePath);
  if (!file.startsWith(root + sep) || relativePath.startsWith(sep) || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new LibraryCatalogError("path", "Invalid content location or hash");
  }
  assertNoSymlinkInPath(file);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) {
      throw new LibraryCatalogError("path", "Unsafe content file");
    }
    if (createHash("sha256").update(readFileSync(fd)).digest("hex") !== expectedHash) {
      throw new LibraryCatalogError("invalid", "Content hash mismatch");
    }
  } finally { closeSync(fd); }
}
