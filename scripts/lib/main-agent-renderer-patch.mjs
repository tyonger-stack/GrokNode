import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { MAIN_AGENT_COMPONENTS, MAIN_AGENT_STYLE } from "./main-agent-renderer-components.mjs";

const ANCHORS = [
  ["function u0n(n){", "function RMainOriginalSidebar(n){"],
  ['Hs=p.jsx(lt,{"aria-current":pt,', 'Hs=p.jsx(RMainAgentItem,{base:lt,"aria-current":pt,'],
  ['ee=p.jsx(mcn,{batchCount:r,id:t.id,onRequestDelete:A})', 'ee=p.jsx(RMainDeleteOrReplace,{batchCount:r,id:t.id,onRequestDelete:A})']
];
const hash = text => createHash("sha256").update(text).digest("hex");

/**
 * Every design token the injected stylesheet consumes, derived from the stylesheet
 * itself. Hand-maintaining this list is how it rots: the first version checked four
 * tokens while the CSS used eight, so half the styling could have been lost to a
 * renamed token without a single failure.
 */
export const MAIN_AGENT_CSS_TOKENS = [...new Set([...MAIN_AGENT_STYLE.matchAll(/var\((--sand-[a-z-]+)\)/g)].map(match => match[1]))].sort();

export function patchMainAgentRenderer(source) {
  if (source.includes("function RMainRoot(")) throw new Error("Main Bot renderer patch was already applied.");
  let patched = source;
  for (const [before, after] of ANCHORS) {
    const first = patched.indexOf(before);
    if (first < 0 || patched.indexOf(before, first + 1) >= 0) throw new Error(`Main Bot renderer anchor missing or ambiguous: ${before}`);
    patched = patched.slice(0, first) + after + patched.slice(first + before.length);
  }
  patched += MAIN_AGENT_COMPONENTS;
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return patched;
}

export async function applyMainAgentRendererPatch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const files = await readdir(assets);
  const candidates = [];
  for (const file of files.filter(file => file.endsWith(".js"))) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes(ANCHORS[0][0])) candidates.push({ file, source });
  }
  if (candidates.length !== 1) throw new Error("Expected exactly one Main Bot sidebar renderer chunk.");
  const cssFiles = files.filter(file => /^index-.*\.css$/.test(file));
  if (cssFiles.length !== 1) throw new Error("Expected one main renderer stylesheet.");
  const css = await readFile(path.join(assets, cssFiles[0]), "utf8");
  for (const token of MAIN_AGENT_CSS_TOKENS) {
    if (!css.includes(token)) throw new Error(`Missing Main Bot design token: ${token}`);
  }
  const { file, source } = candidates[0], patched = patchMainAgentRenderer(source), patchedCss = css + MAIN_AGENT_STYLE;
  await writeFile(path.join(assets, file), patched);
  await writeFile(path.join(assets, cssFiles[0]), patchedCss);
  // `patchedSha256` is the hash of THIS patch's output, not of the shipped chunk: the
  // i18n passes run after this one and keep editing the same file, so only the stylesheet
  // hash still matches at the end of the build. Recorded so an auditor comparing this
  // file against the staged chunk does not read the difference as tampering.
  const provenance = { mode: "main-bot-local-host", evidence: "Grok Bot 0.63.0 main Bot chooser/sidebar/RPC contract", hashScope: "as-of-this-pass; later i18n passes supersede the chunk hash", files: [{ file, originalSha256: hash(source), patchedSha256: hash(patched) }, { file: cssFiles[0], originalSha256: hash(css), patchedSha256: hash(patchedCss) }] };
  await writeFile(path.join(stageRoot, "dist", "renderer-main-agent-extension.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
