import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import official from "./reply-target-0753-official.json" with { type: "json" };

export const REPLY_TARGET_0753_CSS = official.css;
const oldRowAnimation = "sand-5p1i9e sand-1aquc0h sand-1h5mrz9 sand-a3vuyk sand-jk8ly";
const bubble = 're(Ie.props.className,"sand-message-action-anchor",';
const marker = "r0753-target-sand-17i7h53";
const hash = value => createHash("sha256").update(value).digest("hex");

export function patchReplyTarget0753(source) {
  if (source.includes(marker)) return { text: source, applied: false };
  if (source.split(oldRowAnimation).length !== 9) throw new Error("Reply target patch: expected eight highlighted row variants.");
  if (source.split(bubble).length !== 2) throw new Error("Reply target patch: bubble action anchor changed.");
  const text = source.replaceAll(oldRowAnimation, "").replace(bubble, `re(Ie.props.className,"sand-message-action-anchor",${JSON.stringify(official.className)},`);
  return { text, applied: true };
}

export async function applyReplyTarget0753Patch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist/renderer/assets");
  const files = await readdir(assets);
  const chunks = [];
  for (const file of files.filter(file => file.endsWith(".js"))) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes("function mCn(n){")) chunks.push({ file, source });
  }
  const stylesheets = files.filter(file => /^index-.*\.css$/.test(file));
  if (chunks.length !== 1 || stylesheets.length !== 1) throw new Error("Reply target patch: expected one message chunk and stylesheet.");
  const [{ file, source }] = chunks;
  const patched = patchReplyTarget0753(source);
  if (!patched.applied) return { applied: false };
  const cssFile = stylesheets[0];
  const css = await readFile(path.join(assets, cssFile), "utf8");
  const nextCss = css + "\n" + REPLY_TARGET_0753_CSS;
  await writeFile(path.join(assets, file), patched.text);
  await writeFile(path.join(assets, cssFile), nextCss);
  const provenance = {
    mode: "reply-target-0753",
    reference: official.reference,
    officialAppSha256: official.appSha256,
    officialCssSha256: official.cssSha256,
    features: ["bubble-outline-highlight", "no-row-warning-background", "official-reduced-motion"],
    files: [
      { path: `dist/renderer/assets/${file}`, originalSha256: hash(source), patchedSha256: hash(patched.text) },
      { path: `dist/renderer/assets/${cssFile}`, originalSha256: hash(css), patchedSha256: hash(nextCss) },
    ],
  };
  await writeFile(path.join(stageRoot, "dist/renderer-reply-target-0753-extension.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
