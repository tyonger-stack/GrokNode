import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractFile, listPackage, statFile } from "@electron/asar";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function createUpstreamAsarIdentity(version, asarSha256) {
  return Object.freeze({ version, asarSha256 });
}

export function upstreamAsarPaths(repoRoot, snapshotDir, manifestFile) {
  return {
    defaultAsar: path.resolve(repoRoot, "..", snapshotDir, "asar/app.asar"),
    nativeManifestPath: path.join(repoRoot, manifestFile),
  };
}

export async function openUpstreamAsar(identity, { asarPath, nativeManifestPath, envAsarPath } = {}) {
  const archive = path.resolve(asarPath ?? envAsarPath);
  const actual = sha256(await readFile(archive));
  if (actual !== identity.asarSha256) {
    throw new Error(`Grok Bot ${identity.version} ASAR checksum mismatch: ${actual}`);
  }
  const files = listPackage(archive).map((entry) => entry.replace(/^\//, ""));
  const provenance = new Map();

  function read(relative) {
    if (typeof relative !== "string" || relative.includes("\\") ||
        path.posix.normalize(relative) !== relative || relative.startsWith("/") || relative.startsWith("../")) {
      throw new Error(`Invalid upstream artifact path: ${relative}`);
    }
    const info = statFile(archive, relative);
    if (info.files || info.link || info.integrity?.algorithm !== "SHA256" || !info.integrity.hash) {
      throw new Error(`Upstream artifact has no SHA-256 file identity: ${relative}`);
    }
    const bytes = extractFile(archive, relative);
    const digest = sha256(bytes);
    if (digest !== info.integrity.hash) throw new Error(`Upstream member checksum mismatch: ${relative}`);
    provenance.set(relative, { path: relative, bytes: bytes.length, sha256: digest });
    return bytes;
  }

  const metadata = JSON.parse(read("package.json").toString("utf8"));
  if (metadata.version !== identity.version) {
    throw new Error(`Upstream package version does not match ${identity.version}`);
  }

  return {
    identity,
    files,
    read,
    async readNative(relative) {
      const manifest = JSON.parse(await readFile(nativeManifestPath, "utf8"));
      const entry = manifest.files.find((file) => file.path === relative);
      if (entry === undefined) throw new Error(`Unpinned upstream native artifact: ${relative}`);
      const info = statFile(archive, relative);
      if (!info.unpacked || info.integrity?.hash !== entry.asarDeclaredSha256) {
        throw new Error(`Upstream native artifact declaration mismatch: ${relative}`);
      }
      const bytes = await readFile(path.join(`${archive}.unpacked`, relative));
      const digest = sha256(bytes);
      if (digest !== entry.sha256) throw new Error(`Upstream native snapshot checksum mismatch: ${relative}`);
      provenance.set(relative, { path: relative, bytes: bytes.length, sha256: digest,
        asarDeclaredSha256: entry.asarDeclaredSha256, integritySource: manifest.integritySource });
      return bytes;
    },
    async copy(relative, destination) {
      const bytes = read(relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    },
    provenance: () => [...provenance.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

