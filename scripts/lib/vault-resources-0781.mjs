import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openUpstream0781 } from "./upstream-0781.mjs";
import { buildUpstreamSiteUrl0781 } from "./vault-site-url-0781.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");

export async function stageVaultSiteUrl0781({ outputRoot, archive: supplied } = {}) {
  const archive = supplied ?? await openUpstream0781();
  const output = path.resolve(outputRoot, "dist/upstream-0781/vault-site-url.mjs");
  const generated = await buildUpstreamSiteUrl0781({ archive, output });
  const expected = await readFile(path.join(root, "source/electron-main/vault/upstream-vault-site-url.generated.mjs"));
  const actual = await readFile(output);
  if (!actual.equals(expected)) throw new Error("Vault site-url source differs from the pinned upstream extraction");
  const manifest = {
    upstream: archive.identity,
    extraction: generated.provenance,
    files: [{ path: "dist/upstream-0781/vault-site-url.mjs", sha256: sha(actual), bytes: actual.length }],
  };
  return manifest;
}
