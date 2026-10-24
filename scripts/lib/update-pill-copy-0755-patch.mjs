// The 0.18 renderer already contains the official footer update pill and the
// "Update ready" modal. The reconstructed UI kept older English copy, so port
// the official 0.75.5 strings into those existing components.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const hash = text => createHash("sha256").update(text).digest("hex");

const REPLACEMENTS = [
  [
    'Xbn="A new version of the app is available",Qbn="A new version of Grok Bot\'s computer is available",eTn="Updates are ready for Grok Bot and its computer",bve="Update queued — click to cancel";',
    'Xbn=RLocT("A new version is available","有新版本可用"),Qbn=RLocT("A new version of Grok Node\'s computer is available","Grok Node 的电脑有新版本可用"),eTn=RLocT("Updates are ready for Grok Node and its computer","Grok Node 和电脑都有更新"),bve=RLocT("Update queued — click to cancel","更新已排队，点击取消");',
  ],
  [
    "description:`Restart to finish installing Grok Bot ${n}. Your agents and work will be right where you left them.`",
    'description:RLocT("Restart to finish installing Grok Bot "+n+". Your Bots and work will be right where you left them.","重启以完成 Grok Bot "+n+" 的安装。你的 Bot 和工作都会原样保留。")',
  ],
  [
    'confirmLabel:(RLocT("Restart to update","更新并重启"))',
    'confirmLabel:RLocT("Update","更新")',
  ],
];

export function patchUpdatePillCopy(source) {
  let patched = source;
  const applied = [];
  for (const [before, after] of REPLACEMENTS) {
    const hits = patched.split(before).length - 1;
    if (hits !== 1) throw new Error(`Update pill copy anchor expected once, found ${hits}: ${before.slice(0, 60)}`);
    patched = patched.replace(before, after);
    applied.push({ before: before.slice(0, 60), hits });
  }
  return { text: patched, applied };
}

export async function applyUpdatePillCopy0755Patch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const files = (await readdir(assets)).filter(file => file.endsWith(".js"));
  const candidates = [];
  for (const file of files) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes('Xbn="A new version of the app is available"') && source.includes("function aIe(")) candidates.push({ file, source });
  }
  if (candidates.length !== 1) throw new Error(`Update pill copy patch: expected one main renderer chunk, found ${candidates.length}.`);
  const { file, source } = candidates[0];
  const result = patchUpdatePillCopy(source);
  await writeFile(path.join(assets, file), result.text);
  console.log(`Update pill copy: ported official 0.75.5 strings (${file}).`);
  const provenance = {
    mode: "update-pill-copy-0755",
    referenceVersion: "0.75.5",
    file,
    files: [{ file, originalSha256: hash(source), patchedSha256: hash(result.text) }],
    features: ["footer-update-pill-copy", "update-ready-modal-copy"],
    applied: result.applied,
  };
  await writeFile(path.join(stageRoot, "dist", "renderer-update-pill-copy-0755.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
