import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { parse } from "acorn";
import { chunkReactPlugin } from "./library-host-renderer-patch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const marker = "function RServerPortCard(";
const methods = ["sendDraft", "discardDraft", "submitUserForm", "dismissUserForm"];
function replaceOnce(source, needle, replacement) {
  const at = source.indexOf(needle);
  if (at < 0 || source.indexOf(needle, at + needle.length) >= 0) throw new Error(`Review card anchor is absent or ambiguous: ${needle}`);
  return source.slice(0, at) + replacement + source.slice(at + needle.length);
}

export async function buildServerPortCardsBundle() {
  const cssRoot = path.join(root, "frontend/src/recovered/features/conversation/cards/transcript-card");
  const css = await readFile(path.join(cssRoot, "server-port-utilities.css"), "utf8");
  const manifest = JSON.parse(await readFile(path.join(cssRoot, "server-port-utilities.manifest.json"), "utf8"));
  if (createHash("sha256").update(css).digest("hex") !== manifest.outputCssSha256) throw new Error("Review card stylesheet provenance hash mismatch");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b|url\s*\(/i.test(rules)) throw new Error("Review card styles must not load untracked assets");
  for (const rule of rules.matchAll(/([^{}]+)\{/g)) {
    const head = rule[1].trim();
    if (head.startsWith("@")) continue;
    if (head.split(",").some(selector => !selector.includes(".sand-server-port-review"))) throw new Error("Review card style escaped its component scope");
  }
  const output = await build({ absWorkingDir: root, stdin: { contents: 'export { ReviewCard } from "./frontend/src/production/server-port-card-entry.tsx";', resolveDir: root, loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", globalName: "__sandReviewCards", target: "es2022", jsx: "automatic", write: false, logLevel: "silent",
    plugins: [chunkReactPlugin(), { name: "reuse-card-utilities", setup(builder) { builder.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" })); } }] });
  const code = output.outputFiles[0]?.text;
  if (code === undefined || !code.includes("ReviewCard")) throw new Error("Review card build did not emit its component");
  return code + `\nif(typeof document!=="undefined"){const style=document.createElement("style");style.setAttribute("data-sand-review-cards","v1");style.textContent=${JSON.stringify(css)};document.head.append(style);}\n`;
}

export function patchServerPortCardsSource(source, component) {
  if (source.includes(marker)) return source;
  let next = replaceOnce(source, 'respondToWidget:{args:"object",reply:"record-or-null"},',
    'respondToWidget:{args:"object",reply:"record-or-null"},' + methods.map(name => `${name}:{args:"object",reply:"record"},`).join(""));
  next = replaceOnce(next, 'respondToWidget:"widgets",', 'respondToWidget:"widgets",' + methods.map(name => `${name}:"widgets",`).join(""));
  next = replaceOnce(next, 'respondToWidget:j=>e.respondToWidget(j),',
    'respondToWidget:j=>e.respondToWidget(j),' + methods.map(name => `${name}:j=>e.${name}(j),`).join(""));
  next = replaceOnce(next, 'n.draftSendState??"",n.timestampMs??0',
    'n.draftSendState??"",n.userFormState??"",n.formResolution??"",n.timestampMs??0');
  next = replaceOnce(next, "function B2e(n){", `function B2e(n){if(RServerPortKinds.has(n)){const prior=kGe.get(n);if(prior!==undefined)return prior;const base=Kht(n==="send-message:user-form"?"send-message:email-draft":n);if(base==null)throw new Error("Review card metadata unavailable");const card={protocolKey:n,placeholderHeight:base.placeholderHeight,frame:base.frame,Body:RServerPortCard};kGe.set(n,card);return card;}`);
  next += `\n${component}\nconst RServerPortKinds=new Set(["send-message:email-draft","send-message:slack-draft","send-message:user-form"]);
const RServerPortIdentities=new WeakMap;let RServerPortNextIdentity=0;
function RServerPortCard(props){
 const runtime=Qe(),agentId=Mee();let identity=RServerPortIdentities.get(runtime);
 if(identity===undefined){identity=String(++RServerPortNextIdentity);RServerPortIdentities.set(runtime,identity);}
 const call=S.useCallback((method,args)=>{const action=runtime.transcript[method];if(typeof action!=="function")return Promise.reject(new Error("Review action unavailable"));return action(args);},[runtime]);
 S.useEffect(()=>{yIn("send-message:"+props.entry.message.type)},[props.entry.message.type]);
 return p.jsx(__sandReviewCards.ReviewCard,{entry:props.entry,scope:{agentId,accountSlot:identity},call});
}\n`;
  parse(next, { ecmaVersion: "latest", sourceType: "module" });
  return next;
}

export async function applyOriginalRendererServerPortCards({ stageRoot }) {
  const relative = "dist/renderer/assets/index-UbX-y3il.js";
  const file = path.join(stageRoot, relative);
  const original = await readFile(file, "utf8");
  const patched = patchServerPortCardsSource(original, await buildServerPortCardsBundle());
  await writeFile(file, patched);
  return { path: relative, beforeSha256: createHash("sha256").update(original).digest("hex"),
    afterSha256: createHash("sha256").update(patched).digest("hex") };
}
