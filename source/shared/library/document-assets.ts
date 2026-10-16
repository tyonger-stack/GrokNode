import { documentAssetNameSchema } from "./schemas.js";

const ASSET_REF_RE = /!\[[^\]\n]*\]\(\s*<?asset:([^\s)>\"']+)>?(?:\s+(?:\"[^\"\n]*\"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/gi;

export function isDocumentAssetName(name: string): boolean {
  return documentAssetNameSchema.safeParse(name).success;
}

export function documentAssetName(src: string): string | null {
  const trimmed = src.trim();
  if (!trimmed.toLowerCase().startsWith("asset:")) return null;
  const name = trimmed.slice("asset:".length);
  return isDocumentAssetName(name) ? name : null;
}

export function extractDocumentAssetNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(ASSET_REF_RE)) {
    const candidate = match[1] ?? "";
    if (isDocumentAssetName(candidate)) names.add(candidate);
  }
  return [...names];
}
