import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const archiveRoot = path.join(repositoryRoot, "research-archives", "original", "0.18.0");

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

test("the preserved macOS arm64 installer matches the pinned release inventory", async () => {
  const manifest = JSON.parse(await readFile(path.join(archiveRoot, "artifacts.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), ["artifacts", "note", "product", "schemaVersion", "version"]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.product, "Grok Bot");
  assert.equal(manifest.version, "0.18.0");
  assert.equal(manifest.artifacts.length, 1);

  const [artifact] = manifest.artifacts;
  assert.deepEqual(
    Object.keys(artifact).sort(),
    ["architecture", "bytes", "path", "platform", "sha256", "sourceUrl"],
  );
  assert.equal(artifact.platform, "darwin");
  assert.equal(artifact.architecture, "arm64");
  assert.equal(artifact.path, "macos-arm64/Grok_Bot_0.18.0.dmg");
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
  assert.match(artifact.sourceUrl, /^https:\/\/downloads\.cursor\.com\/grokbot\/stable\//);

  const file = path.join(archiveRoot, artifact.path);
  assert.ok(file.startsWith(`${archiveRoot}${path.sep}`));
  const metadata = await lstat(file);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  assert.equal(metadata.size, artifact.bytes, `${artifact.path} requires git lfs pull`);
  assert.equal(await sha256(file), artifact.sha256);
});

test("the checksum file carries the same digest as the manifest", async () => {
  const manifest = JSON.parse(await readFile(path.join(archiveRoot, "artifacts.json"), "utf8"));
  const sums = await readFile(path.join(archiveRoot, "SHA256SUMS"), "utf8");
  const [artifact] = manifest.artifacts;
  assert.ok(sums.includes(artifact.sha256), "SHA256SUMS must repeat the pinned digest");
  assert.ok(sums.includes(artifact.path), "SHA256SUMS must name the pinned artifact");
  assert.ok(!/windows/.test(sums), "the Windows installer is out of scope");
});

test("the Windows installer is not part of this repository", async () => {
  await assert.rejects(() => lstat(path.join(archiveRoot, "windows-x64")), /ENOENT/);
  const attributes = await readFile(path.join(repositoryRoot, ".gitattributes"), "utf8");
  assert.match(attributes, /research-archives\/original\/\*\*\/\*\.dmg filter=lfs diff=lfs merge=lfs -text/);
  assert.ok(!/\*\.exe filter=lfs/.test(attributes), "no Windows payload is tracked through LFS");
});

test("bootstrap prefers the pinned local archive before the network", async () => {
  const [config, bootstrap] = await Promise.all([
    readFile(path.join(repositoryRoot, "scripts", "lib", "config.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts", "bootstrap-runtime.mjs"), "utf8"),
  ]);
  assert.match(config, /export const archivedDmg = path\.join\(repoRoot, "research-archives", "original", "0\.18\.0", "macos-arm64", "Grok_Bot_0\.18\.0\.dmg"\)/);
  assert.match(bootstrap, /const archivedDigest = await sha256\(archivedDmg\)/);
  assert.match(bootstrap, /if \(archivedDigest !== dmgSha256\)/);
  assert.match(bootstrap, /await copyFile\(archivedDmg, cachedDmg\)/);
  assert.ok(bootstrap.indexOf("await copyFile(archivedDmg, cachedDmg)") < bootstrap.indexOf("await fetch(dmgUrl"));
  assert.match(bootstrap, /if \(await exists\(archivedDmg\)\)/);
});
