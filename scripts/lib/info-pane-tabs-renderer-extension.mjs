import path from "node:path";
import { build } from "esbuild";
import { repoRoot } from "./config.mjs";
import { parse } from "acorn";
import { simple } from "acorn-walk";
export function patchNativeInfoPaneTabs(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const functions = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === "p3n");
  if (functions.length !== 1) throw new Error("Info-pane tabs: native p3n missing or ambiguous.");
  const fn = functions[0];
  const choices = [];
  simple(fn, { ConditionalExpression(node) {
    if (node.test.type === "BinaryExpression" && node.test.operator === "===" && node.test.left.name === "F" && node.test.right.value === "overview" && node.consequent.type === "CallExpression" && source.slice(node.consequent.start, node.consequent.end).startsWith('p.jsxs("div",{') && source.slice(node.consequent.start, node.consequent.end).includes('children:[l,')) choices.push(node.consequent);
  }});
  if (choices.length !== 1) throw new Error("Info-pane tabs: native overview branch missing or ambiguous.");
  const overview = choices[0];
  let body = source.slice(fn.start, fn.end);
  const original = source.slice(overview.start, overview.end);
  const expanded = original.replace('p.jsxs("div",{', 'p.jsxs("div",{"data-r-info-pane-overview":t.id,').replace('children:[l,', 'children:[p.jsx(h3n,{agent:t,onDescriptionChange:m,onNameChange:u,onTitleChange:d}),p.jsx("div",{"data-r-info-pane-computer":"",style:{display:"contents"},children:l}),');
  const state = 'const F=pin(k,P);F!==P&&J(F),';
  const stateBridge = 'const F=P==="settings"?"overview":pin(k,P);S.useEffect(()=>{if(P==="settings")window.dispatchEvent(new CustomEvent("grok-node-info-pane-tab",{detail:"other"}))},[P]);F!==P&&P!=="settings"&&J(F),';
  const gear = 'Se=()=>J("settings")';
  const gearBridge = 'Se=()=>{J("settings");window.dispatchEvent(new CustomEvent("grok-node-info-pane-tab",{detail:"other"}))}';
  if (body.split(state).length !== 2 || body.split(gear).length !== 2) throw new Error("Info-pane tabs: native settings navigation drifted.");
  body = body.replace(original, expanded).replace(state, stateBridge).replace(gear, gearBridge);
  const patched = source.slice(0, fn.start) + body + source.slice(fn.end);
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return patched;
}
export async function buildInfoPaneTabsRendererExtension() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "frontend/src/extensions/info-pane-tabs-entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome142",
    minify: true,
  });
  const output = result.outputFiles[0];
  if (output == null) throw new Error("Info-pane tabs renderer extension was not built.");
  return output.text;
}
