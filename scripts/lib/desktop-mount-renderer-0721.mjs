import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { transform } from "esbuild";
import { openUpstream0721 } from "./upstream-0721.mjs";
import { extractUpstreamDeclarations } from "./upstream-declarations.mjs";
import { bundleUpstreamModule } from "./upstream-module.mjs";

const entry = "dist/renderer/assets/index.eager-app-CG8Fw00L.js";
const mark = "/* grok-node-desktop-mount-0721 */";
const sha = (value) => createHash("sha256").update(value).digest("hex");

export async function buildDesktopMountRenderer0721(archive = undefined) {
  archive ??= await openUpstream0721();
  const extracted = extractUpstreamDeclarations({ code: archive.read(entry).toString("utf8"),
    exports: { createController: "yce", MenuItem: "Kj", makeTarget: "kA", choicesOf: "kRe", previewOf: "ORe" },
    bindings: {
      X: "ports.React", Y: "ports.jsx", Z: "ports.compiler", J: "(()=>({_:ports.translate}))",
      wu: "(name=>ports.client.experiments.snapshots.get()?.featureGates?.[name]===true)",
      Ou: "(()=>()=>{})", Af: "(()=>({platform:ports.platform}))", Cce: "(()=>ports.useSnapshot(ports.controller.snapshots))",
      wce: "(()=>ports.controller)", P: "ports.React.useEffect", Vn: "ports.Icon", sE: "ports.Menu",
      wA: "ports.agentName",
      gp: "ports.sendPrompt", Qs: "ports.SourceFailure", hp: "ports.reportPromise", _l: "ports.reportError",
    } });
  if (extracted.unresolved.some((name) => name !== "ports")) throw new Error(`Unresolved mount renderer bindings: ${extracted.unresolved.join(", ")}`);
  const ast = parse(extracted.code, { ecmaVersion: "latest", sourceType: "module" });
  const imports = ast.body.filter((node) => node.type === "ImportDeclaration").map((node) => extracted.code.slice(node.start, node.end));
  const body = ast.body.filter((node) => node.type !== "ImportDeclaration" && node.type !== "ExportNamedDeclaration")
    .map((node) => extracted.code.slice(node.start, node.end)).join("\n");
  const virtual = `${imports.join("\n")}\nfunction createMountRenderer(ports){\n${body}\nreturn {createController:yce,MenuItem:Kj,makeTarget:kA,choicesOf:kRe,previewOf:ORe};}\nexport {createMountRenderer};`;
  const bundled = await bundleUpstreamModule({ archive: { ...archive,
    read(relative) { return relative === entry ? Buffer.from(virtual) : archive.read(relative); } },
    entry, exports: ["createMountRenderer"] });
  const compiled = await transform(bundled.code, { format: "iife", globalName: "RDesktopMountUpstream0721", target: "es2022" });
  return { code: compiled.code, provenance: { upstream: archive.identity, source: extracted.provenance, modules: bundled.modules } };
}

export function desktopMountClientAdapter0721() {
  return `
let RDesktopMountController0721;
const RDesktopMountParts0721=RDesktopMountUpstream0721.createMountRenderer({
  client:Er,React:S,jsx:p,compiler:he,Icon:bt,Menu:It,SourceFailure:wn,
  platform:navigator.platform.toLowerCase().includes("mac")?"darwin":navigator.platform.toLowerCase().includes("linux")?"linux":"win32",
  translate:({id})=>id==="iN6NVv"?RLocT("Unmount from Desktop","从桌面卸载"):RLocT("Mount on Desktop","挂载到桌面"),
  agentName:agent=>agent.name,
  useSnapshot:es,get controller(){return RDesktopMountController0721;},
  sendPrompt:async(client,input)=>{await client.sendJournal.sendPrompt(input);await client.localToolPermission.clearApprovals();},
  reportPromise:promise=>{void Promise.resolve(promise).catch(console.error);},reportError:error=>console.error(error)
});
const RDesktopMountMenu0721=RDesktopMountParts0721.MenuItem;
const RDesktopMountClient0721={...Er,roster:{...Er.roster,snapshots:{...Er.roster.snapshots,
 get:()=>{const state=Er.roster.snapshots.get();return {...state,agentsById:new Map(state.agents.rows.map(agent=>[agent.id,agent]))};}}}};
RDesktopMountController0721=RDesktopMountParts0721.createController({source:window.desktopMount,client:RDesktopMountClient0721,
 choicesOf:RDesktopMountParts0721.choicesOf,previewOf:RDesktopMountParts0721.previewOf,discardStaged:vft});
window.addEventListener("pagehide",()=>RDesktopMountController0721.dispose(),{once:true});
`;
}

export async function applyDesktopMountRenderer0721({ stageRoot }) {
  const assets = path.join(stageRoot, "dist/renderer/assets");
  const matches = [];
  for (const file of await readdir(assets)) {
    if (!file.endsWith(".js")) continue;
    const source = await readFile(path.join(assets, file), "utf8");
    if (source.includes("const agt=()=>")) matches.push({ file, source });
  }
  if (matches.length !== 1) throw new Error("Desktop mount requires exactly one primary renderer");
  const [{ file, source }] = matches;
  if (source.includes(mark)) throw new Error("Desktop mount renderer is already patched");
  const anchor = "Er.start();window";
  const menu = "children:[L,RRenameSection,W,Y,te]";
  for (const value of [anchor, menu]) if (source.split(value).length !== 2) throw new Error(`Desktop mount anchor missing or ambiguous: ${value}`);
  const generated = await buildDesktopMountRenderer0721();
  const payload = `${mark}\n${generated.code}\n${desktopMountClientAdapter0721()}\n`;
  const patched = source.replace(menu, "children:[L,p.jsx(RDesktopMountMenu0721,{agent:t}),RRenameSection,W,Y,te]")
    .replace(anchor, () => `${payload}${anchor}`);
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  await writeFile(path.join(assets, file), patched);
  const provenance = { ...generated.provenance, file, originalSha256: sha(source), patchedSha256: sha(patched),
    adapter: "existing-send-journal-and-draft-recovery", upstreamController: "yce", upstreamMenu: "Kj" };
  await writeFile(path.join(stageRoot, "dist/renderer-desktop-mount-0721.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  return provenance;
}
