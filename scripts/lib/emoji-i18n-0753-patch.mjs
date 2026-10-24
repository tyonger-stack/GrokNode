import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const before = 'gr(()=>import("./messages-ByIkiGdI.js"),[],import.meta.url)';
const after = 'gr(()=>RLocBoot()==="zh-CN"?import("./messages-zh-CN-0753.js"):import("./messages-ByIkiGdI.js"),[],import.meta.url)';
const catalogSource = new URL("./emoji-messages-zh-CN-0753.js", import.meta.url);
const hash = value => createHash("sha256").update(value).digest("hex");

export function patchEmojiLocale0753(source) {
  if (source.includes(after)) return { text: source, applied: false };
  if (source.split(before).length !== 2) throw new Error("Emoji locale patch: English message loader is missing or ambiguous.");
  return { text: source.replace(before, after), applied: true };
}

export async function applyEmojiLocale0753Patch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist/renderer/assets");
  const candidates = [];
  for (const file of (await readdir(assets)).filter(file => file.endsWith(".js"))) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes("function D5e(){")) candidates.push({ file, source });
  }
  if (candidates.length !== 1) throw new Error(`Emoji locale patch: expected one catalog loader, found ${candidates.length}.`);
  const [{ file, source }] = candidates;
  if (!source.includes("function RLocBoot(){")) throw new Error("Emoji locale patch requires the shared language runtime.");
  const patched = patchEmojiLocale0753(source);
  if (!patched.applied) return { applied: false };
  const catalog = await readFile(catalogSource);
  await writeFile(path.join(assets, file), patched.text);
  await writeFile(path.join(assets, "messages-zh-CN-0753.js"), catalog);
  const record = {
    mode: "emoji-locale-0753",
    reference: "Grok Bot 0.75.3 chunk-messages-4j2WTHdh.js",
    features: ["official-zh-CN-emoji-categories", "official-zh-CN-skin-tones", "official-zh-CN-subgroups", "application-language-selection"],
    files: [
      { path: `dist/renderer/assets/${file}`, originalSha256: hash(source), patchedSha256: hash(patched.text) },
      { path: "dist/renderer/assets/messages-zh-CN-0753.js", sha256: hash(catalog), bytes: catalog.length },
    ],
  };
  await writeFile(path.join(stageRoot, "dist/renderer-emoji-locale-0753-extension.json"), JSON.stringify(record, null, 2) + "\n");
  return record;
}
