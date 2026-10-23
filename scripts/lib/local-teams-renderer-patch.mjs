import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { parse } from "acorn";
import { chunkReactPlugin } from "./library-host-renderer-patch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LOCAL_TEAMS_REGISTRY_ANCHOR = 'const wDn=[{id:"general",label:"General",icon:"settings-gear"},';
export const LOCAL_TEAMS_PANEL_ANCHOR = 'Q=x==="general"?a.jsx(Te,{children:a.jsx(Sa,{auth:t})}):';
const mark = "/* sand-local-teams-0721 */";
const namespace = "__sandLocalTeams0721";

export function localTeamsStylePlugin() {
  return { name: "local-teams-inline-style", setup(api) {
    api.onResolve({ filter: /styles\.css\?inline$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -7)), namespace: "local-teams-style" }));
    api.onLoad({ filter: /.*/, namespace: "local-teams-style" }, async args => ({ contents: await readFile(args.path, "utf8"), loader: "text" }));
  } };
}

export async function buildLocalTeamsHostBundle() {
  const result = await build({ absWorkingDir: root, entryPoints: ["frontend/src/extensions/local-teams-host-mount.tsx"],
    bundle: true, format: "iife", globalName: namespace, platform: "browser", target: "es2022", jsx: "automatic",
    write: false, metafile: true, legalComments: "none", logLevel: "silent", plugins: [chunkReactPlugin(), localTeamsStylePlugin()] });
  for (const input of Object.keys(result.metafile.inputs)) {
    if (/node_modules\/(react|react-dom)\//.test(input)) throw new Error(`Local teams bundled a second React runtime: ${input}`);
  }
  const code = result.outputFiles[0].text;
  if (/\b(createRoot|MutationObserver)\b/.test(code)) throw new Error("Local teams must be a child of the existing settings tree");
  return `${mark}\nconst RLocalTeams0721=((S,p)=>{${code}\nreturn ${namespace};})(de,a);`;
}

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Local teams renderer anchor must occur exactly once: ${before}`);
  return source.replace(before, after);
}

export function patchLocalTeamsSettingsRegistry(source) {
  if (source.includes('id:"local-teams"')) throw new Error("Local teams settings entry already exists");
  return replaceOnce(source, LOCAL_TEAMS_REGISTRY_ANCHOR, `${LOCAL_TEAMS_REGISTRY_ANCHOR}{id:"local-teams",label:"Local teams & Tailnet",icon:"settings-gear"},`);
}

export function patchLocalTeamsSettingsPanel(source, bundle) {
  if (!bundle.startsWith(mark)) throw new Error("Local teams host bundle is missing");
  if (source.includes(mark)) throw new Error("Local teams panel already exists");
  const patched = replaceOnce(source, LOCAL_TEAMS_PANEL_ANCHOR,
    `Q=x==="local-teams"?a.jsx(Te,{children:a.jsx(RLocalTeams0721.RLocalTeamsHost,{})}):x==="general"?a.jsx(Te,{children:a.jsx(Sa,{auth:t})}):`);
  return `${patched}\n${bundle}\n`;
}

export async function applyLocalTeamsRendererPatch(rendererDir) {
  const assets = path.join(rendererDir, "assets");
  const candidates = await Promise.all((await readdir(assets)).filter(name => name.endsWith(".js")).map(async name => ({ name, source: await readFile(path.join(assets, name), "utf8") })));
  const registry = candidates.filter(file => file.source.includes(LOCAL_TEAMS_REGISTRY_ANCHOR));
  const panel = candidates.filter(file => file.source.includes(LOCAL_TEAMS_PANEL_ANCHOR));
  if (registry.length !== 1 || panel.length !== 1 || registry[0].name === panel[0].name) throw new Error("Expected one settings registry and one settings panel chunk");
  const bundle = await buildLocalTeamsHostBundle();
  const changes = [
    { ...registry[0], patched: patchLocalTeamsSettingsRegistry(registry[0].source) },
    { ...panel[0], patched: patchLocalTeamsSettingsPanel(panel[0].source, bundle) },
  ];
  for (const change of changes) parse(change.patched, { ecmaVersion: "latest", sourceType: "module" });
  const sha256 = text => createHash("sha256").update(text).digest("hex");
  const files = changes.map(change => ({ file: `assets/${change.name}`, originalSha256: sha256(change.source), patchedSha256: sha256(change.patched) }));
  for (const change of changes) {
    if (await readFile(path.join(assets, change.name), "utf8") !== change.source) throw new Error(`Renderer changed during local teams patch: ${change.name}`);
  }
  for (const change of changes) await writeFile(path.join(assets, change.name), change.patched);
  await writeFile(path.join(rendererDir, "renderer-local-teams-extension.json"), `${JSON.stringify({ version: 1, feature: "local-teams-0721", files }, null, 2)}\n`);
  return { applied: true, files };
}
