import path from "node:path";
import { build } from "esbuild";
import { repoRoot } from "./config.mjs";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import { createInfoPaneAction0753, infoPaneButtons0753Css, infoPaneHeader0753Class } from "../../frontend/src/extensions/info-pane-buttons-0753.js";
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
  const HERO_JSX = 'p.jsx("div",{"data-r-info-pane-hero":"",children:p.jsxs("div",{className:"sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-h8yej3",style:{gap:"16px",padding:"0 0 12px"},children:[p.jsx(f3n,{agent:t}),p.jsxs("div",{"data-r-hero-text":"",className:"sand-78zum5 sand-dt5ytf sand-6s0dn4",style:{gap:"4px",width:"100%",minWidth:"0"},children:[p.jsx(Uwe,{ariaLabel:"Agent name",initialValue:t.name,isRequired:!0,onCommit:u,placeholder:"Bob"}),YCe(t)?p.jsx(Uwe,{ariaLabel:"Agent title",initialValue:t.title,onCommit:d,placeholder:typeof RLocT==="function"?RLocT("Add a label","添加标签"):"Add a label"}):null]})]})})';
  const expanded = original.replace('p.jsxs("div",{', 'p.jsxs("div",{"data-r-info-pane-overview":t.id,').replace('children:[l,', 'children:[' + HERO_JSX + ',p.jsx(h3n,{agent:t,onDescriptionChange:m,onNameChange:u,onTitleChange:d}),p.jsx("div",{"data-r-info-pane-computer":"",style:{display:"contents"},children:l}),');
  const state = 'const F=pin(k,P);F!==P&&J(F),';
  const stateBridge = 'const F=P==="settings"?"overview":pin(k,P);S.useEffect(()=>{if(P==="settings")window.dispatchEvent(new CustomEvent("grok-node-info-pane-tab",{detail:"other"}))},[P]);F!==P&&P!=="settings"&&J(F),';
  const gear = 'Se=()=>J("settings")';
  const gearBridge = 'Se=()=>{J("settings");window.dispatchEvent(new CustomEvent("grok-node-info-pane-tab",{detail:"other"}))}';
  if (body.split(state).length !== 2 || body.split(gear).length !== 2) throw new Error("Info-pane tabs: native settings navigation drifted.");
  body = body.replace(original, expanded).replace(state, stateBridge).replace(gear, gearBridge);
  const patched = source.slice(0, fn.start) + body + source.slice(fn.end);
  const CLOSE_BEFORE = 'p.jsx(fr,{"aria-label":"Close details",icon:"chevrons-right",iconSize:zwe,onClick:c,title:"Close details"})';
  const CLOSE_AFTER = 'p.jsx(RInfoPaneAction0753,{"aria-label":"Close details",icon:"close",onClick:c,title:"Close details"})';
  const GEAR_BEFORE = 'p.jsx(fr,{"aria-label":"Agent settings","data-info-row":"settings",icon:"settings-gear",iconSize:zwe,onClick:l})';
  const GEAR_AFTER = 'p.jsx(RInfoPaneAction0753,{"aria-label":"Agent settings","data-info-row":"settings",icon:"settings-gear",onClick:l})';
  if (patched.split(CLOSE_BEFORE).length !== 2) throw new Error("Info-pane tabs: native close button drifted.");
  if (patched.split(GEAR_BEFORE).length !== 2) throw new Error("Info-pane tabs: native settings button drifted.");
  const HEADER_BEFORE = "sand-1n2onr6 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-lvsv26 sand-xlogw sand-14kp3v7 sand-exx8yu sand-j9b1aj sand-18d9i69 sand-f18ygs";
  const ACTIONS_BEFORE = 're("sand-info-pane__actions","sand-3nfvp2 sand-6s0dn4 sand-195vfkc sand-lvsv26")';
  const ACTIONS_AFTER = 're("sand-info-pane__actions","sand-3nfvp2 sand-6s0dn4 sand-167g77z sand-lvsv26")';
  if (patched.split(HEADER_BEFORE).length !== 2 || patched.split(ACTIONS_BEFORE).length !== 2) throw new Error("Info-pane buttons: native header layout drifted.");
  const repatched = patched.replace(CLOSE_BEFORE, CLOSE_AFTER).replace(GEAR_BEFORE, GEAR_AFTER).replace(HEADER_BEFORE, infoPaneHeader0753Class).replace(ACTIONS_BEFORE, ACTIONS_AFTER)
    + `\nconst RInfoPaneAction0753=(${createInfoPaneAction0753.toString()})({compiler:he,jsx:p,styles:Fe,classNames:re,Icon:Dr});\n`;
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
  return `(()=>{if(document.getElementById("sand-info-pane-buttons-0753"))return;const style=document.createElement("style");style.id="sand-info-pane-buttons-0753";style.textContent=${JSON.stringify(infoPaneButtons0753Css)};document.head.append(style)})();\n` + output.text;
}
