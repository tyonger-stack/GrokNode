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
  // Official 0.71.2 keeps a centred identity hero (Pq: 64px avatar + inline-editable
  // centred name/title) above the sticky pill tablist in every simplified-overview
  // tab. 0.18 has no Pq/zp, so the hero is composed from the pinned chunk's own
  // avatar (f3n) and commit-input (Uwe) primitives; the extension stylesheet restyles
  // the inputs to 0.71.2's borderless centred look and hides the labelled form
  // (h3n) everywhere except the "other" tab, where 0.71.2's settings subpage shows it.
  //
  // Title ("添加标签" / "Add a label") mirrors official Pq + o6/z9:
  //   o6(n) ≡ YCe(n) ≡ !isGroup && title !== undefined
  // Official also ANDs feature gate sand_agent_titles + (editable || non-empty);
  // 0.18 never shipped that gate, and h3n already shows the title field on YCe alone,
  // so the hero uses the same YCe gate. Empty title still renders with the official
  // placeholder (i18n key d85lwh) — the previous `t.title.trim().length>0` gate hid
  // the control entirely until a label already existed.
  const HERO_JSX = 'p.jsx("div",{"data-r-info-pane-hero":"",children:p.jsxs("div",{className:"sand-78zum5 sand-dt5ytf sand-6s0dn4",style:{gap:"16px",padding:"8px 16px 12px"},children:[p.jsx(f3n,{agent:t}),p.jsxs("div",{"data-r-hero-text":"",className:"sand-78zum5 sand-dt5ytf sand-6s0dn4",style:{gap:"4px",width:"100%",minWidth:"0"},children:[p.jsx(Uwe,{ariaLabel:"Agent name",initialValue:t.name,isRequired:!0,onCommit:u,placeholder:"Bob"}),YCe(t)?p.jsx(Uwe,{ariaLabel:"Agent title",initialValue:t.title,onCommit:d,placeholder:typeof RLocT==="function"?RLocT("Add a label","添加标签"):"Add a label"}):null]})]})})';
  const expanded = original.replace('p.jsxs("div",{', 'p.jsxs("div",{"data-r-info-pane-overview":t.id,').replace('children:[l,', 'children:[' + HERO_JSX + ',p.jsx(h3n,{agent:t,onDescriptionChange:m,onNameChange:u,onTitleChange:d}),p.jsx("div",{"data-r-info-pane-computer":"",style:{display:"contents"},children:l}),');
  const state = 'const F=pin(k,P);F!==P&&J(F),';
  const stateBridge = 'const F=P==="settings"?"overview":pin(k,P);S.useEffect(()=>{if(P==="settings")window.dispatchEvent(new CustomEvent("grok-node-info-pane-tab",{detail:"other"}))},[P]);F!==P&&P!=="settings"&&J(F),';
  const gear = 'Se=()=>J("settings")';
  const gearBridge = 'Se=()=>{J("settings");window.dispatchEvent(new CustomEvent("grok-node-info-pane-tab",{detail:"other"}))}';
  if (body.split(state).length !== 2 || body.split(gear).length !== 2) throw new Error("Info-pane tabs: native settings navigation drifted.");
  body = body.replace(original, expanded).replace(state, stateBridge).replace(gear, gearBridge);
  const patched = source.slice(0, fn.start) + body + source.slice(fn.end);
  // 0.71.2's top bar (ax) closes the pane with the "close" glyph, not 0.18's
  // chevrons-right; keep the tooltip-carrying icon button otherwise unchanged.
  const CLOSE_BEFORE = 'p.jsx(fr,{"aria-label":"Close details",icon:"chevrons-right",iconSize:zwe,onClick:c,title:"Close details"})';
  const CLOSE_AFTER = 'p.jsx(fr,{"aria-label":"Close details",icon:"close",iconSize:zwe,onClick:c,shape:"circle",title:"Close details",variant:"secondary"})';
  const GEAR_BEFORE = '"data-info-row":"settings",icon:"settings-gear",iconSize:zwe,onClick:l})';
  const GEAR_AFTER = '"data-info-row":"settings",icon:"settings-gear",iconSize:zwe,onClick:l,shape:"circle",variant:"secondary"})';
  if (patched.split(CLOSE_BEFORE).length !== 2) throw new Error("Info-pane tabs: native close button drifted.");
  if (patched.split(GEAR_BEFORE).length !== 2) throw new Error("Info-pane tabs: native settings button drifted.");
  const repatched = patched.replace(CLOSE_BEFORE, CLOSE_AFTER).replace(GEAR_BEFORE, GEAR_AFTER);
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  parse(repatched, { ecmaVersion: "latest", sourceType: "module" });
  return repatched;
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
