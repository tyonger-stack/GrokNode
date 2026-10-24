import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const bridgeBefore = 'if(value!=="var("+target+")"&&Object.values(TABLE).some(vars=>Object.hasOwn(vars,target)))result[target]=value;';
const bridgeAfter = 'if(value!=="var("+target+")"&&(target.startsWith("--sand-prompt-cta-")||Object.values(TABLE).some(vars=>Object.hasOwn(vars,target))))result[target]=value;';
const textBefore = '"--sand-text-on-primary":"var(--sand-text-on-primary)"';
const textAfter = '"--sand-text-on-primary":"var(--sand-text-on-color)"';
const buttonBefore = 'onClick:le,rootStyle:Nl.actionCircle,size:"lg",type:Q,variant:"circle"';
const buttonAfter = 'onClick:le,rootStyle:[Nl.actionCircle,RPromptCta0753],size:"lg",type:Q,variant:"circle"';
const recipe = 'const RPromptCta0753={kWkggS:"r0753-cta-sand-12m6m3g r0753-cta-sand-xanj2b r0753-cta-sand-1xoj3",kMwMTN:"r0753-cta-sand-za9ptz r0753-cta-sand-1sbnejj",$$css:!0};\n';
const hash = value => createHash("sha256").update(value).digest("hex");

export const PROMPT_CTA_0753_CSS = String.raw`
:root{--sand-prompt-cta-fill:var(--cursor-text-primary);--sand-prompt-cta-fill-hover:var(--cursor-text-primary);--sand-prompt-cta-fill-disabled:var(--cursor-text-primary);--sand-prompt-cta-text:var(--cursor-bg-editor);--sand-prompt-cta-text-disabled:var(--cursor-bg-editor)}
.r0753-cta-sand-12m6m3g:not(#\#):not(#\#):not(#\#){background-color:var(--sand-prompt-cta-fill)}
.r0753-cta-sand-xanj2b:hover:not(:disabled):not(#\#):not(#\#):not(#\#){background-color:var(--sand-prompt-cta-fill-hover)}
.r0753-cta-sand-1xoj3:disabled:not(#\#):not(#\#):not(#\#){background-color:var(--sand-prompt-cta-fill-disabled)}
.r0753-cta-sand-za9ptz:not(#\#):not(#\#):not(#\#){color:var(--sand-prompt-cta-text)}
.r0753-cta-sand-1sbnejj:disabled:not(#\#):not(#\#):not(#\#){color:var(--sand-prompt-cta-text-disabled)}
`;

export function patchPromptCta0753(source) {
  if (source.includes(recipe)) {
    if (!source.includes(buttonAfter) || !source.includes(bridgeAfter)) throw new Error("Prompt CTA patch: incomplete existing patch.");
    if (source.includes(textAfter)) return { text: source, applied: false };
    if (source.split(textBefore).length !== 2) throw new Error("Prompt CTA patch: primary text alias changed.");
    return { text: source.replace(textBefore, textAfter), applied: true };
  }
  if (source.split(bridgeBefore).length !== 2 || source.split(buttonBefore).length !== 2 || source.split(textBefore).length !== 2) throw new Error("Prompt CTA patch: color bridge or primary button anchor changed.");
  let text = source.replace(bridgeBefore, bridgeAfter).replace(textBefore, textAfter);
  const offset = text.indexOf(buttonBefore);
  const ast = parse(text, { ecmaVersion: "latest", sourceType: "module" });
  const owner = ast.body.find(node => node.type === "FunctionDeclaration" && node.start < offset && node.end > offset);
  if (!owner) throw new Error("Prompt CTA patch: primary action component is missing.");
  text = text.slice(0, owner.start) + recipe + text.slice(owner.start);
  return { text: text.replace(buttonBefore, buttonAfter), applied: true };
}

export async function applyPromptCta0753Patch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist/renderer/assets");
  const files = await readdir(assets);
  const chunks = [];
  for (const file of files.filter(file => file.endsWith(".js"))) {
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes("const RbcTint=")) chunks.push({ file, source });
  }
  const styles = files.filter(file => /^index-.*\.css$/.test(file));
  if (chunks.length !== 1 || styles.length !== 1) throw new Error("Prompt CTA patch: expected one tinted entry and stylesheet.");
  const [{ file, source }] = chunks;
  const result = patchPromptCta0753(source);
  if (!result.applied) return { applied: false };
  const cssFile = styles[0], css = await readFile(path.join(assets, cssFile), "utf8");
  const nextCss = css.includes(PROMPT_CTA_0753_CSS) ? css : css + PROMPT_CTA_0753_CSS;
  await writeFile(path.join(assets, file), result.text);
  await writeFile(path.join(assets, cssFile), nextCss);
  const record = { mode: "prompt-cta-0753", reference: "Grok Bot 0.75.3 mQ and send style recipe", features: ["conversation-primary-button-color", "official-cta-fill-text-hover-disabled"], files: [
    { path: `dist/renderer/assets/${file}`, originalSha256: hash(source), patchedSha256: hash(result.text) },
    { path: `dist/renderer/assets/${cssFile}`, originalSha256: hash(css), patchedSha256: hash(nextCss) },
  ] };
  await writeFile(path.join(stageRoot, "dist/renderer-prompt-cta-0753-extension.json"), JSON.stringify(record, null, 2) + "\n");
  return record;
}
