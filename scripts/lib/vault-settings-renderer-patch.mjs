import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { buildVaultRendererBundle, VAULT_RENDERER_MARK } from "./vault-renderer-patch.mjs";

const REGISTRY_ANCHOR = '{id:"computer",label:RLocT("Computer","电脑"),icon:"device-desktop"},';
const REGISTRY_ENTRY = '{id:"vault",label:RLocT("Vault","保险库"),icon:"vault"},';
// Anchors on the general-section test itself so the pass composes with the
// local-teams patch, which rewrites the leading `Q=` of this ternary chain.
const PANEL_ANCHOR = 'x==="router"?a.jsx(RRouterPanel,{}):';
const PANEL_BRANCH = 'x==="vault"?a.jsx(Te,{children:a.jsx(globalThis.__sandVaultRendererNS.RVaultSettingsHost,{focusSetting:null})}):';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Vault settings ${label} anchor must appear exactly once`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export async function applyVaultSettingsRenderer0721({ stageRoot }) {
  const assets = path.join(stageRoot, "dist/renderer/assets");
  const candidates = await Promise.all((await readdir(assets))
    .filter((name) => name.endsWith(".js"))
    .map(async (name) => ({ name, source: await readFile(path.join(assets, name), "utf8") })));
  const registry = candidates.filter((file) => file.source.includes(REGISTRY_ANCHOR));
  const panel = candidates.filter((file) => file.source.includes(PANEL_ANCHOR));
  if (registry.length !== 1 || panel.length !== 1) throw new Error("Expected one settings registry and one settings panel chunk");
  if (registry[0].source.includes(VAULT_RENDERER_MARK)) throw new Error("Vault renderer was already applied");
  const built = await buildVaultRendererBundle();
  const mainPatched = `${replaceOnce(registry[0].source, REGISTRY_ANCHOR, `${REGISTRY_ANCHOR}${REGISTRY_ENTRY}`, "registry")}\n${built.bundle}\nglobalThis.__sandVaultRendererNS=__sandVaultRendererNS;\n`;
  const panelPatched = replaceOnce(panel[0].source, PANEL_ANCHOR, `${PANEL_BRANCH}${PANEL_ANCHOR}`, "panel");
  parse(mainPatched, { ecmaVersion: "latest", sourceType: "module" });
  parse(panelPatched, { ecmaVersion: "latest", sourceType: "module" });
  const sha256 = (text) => createHash("sha256").update(text).digest("hex");
  const files = [
    { file: `assets/${registry[0].name}`, originalSha256: sha256(registry[0].source), patchedSha256: sha256(mainPatched) },
    { file: `assets/${panel[0].name}`, originalSha256: sha256(panel[0].source), patchedSha256: sha256(panelPatched) },
  ];
  for (const [entry, patched] of [[registry[0], mainPatched], [panel[0], panelPatched]]) {
    if (await readFile(path.join(assets, entry.name), "utf8") !== entry.source) throw new Error(`Renderer changed during vault patch: ${entry.name}`);
  }
  await writeFile(path.join(assets, registry[0].name), mainPatched);
  await writeFile(path.join(assets, panel[0].name), panelPatched);
  const provenance = { version: 1, feature: "vault-settings-0721", files,
    upstream: built.generated.provenance, messages: built.messages?.provenance ?? null };
  await writeFile(path.join(stageRoot, "dist/renderer/renderer-vault-settings-0721.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`Vault settings: original 0.75.5 panel mounted into ${registry[0].name} + ${panel[0].name}`);
  return provenance;
}
