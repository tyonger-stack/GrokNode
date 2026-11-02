import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { parse } from "acorn";
import { chunkReactPlugin } from "./library-host-renderer-patch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mark = "/* sand-port-0750-hosts */";
const namespace = "__sandPort0750Hosts";
const settingsAnchor = "a.jsx(Te,{children:a.jsx(Sa,{auth:t})})";
const settingsReplacement = "a.jsx(Te,{children:[a.jsx(Sa,{auth:t}),a.jsx(RPort0750Settings.RPort0750SettingsPack,{})]})";
// The plugins host used to inject the repo's "已安装 / 卸载" panel and its custom-MCP form
// into upstream's Installed section — the "连接应用" dialog's second-level "管理插件和技能"
// page. Official 0.78.1's second-level page carries neither: its installed list is the plain
// plugin grid, and official keeps the connector form on a page of its own (`qLe/7o`,
// `chunk-user-custom-connector-M5UeTEiw.js`). Parking the pack there is what made the
// reconstruction's second-level page differ from official's, so the plugins host is gone: the
// form moved to the settings host slot, and the uninstall action stays on the plugin detail
// page upstream already ships.

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`0.75 host ${label} anchor must occur exactly once`);
  return source.replace(before, after);
}

export async function buildPort0750HostBundle() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["frontend/src/extensions/port-0750-packaged-hosts.tsx"],
    bundle: true,
    format: "iife",
    globalName: namespace,
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    write: false,
    metafile: true,
    legalComments: "none",
    logLevel: "silent",
    plugins: [chunkReactPlugin()],
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    if (/node_modules\/(react|react-dom)\//.test(input)) throw new Error(`0.75 host bundled a second React runtime: ${input}`);
  }
  const code = result.outputFiles[0].text;
  if (/\b(createRoot|MutationObserver)\b/.test(code)) throw new Error("0.75 host must stay inside the existing React tree");
  return `${mark}\nconst RPort0750Settings=((S,p)=>{${code}\nreturn ${namespace};})(de,a);`;
}

export function patchPort0750Settings(source, bundle) {
  if (!bundle.startsWith(mark)) throw new Error("0.75 settings bundle is missing");
  if (source.includes("RPort0750SettingsPack")) throw new Error("0.75 settings host already exists");
  return `${replaceOnce(source, settingsAnchor, settingsReplacement, "settings")}\n${bundle}\n`;
}

export async function applyPort0750RendererPatch({ stageRoot }) {
  const assets = path.join(stageRoot, "dist/renderer/assets");
  const candidates = await Promise.all((await readdir(assets)).filter((name) => name.endsWith(".js")).map(async (name) => ({
    name,
    source: await readFile(path.join(assets, name), "utf8"),
  })));
  const settings = candidates.filter((file) => file.source.includes(settingsAnchor));
  if (settings.length !== 1) throw new Error("Expected one settings panel for the 0.75 hosts");
  const settingsBundle = await buildPort0750HostBundle();
  const changes = [
    { ...settings[0], patched: patchPort0750Settings(settings[0].source, settingsBundle) },
  ];
  for (const change of changes) parse(change.patched, { ecmaVersion: "latest", sourceType: "module" });
  const sha256 = (text) => createHash("sha256").update(text).digest("hex");
  const files = changes.map((change) => ({
    file: `assets/${change.name}`,
    originalSha256: sha256(change.source),
    patchedSha256: sha256(change.patched),
  }));
  for (const change of changes) {
    if (await readFile(path.join(assets, change.name), "utf8") !== change.source) {
      throw new Error(`Renderer changed during 0.75 host patch: ${change.name}`);
    }
  }
  for (const change of changes) await writeFile(path.join(assets, change.name), change.patched);
  const provenance = { version: 1, feature: "port-0750-hosts", files };
  await writeFile(path.join(stageRoot, "dist/renderer-port-0750-hosts.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`0.75 hosts: vault card, memory import and the custom MCP form mounted into ${settings[0].name}`);
  return provenance;
}
