import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openUpstream0755 } from "./upstream-0755.mjs";
import { buildUpstreamVaultParsers } from "./vault-0721.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");

export async function stageVaultResources0721({ outputRoot, archive: supplied } = {}) {
  const archive = supplied ?? await openUpstream0755();
  const output = path.resolve(outputRoot, "dist/upstream-0721/vault-parsers.mjs");
  const generated = await buildUpstreamVaultParsers({ archive, output });
  const expected = await readFile(path.join(root, "source/electron-main/vault/upstream-vault-parsers.generated.mjs"));
  const actual = await readFile(output);
  if (!actual.equals(expected)) throw new Error("Vault parser source differs from the pinned upstream extraction");
  const files = [{ path: "dist/upstream-0721/vault-parsers.mjs", sha256: sha(actual), bytes: actual.length }];
  for (const relative of ["dist/deps/sand-card-text-recognition/package.json",
    "dist/deps/sand-card-text-recognition/index.js",
    "dist/deps/sand-card-text-recognition/build/Release/sand_card_text_recognition.node"]) {
    const bytes = relative.endsWith(".node") ? await archive.readNative(relative) : archive.read(relative);
    const destination = path.resolve(outputRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    files.push({ path: relative, sha256: sha(bytes), bytes: bytes.length });
  }
  const manifest = { upstream: archive.identity, extraction: generated.provenance, files };
  await writeFile(path.resolve(outputRoot, "dist/upstream-0721/vault-resources.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
