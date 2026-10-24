import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { portCode } from "./recipient-picker-0755-patch.mjs";
import official from "./group-author-0755-official.json" with { type: "json" };

const bindings = { Z: "RGCache", Y: "RGJSX", J: "RGUseI18n", Vn: "RGText", $: "RGJoin", Bb: "RGVars", sAt: "RGStyles", fAt: "RGAuthor", XVe: "RGAuthorHue", DO: "RGAvatarColor", OO: "RGNormalizeHue", Ci: "RGDefaultHue", si: "RGColorRows", lAt: "RGNameStyle", cAt: "RGNameColor", Qt: "RGDefaultHue", Zt: "RGHueIndex", Xt: "RGSampleHue", Jt: "RGSeed", Yt: "RGRandom", qt: "RGHash", jt: "RGColorRows", Mt: "RGDefaultRows", Wt: "RGDefaultIds", Gt: "RGHashVersion", Kt: "RGSampleVersion" };
const once = (source, before, after) => { assert.equal(source.split(before).length, 2, "Group author anchor missing or ambiguous: " + before); return source.replace(before, after); };
let author = official.functions.fAt;
author = once(author, "$(`sand-group-author`,e.className)", "$(`sand-group-author`,e.className,`rg0755-colors`)");
author = once(author, "$(`sand-group-author`,d.className)", "$(`sand-group-author`,d.className,`rg0755-colors`)");
const copied = portCode(Object.entries(official.variables).map(([name, value]) => `const ${name}=${value};`).join("\n") + Object.values(official.defaults).join("\n") + Object.entries(official.functions).map(([name, source]) => name === "fAt" ? author : source).join("\n"), bindings, "rg0755");

export const GROUP_AUTHOR_0755_COMPONENTS = `
const RGCache=he,RGJSX=p,RGText=vt,RGJoin=re;
const RGMessages=JSON.parse(${JSON.stringify(JSON.stringify(official.messages))});
function RGUseI18n(){return{_:(message)=>RLocT(RSMCatalogText(RGMessages.en[message.id],message.values),RSMCatalogText(RGMessages.zh[message.id],message.values))}}
${copied}
function RGColorAuthorRun(root,authorId,agent,header,children){
  if(header==null)return root;
  const column=root.props.children[1];
  const colored=S.cloneElement(header,{hue:RGAuthorHue(authorId,agent??null)});
  return S.cloneElement(root,{children:[root.props.children[0],S.cloneElement(column,{children:[colored,children]})]});
}
`;
const declarations = values => Object.entries(values).map(([name, value]) => `${name}:${value}`).join(";");
export const GROUP_AUTHOR_0755_STYLE = official.css + `\n.rg0755-colors{${declarations(official.themes.dark)}}\n.sand-shell[data-theme*="light"] .rg0755-colors{${declarations(official.themes.light)}}\n`;
export function patchGroupAuthor0755(source) {
  assert(!source.includes("function RGAuthor("), "Group author port already applied");
  assert(source.includes("function RSMCatalogText("), "Official locale bridge missing");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const owner = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "gMn");
  assert(owner, "Native author-run component missing");
  let text = source.slice(owner.start, owner.end);
  text = once(text, "p.jsx(kMn,{", "p.jsx(RGAuthor,{");
  text = once(text, ":O=e[37],O}", ":O=e[37],RGColorAuthorRun(O,t.id,y,P,l)}");
  const patched = source.slice(0, owner.start) + text + source.slice(owner.end) + GROUP_AUTHOR_0755_COMPONENTS;
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return patched;
}
const hash = value => createHash("sha256").update(value).digest("hex");
export async function applyGroupAuthor0755Patch({ stageRoot }) {
  const js = "dist/renderer/assets/index-UbX-y3il.js", stylesheet = "dist/renderer/assets/index-lCyB53CO.css";
  const source = await readFile(path.join(stageRoot, js), "utf8"), css = await readFile(path.join(stageRoot, stylesheet), "utf8");
  const patched = patchGroupAuthor0755(source), patchedCss = css + "\n" + GROUP_AUTHOR_0755_STYLE;
  await writeFile(path.join(stageRoot, js), patched); await writeFile(path.join(stageRoot, stylesheet), patchedCss);
  const record = { mode: "official-group-author-0755", officialAppSha256: official.appSha256, officialCommonSha256: official.commonSha256, features: ["official-sender-hue-resolution", "official-sender-name-component", "light-and-dark-name-palette"], files: [{ path: js, originalSha256: hash(source), patchedSha256: hash(patched) }, { path: stylesheet, originalSha256: hash(css), patchedSha256: hash(patchedCss) }] };
  await writeFile(path.join(stageRoot, "dist/renderer-group-author-0755-extension.json"), JSON.stringify(record, null, 2) + "\n");
  return record;
}
